import { describe, expect, it, vi } from 'vitest';
import { joinDictation, startDictation, type DictationEvents } from '../src/popup/dictation';
import { assertAudioSize, MAX_AUDIO_BASE64_CHARS } from '../src/background/payload-guard';
import { defaultVoiceSettings } from '../src/utils/voice-settings';

const events = () => {
  const log: any[] = [];
  const e: DictationEvents = {
    onState: (state, error) => log.push(['state', state, error?.message, error?.needsPermission]),
    onText: (text, final) => log.push(['text', text, final]),
  };
  return { e, log };
};

class FakeRecognition {
  static last: FakeRecognition;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: any;
  onerror: any;
  onend: any;
  started = false;
  aborted = false;
  constructor() { FakeRecognition.last = this; }
  start() { this.started = true; }
  stop() { this.onend?.(); }
  abort() { this.aborted = true; }
}

const result = (transcript: string, isFinal: boolean) => Object.assign([{ transcript }], { isFinal });
const browser = { ...defaultVoiceSettings(), engine: 'browser' as const, language: 'id-ID' };

describe('joinDictation', () => {
  it('appends with one space and keeps an existing trailing space or newline', () => {
    expect(joinDictation('', 'hi')).toBe('hi');
    expect(joinDictation('a', 'b')).toBe('a b');
    expect(joinDictation('a ', 'b')).toBe('a b');
    expect(joinDictation('a\n', 'b')).toBe('a\nb');
    expect(joinDictation('a', '')).toBe('a');
  });
});

describe('browser engine', () => {
  it('sets language, streams interim text and delivers the final text on stop', async () => {
    const { e, log } = events();
    const session = await startDictation(browser, e, { recognition: FakeRecognition });
    const r = FakeRecognition.last;

    expect(r.lang).toBe('id-ID');
    expect(r.continuous && r.interimResults).toBe(true);
    r.onresult({ resultIndex: 0, results: [result('halo', true), result(' dunia', false)] });
    expect(log.at(-1)).toEqual(['text', 'halo dunia', false]);

    session!.stop();
    expect(log.at(-2)).toEqual(['text', 'halo dunia', true]);
    expect(log.at(-1)).toEqual(['state', 'idle', undefined, undefined]);
  });

  it('reports a blocked microphone with the permission flag', async () => {
    const { e, log } = events();
    await startDictation(browser, e, { recognition: FakeRecognition });
    FakeRecognition.last.onerror({ error: 'not-allowed' });
    FakeRecognition.last.onend();

    expect(log.find((l) => l[1] === 'error')).toEqual(['state', 'error', expect.stringContaining('blocked'), true]);
    expect(log.some((l) => l[1] === 'idle')).toBe(false);
  });

  it('treats no-speech as a quiet end, not an error', async () => {
    const { e, log } = events();
    await startDictation(browser, e, { recognition: FakeRecognition });
    FakeRecognition.last.onerror({ error: 'no-speech' });
    FakeRecognition.last.onend();
    expect(log).toEqual([['state', 'listening', undefined, undefined], ['state', 'idle', undefined, undefined]]);
  });

  it('says so when the browser has no speech recognition', async () => {
    const { e, log } = events();
    expect(await startDictation(browser, e, { recognition: undefined })).toBeNull();
    expect(log[0][1]).toBe('error');
  });

  it('cancel drops the result', async () => {
    const { e, log } = events();
    const session = await startDictation(browser, e, { recognition: FakeRecognition });
    FakeRecognition.last.onresult({ resultIndex: 0, results: [result('x', true)] });
    const before = log.length;
    session!.cancel();
    FakeRecognition.last.onend();
    expect(FakeRecognition.last.aborted).toBe(true);
    expect(log.length).toBe(before);
  });
});

class FakeRecorder {
  static last: FakeRecorder;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: any;
  onstop: any;
  constructor(public stream: MediaStream) { FakeRecorder.last = this; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['abc']) });
    return this.onstop?.();
  }
}

const provider = { ...defaultVoiceSettings(), engine: 'provider' as const };
const mic = () => {
  const stop = vi.fn();
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
  return { getUserMedia, stop };
};

describe('provider engine', () => {
  it('records, sends the clip through the transcribe function and delivers the text', async () => {
    const { e, log } = events();
    const m = mic();
    const transcribe = vi.fn().mockResolvedValue(' halo ');
    const session = await startDictation(provider, e, {
      mediaDevices: m, recorder: FakeRecorder as any, toWavBase64: async () => 'WAV', transcribe,
    });

    session!.stop();
    await vi.waitFor(() => expect(log.at(-1)).toEqual(['state', 'idle', undefined, undefined]));

    expect(transcribe).toHaveBeenCalledWith('WAV');
    expect(log.map((l) => l[1])).toEqual(['listening', 'transcribing', 'halo', 'idle']);
    expect(log[2]).toEqual(['text', 'halo', true]);
    expect(m.stop).toHaveBeenCalled();
  });

  it('shows the service worker error and gives the text nowhere to go', async () => {
    const { e, log } = events();
    const session = await startDictation(provider, e, {
      mediaDevices: mic(), recorder: FakeRecorder as any, toWavBase64: async () => 'WAV',
      transcribe: async () => { throw new Error('No API key configured for openai.'); },
    });
    session!.stop();
    await vi.waitFor(() => expect(log.some((l) => l[1] === 'error')).toBe(true));
    expect(log.find((l) => l[1] === 'error')[2]).toContain('No API key');
    expect(log.some((l) => l[0] === 'text')).toBe(false);
  });

  it('reports an empty transcript', async () => {
    const { e, log } = events();
    const session = await startDictation(provider, e, {
      mediaDevices: mic(), recorder: FakeRecorder as any, toWavBase64: async () => 'WAV', transcribe: async () => '  ',
    });
    session!.stop();
    await vi.waitFor(() => expect(log.at(-1)[1]).toBe('error'));
    expect(log.at(-1)[2]).toContain('No speech');
  });

  it('flags a denied microphone so the panel can offer the permission page', async () => {
    const { e, log } = events();
    const denied = { getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' })) };
    expect(await startDictation(provider, e, { mediaDevices: denied, recorder: FakeRecorder as any })).toBeNull();
    expect(log[0]).toEqual(['state', 'error', expect.any(String), true]);
  });

  it('cancel releases the microphone and sends nothing', async () => {
    const { e, log } = events();
    const m = mic();
    const transcribe = vi.fn();
    const session = await startDictation(provider, e, {
      mediaDevices: m, recorder: FakeRecorder as any, toWavBase64: async () => 'WAV', transcribe,
    });
    session!.cancel();
    await Promise.resolve();
    expect(m.stop).toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(log.map((l) => l[1])).toEqual(['listening']);
  });
});

describe('assertAudioSize', () => {
  it('accepts a clip, rejects nothing or too much', () => {
    expect(assertAudioSize('AAAA')).toBeNull();
    expect(assertAudioSize('')).toMatch(/No audio/);
    expect(assertAudioSize(undefined)).toMatch(/No audio/);
    expect(assertAudioSize('A'.repeat(MAX_AUDIO_BASE64_CHARS + 1))).toMatch(/too long/);
  });
});
