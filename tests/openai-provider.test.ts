// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../src/ai/openai-provider';

const ok = { choices: [{ message: { content: 'hi' } }], usage: { total_tokens: 3 } };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const msgs = [{ role: 'user' as const, content: 'x' }];
const provider = () => new OpenAIProvider({ apiKey: 'key' });
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

afterEach(() => vi.unstubAllGlobals());

describe('OpenAIProvider', () => {
  it('sends temperature and max_tokens by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, ok));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().generateCompletion(msgs, 'gpt-4o', { temperature: 0.3, maxTokens: 50 });

    expect(result).toMatchObject({ success: true, content: 'hi' });
    expect(bodyOf(fetchMock, 0)).toMatchObject({ temperature: 0.3, max_tokens: 50 });
  });

  it('retries without temperature when the model only supports the default', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(400, { error: { message: "Unsupported value: 'temperature' does not support 0.3 with this model. Only the default (1) value is supported." } }))
      .mockResolvedValueOnce(json(200, ok));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().generateCompletion(msgs, 'gpt-5', { temperature: 0.3 });

    expect(result.success).toBe(true);
    expect(bodyOf(fetchMock, 1).temperature).toBeUndefined();
  });

  it('adapts to both max_tokens and temperature being rejected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }))
      .mockResolvedValueOnce(json(400, { error: { message: "Unsupported value: 'temperature' does not support 0.3 with this model." } }))
      .mockResolvedValueOnce(json(200, ok));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().generateCompletion(msgs, 'o3', { temperature: 0.3, maxTokens: 50 });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bodyOf(fetchMock, 2)).toMatchObject({ max_completion_tokens: 50 });
    expect(bodyOf(fetchMock, 2).max_tokens).toBeUndefined();
    expect(bodyOf(fetchMock, 2).temperature).toBeUndefined();
  });

  it('lowers the token limit to the ceiling the model reports', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(400, { error: { message: 'max_tokens is too large: 32768. This model supports at most 16384 completion tokens, whereas you provided 32768.' } }))
      .mockResolvedValueOnce(json(200, ok));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().generateCompletion(msgs, 'gpt-4o', { maxTokens: 32768 });

    expect(result.success).toBe(true);
    expect(bodyOf(fetchMock, 1)).toMatchObject({ max_tokens: 16384 });
  });

  it('reports why the model stopped and how many tokens went to reasoning', async () => {
    const reply = { choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { completion_tokens: 8192, completion_tokens_details: { reasoning_tokens: 8192 } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, reply)));

    const result = await provider().generateCompletion(msgs, 'o3');

    expect(result).toMatchObject({ success: true, content: '', truncated: true, finishReason: 'length', usage: { completionTokens: 8192, reasoningTokens: 8192 } });
  });

  it('returns other 400 errors unchanged without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(400, { error: { message: 'Invalid model' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().generateCompletion(msgs, 'nope');

    expect(result).toEqual({ success: false, error: 'Invalid model' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
