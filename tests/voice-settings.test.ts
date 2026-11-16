import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE_MODELS, languageHint, normalizeVoiceSettings } from '../src/utils/voice-settings';
import { bytesToBase64, encodeWav } from '../src/utils/wav-encoder';

describe('normalizeVoiceSettings', () => {
  it('falls back to the browser engine when nothing valid is stored', () => {
    for (const raw of [undefined, null, 'x', 42, {}, { engine: 'cloud', provider: 'claude', language: 'xx' }]) {
      const s = normalizeVoiceSettings(raw);
      expect(s.engine).toBe('browser');
      expect(s.provider).toBe('openai');
      expect(s.language).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it('keeps valid values and trims the model', () => {
    const s = normalizeVoiceSettings({ engine: 'provider', provider: 'gemini', language: 'id-ID', model: '  gemini-x  ' });
    expect(s).toEqual({ engine: 'provider', provider: 'gemini', language: 'id-ID', model: 'gemini-x' });
  });

  it('uses the provider default model when the stored one is not a string', () => {
    expect(normalizeVoiceSettings({ provider: 'gemini', model: 5 }).model).toBe(DEFAULT_VOICE_MODELS.gemini);
  });

  it('turns a language tag into a provider hint', () => {
    expect(languageHint('id-ID')).toBe('id');
  });
});

describe('encodeWav', () => {
  it('writes a 16 kHz mono PCM header and clamps samples', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2, -2]));
    const view = new DataView(wav.buffer);
    const tag = (o: number) => String.fromCharCode(...wav.subarray(o, o + 4));

    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(10);
    expect(wav.length).toBe(44 + 10);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
    expect(view.getInt16(50, true)).toBe(0x7fff);
    expect(view.getInt16(52, true)).toBe(-0x8000);
  });

  it('encodes large buffers to base64 without overflowing the stack', () => {
    const bytes = new Uint8Array(500_000).fill(65);
    expect(bytesToBase64(bytes).length).toBe(Math.ceil(500_000 / 3) * 4);
  });
});
