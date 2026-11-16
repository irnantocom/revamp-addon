import { describe, it, expect } from 'vitest';
import { pickGeminiModels, describeGeminiError, DEFAULT_GEMINI_MODELS } from '../src/ai/gemini-models';

const gen = ['generateContent', 'countTokens'];
const entry = (name: string, methods = gen) => ({ name: `models/${name}`, supportedGenerationMethods: methods });

describe('pickGeminiModels', () => {
  it('keeps chat models, drops speech/image/agent ones and non-Gemini ids', () => {
    const ids = pickGeminiModels({
      models: [
        entry('gemini-3.5-flash'),
        entry('gemini-3.8-flash-tts'),
        entry('gemini-3.1-flash-image'),
        entry('gemini-nano-banana-2.1'),
        entry('gemma-4-31b-it'),
        entry('gemini-3.5-transcribe'),
        entry('deep-research-pro-preview-12-2025'),
        entry('gemini-embedding-001', ['embedContent']),
      ],
    });
    expect(ids).toEqual(['gemini-3.5-flash']);
  });

  it('puts flash before flash-lite before pro, newest first within a tier', () => {
    const ids = pickGeminiModels({
      models: [
        entry('gemini-3.1-pro-preview'),
        entry('gemini-2.5-flash'),
        entry('gemini-3.5-flash-lite'),
        entry('gemini-3.5-flash'),
        entry('gemini-3.7-flash'),
      ],
    });
    expect(ids).toEqual([
      'gemini-3.7-flash',
      'gemini-3.5-flash',
      'gemini-2.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-pro-preview',
    ]);
  });

  it('returns an empty list for a malformed response so the caller falls back to the defaults', () => {
    expect(pickGeminiModels(null)).toEqual([]);
    expect(pickGeminiModels({})).toEqual([]);
    expect(pickGeminiModels({ models: [{ name: 5 }, null] })).toEqual([]);
  });
});

describe('describeGeminiError', () => {
  it('names the retired model instead of leaving the API-key hint', () => {
    const msg = 'models/gemini-1.5-flash is not found for API version v1beta, or is not supported for generateContent.';
    expect(describeGeminiError(msg, 'gemini-1.5-flash')).toContain('gemini-1.5-flash');
    expect(describeGeminiError(msg, 'gemini-1.5-flash')).toContain('no longer available');
  });

  it('leaves other errors untouched', () => {
    expect(describeGeminiError('API key not valid.', 'gemini-3.5-flash')).toBe('API key not valid.');
  });
});

describe('DEFAULT_GEMINI_MODELS', () => {
  it('has no retired 1.x or 2.0 ids', () => {
    expect(DEFAULT_GEMINI_MODELS.some((m) => /gemini-(1\.|2\.0)/.test(m))).toBe(false);
  });
});
