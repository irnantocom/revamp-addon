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

  it('returns other 400 errors unchanged without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(400, { error: { message: 'Invalid model' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().generateCompletion(msgs, 'nope');

    expect(result).toEqual({ success: false, error: 'Invalid model' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
