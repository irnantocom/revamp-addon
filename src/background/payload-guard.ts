import type { AIMessage } from '../ai/provider-interface';
import { estimateRequestBytes, MAX_PAYLOAD_BYTES } from '../ai/message-format';

/** Returns the error to show when a request is too large to send, or null when it is fine */
export function assertPayloadSize(messages: AIMessage[]): string | null {
  const bytes = estimateRequestBytes(messages);
  if (bytes <= MAX_PAYLOAD_BYTES) return null;
  const mb = Math.ceil(bytes / (1024 * 1024));
  return `Attachments are too large to send (${mb} MB). Remove some and try again.`;
}

/** A dictation clip is at most 120 s of 16 kHz mono WAV (about 3.8 MB, 5.1 MB as base64) */
export const MAX_AUDIO_BASE64_CHARS = 8 * 1024 * 1024;

export function assertAudioSize(audioBase64: unknown): string | null {
  if (typeof audioBase64 !== 'string' || audioBase64.length === 0) return 'No audio was recorded.';
  if (audioBase64.length > MAX_AUDIO_BASE64_CHARS) return 'The recording is too long to transcribe. Record a shorter clip.';
  return null;
}
