import type { DictationState } from '../types/voice';
import { normalizeVoiceSettings, type VoiceSettings } from '../utils/voice-settings';
import { WAV_SAMPLE_RATE, bytesToBase64, encodeWav } from '../utils/wav-encoder';

/** Stop recording by itself: keeps the clip under the service worker's size limit */
export const MAX_RECORDING_MS = 120_000;

export interface DictationEvents {
  onState(state: DictationState, error?: { message: string; needsPermission?: boolean }): void;
  /** `text` is everything dictated since the start (committed plus interim); `final` once the session is over */
  onText(text: string, final: boolean): void;
}

export interface DictationSession {
  /** Finish: the browser engine returns what it heard, the provider engine sends the clip */
  stop(): void;
  /** Drop everything without producing text (panel closed, component unmounted) */
  cancel(): void;
}

export interface DictationDeps {
  recognition?: (new () => any) | undefined;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'> | undefined;
  recorder?: (new (stream: MediaStream) => MediaRecorder) | undefined;
  toWavBase64?: (blob: Blob) => Promise<string>;
  transcribe?: (audioBase64: string) => Promise<string>;
}

const PERMISSION_MESSAGE = 'Microphone access is blocked. Allow it, then try again.';

/** Append dictated text to what is already in a field */
export function joinDictation(base: string, text: string): string {
  if (!text) return base;
  if (!base) return text;
  return /\s$/.test(base) ? base + text : `${base} ${text}`;
}

export async function loadVoiceSettings(): Promise<VoiceSettings> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    return normalizeVoiceSettings(response?.data?.voice);
  } catch {
    return normalizeVoiceSettings(undefined);
  }
}

/** Starts the engine chosen in Settings. Problems are reported through `events`, never thrown */
export async function startDictation(
  voice: VoiceSettings,
  events: DictationEvents,
  deps: DictationDeps = {}
): Promise<DictationSession | null> {
  return voice.engine === 'provider' ? startRecorder(events, deps) : startBrowserRecognition(voice, events, deps);
}

function startBrowserRecognition(voice: VoiceSettings, events: DictationEvents, deps: DictationDeps): DictationSession | null {
  const Recognition =
    'recognition' in deps ? deps.recognition : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Recognition) {
    events.onState('error', { message: 'This browser has no speech recognition. Choose "AI provider" in Settings > Voice.' });
    return null;
  }

  const recognition = new Recognition();
  recognition.lang = voice.language;
  recognition.continuous = true;
  recognition.interimResults = true;

  let committed = '';
  let interim = '';
  let failed = false;
  let cancelled = false;

  recognition.onresult = (event: any) => {
    interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const piece: string = result[0]?.transcript ?? '';
      if (result.isFinal) committed = joinDictation(committed, piece.trim());
      else interim += piece;
    }
    if (!cancelled) events.onText(joinDictation(committed, interim.trim()), false);
  };

  recognition.onerror = (event: any) => {
    const code: string = event?.error ?? '';
    if (code === 'no-speech' || code === 'aborted') return; // onend follows; nothing to report
    failed = true;
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      events.onState('error', { message: PERMISSION_MESSAGE, needsPermission: true });
    } else if (code === 'audio-capture') {
      events.onState('error', { message: 'No microphone was found.' });
    } else if (code === 'network') {
      events.onState('error', { message: 'The speech service could not be reached. Check your connection.' });
    } else {
      events.onState('error', { message: `Speech recognition failed (${code || 'unknown error'}).` });
    }
  };

  recognition.onend = () => {
    if (cancelled) return;
    const text = joinDictation(committed, interim.trim());
    if (text) events.onText(text, true);
    if (!failed) events.onState('idle');
  };

  try {
    recognition.start();
  } catch (error) {
    events.onState('error', { message: `Could not start speech recognition: ${error}` });
    return null;
  }
  events.onState('listening');

  return {
    stop: () => recognition.stop(),
    cancel: () => {
      cancelled = true;
      recognition.abort?.();
    },
  };
}

async function startRecorder(events: DictationEvents, deps: DictationDeps): Promise<DictationSession | null> {
  const mediaDevices = 'mediaDevices' in deps ? deps.mediaDevices : navigator.mediaDevices;
  const Recorder = 'recorder' in deps ? deps.recorder : typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder;
  if (!mediaDevices?.getUserMedia || !Recorder) {
    events.onState('error', { message: 'This browser cannot record audio.' });
    return null;
  }

  let stream: MediaStream;
  try {
    stream = await mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    const name = (error as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      events.onState('error', { message: PERMISSION_MESSAGE, needsPermission: true });
    } else if (name === 'NotFoundError') {
      events.onState('error', { message: 'No microphone was found.' });
    } else {
      events.onState('error', { message: `Could not open the microphone: ${error}` });
    }
    return null;
  }

  const recorder = new Recorder(stream);
  const chunks: Blob[] = [];
  let cancelled = false;
  const release = () => stream.getTracks().forEach((track) => track.stop());
  const timer = setTimeout(() => {
    if (recorder.state === 'recording') recorder.stop();
  }, MAX_RECORDING_MS);

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = async () => {
    clearTimeout(timer);
    release();
    if (cancelled) return;
    if (chunks.length === 0) {
      events.onState('error', { message: 'Nothing was recorded.' });
      return;
    }
    events.onState('transcribing');
    try {
      const wav = await (deps.toWavBase64 ?? blobToWavBase64)(new Blob(chunks, { type: recorder.mimeType }));
      const text = (await (deps.transcribe ?? transcribeViaServiceWorker)(wav)).trim();
      if (cancelled) return;
      if (!text) {
        events.onState('error', { message: 'No speech was recognised.' });
        return;
      }
      events.onText(text, true);
      events.onState('idle');
    } catch (error) {
      if (!cancelled) events.onState('error', { message: error instanceof Error ? error.message : String(error) });
    }
  };

  recorder.start();
  events.onState('listening');

  return {
    stop: () => {
      if (recorder.state === 'recording') recorder.stop();
    },
    cancel: () => {
      cancelled = true;
      clearTimeout(timer);
      if (recorder.state === 'recording') recorder.stop();
      else release();
    },
  };
}

async function transcribeViaServiceWorker(audioBase64: string): Promise<string> {
  const response = await chrome.runtime.sendMessage({
    type: 'TRANSCRIBE_AUDIO',
    payload: { audioBase64, mimeType: 'audio/wav' },
  });
  if (!response?.success) throw new Error(response?.error || 'Transcription failed.');
  return String(response.data?.text ?? '');
}

/** Decode what MediaRecorder produced (WebM/Opus), mix to mono at 16 kHz and wrap it as WAV */
async function blobToWavBase64(blob: Blob): Promise<string> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * WAV_SAMPLE_RATE)), WAV_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return bytesToBase64(encodeWav(rendered.getChannelData(0)));
  } finally {
    void context.close();
  }
}

/** The panel opens this page in a tab once so Chrome can ask for the microphone (an iframe often cannot show the prompt) */
export function openMicPermissionPage(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission/index.html') });
}
