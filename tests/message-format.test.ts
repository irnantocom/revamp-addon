// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { acceptedFileTypes, getCapabilities, providerLabel } from '../src/ai/capabilities';
import {
  contentToText,
  estimateRequestBytes,
  toClaudeRequest,
  toGeminiRequest,
  toOpenAIMessages,
} from '../src/ai/message-format';
import type { AIMessage } from '../src/ai/provider-interface';

const withParts: AIMessage = {
  role: 'user',
  content: [
    { type: 'text', text: 'look' },
    { type: 'image', mime: 'image/png', data: 'AAA' },
    { type: 'pdf', name: 'a.pdf', data: 'BBB' },
  ],
};

describe('getCapabilities', () => {
  it('returns what each implemented provider accepts', () => {
    expect(getCapabilities('openai')).toEqual({ image: true, pdf: true });
    expect(getCapabilities('claude')).toEqual({ image: true, pdf: true });
    expect(getCapabilities('gemini')).toEqual({ image: true, pdf: true });
    expect(getCapabilities('azure')).toEqual({ image: true, pdf: false });
  });

  it('accepts nothing for providers without an adapter and for unknown names', () => {
    expect(getCapabilities('perplexity')).toEqual({ image: false, pdf: false });
    expect(getCapabilities('nope')).toEqual({ image: false, pdf: false });
  });
});

describe('providerLabel and acceptedFileTypes', () => {
  it('names providers for the user and falls back to the raw name', () => {
    expect(providerLabel('azure')).toBe('Azure OpenAI');
    expect(providerLabel('openai')).toBe('OpenAI');
    expect(providerLabel('claude')).toBe('Claude');
    expect(providerLabel('gemini')).toBe('Gemini');
    expect(providerLabel('other')).toBe('other');
  });

  it('lists only the file types the provider can use, documents always', () => {
    const all = acceptedFileTypes({ image: true, pdf: true }).split(',');
    expect(all).toEqual(expect.arrayContaining(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'application/pdf', '.docx', '.txt']));

    const noPdf = acceptedFileTypes({ image: true, pdf: false }).split(',');
    expect(noPdf).not.toContain('application/pdf');
    expect(noPdf).toContain('image/png');

    const none = acceptedFileTypes({ image: false, pdf: false }).split(',');
    expect(none).toEqual(['.txt', '.md', '.csv', '.json', '.html', '.docx']);
  });
});

describe('contentToText', () => {
  it('joins text parts and ignores files', () => {
    expect(
      contentToText([
        { type: 'text', text: 'a' },
        { type: 'image', mime: 'image/png', data: 'x' },
        { type: 'text', text: 'b' },
      ])
    ).toBe('a\nb');
  });

  it('returns a string unchanged', () => {
    expect(contentToText('hi')).toBe('hi');
  });
});

describe('toOpenAIMessages', () => {
  it('leaves string messages exactly as they are', () => {
    expect(toOpenAIMessages([{ role: 'user', content: 'hi' }])).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('maps text, image and pdf parts to the chat completions format', () => {
    expect(toOpenAIMessages([withParts])[0].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      { type: 'file', file: { filename: 'a.pdf', file_data: 'data:application/pdf;base64,BBB' } },
    ]);
  });
});

describe('toClaudeRequest', () => {
  it('moves the system message to `system` as plain text, even when it is a parts array', () => {
    const result = toClaudeRequest([
      { role: 'system', content: [{ type: 'text', text: 'rules' }] },
      { role: 'user', content: 'hi' },
    ]);
    expect(result.system).toBe('rules');
    expect(result.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('omits `system` when there is none', () => {
    expect(toClaudeRequest([{ role: 'user', content: 'hi' }])).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
  });

  it('maps image and pdf parts to image and document blocks', () => {
    expect(toClaudeRequest([withParts]).messages[0].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBB' } },
    ]);
  });
});

describe('toGeminiRequest', () => {
  it('maps roles, inline data and the system instruction', () => {
    const result = toGeminiRequest([
      { role: 'system', content: 'rules' },
      withParts,
      { role: 'assistant', content: 'ok' },
    ]);
    expect(result.systemInstruction).toEqual({ parts: [{ text: 'rules' }] });
    expect(result.contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'look' },
          { inlineData: { mimeType: 'image/png', data: 'AAA' } },
          { inlineData: { mimeType: 'application/pdf', data: 'BBB' } },
        ],
      },
      { role: 'model', parts: [{ text: 'ok' }] },
    ]);
  });

  it('omits the system instruction when there is none', () => {
    expect(toGeminiRequest([{ role: 'user', content: 'hi' }]).systemInstruction).toBeUndefined();
  });
});

describe('estimateRequestBytes', () => {
  it('counts base64 data and text', () => {
    expect(estimateRequestBytes([withParts, { role: 'assistant', content: 'four' }])).toBe(4 + 3 + 3 + 4);
  });

  it('is 0 for no messages', () => {
    expect(estimateRequestBytes([])).toBe(0);
  });
});
