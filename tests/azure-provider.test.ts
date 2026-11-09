// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AzureOpenAIProvider } from '../src/ai/azure-openai-provider';

const base = {
  apiKey: ' key ',
  endpoint: 'https://clloh-n8n.openai.azure.com/ ',
  apiVersion: '2024-12-01-preview',
  deployment: 'clloh-n8n-gpt-4.1-mini',
};
const ok = { choices: [{ message: { content: 'hi' } }], usage: { total_tokens: 3 } };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const msgs = [{ role: 'user' as const, content: 'x' }];

afterEach(() => vi.unstubAllGlobals());

describe('AzureOpenAIProvider', () => {
  it('calls the deployment URL with trimmed values and the api-key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, ok));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AzureOpenAIProvider(base).generateCompletion(msgs, 'gpt-4o');

    expect(result).toMatchObject({ success: true, content: 'hi' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://clloh-n8n.openai.azure.com/openai/deployments/clloh-n8n-gpt-4.1-mini/chat/completions?api-version=2024-12-01-preview');
    expect(init.headers['api-key']).toBe('key');
  });

  it('accepts a pasted full request URL as the endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, ok));
    vi.stubGlobal('fetch', fetchMock);

    await new AzureOpenAIProvider({
      ...base,
      endpoint: 'https://r.openai.azure.com/openai/deployments/other/chat/completions?api-version=2023-05-15',
    }).generateCompletion(msgs, '');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://r.openai.azure.com/openai/deployments/clloh-n8n-gpt-4.1-mini/chat/completions?api-version=2024-12-01-preview'
    );
  });

  it('lowers the token limit to the ceiling the deployment reports', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(400, { error: { message: 'max_tokens is too large: 32768. This model supports at most 4096 completion tokens, whereas you provided 32768.' } }))
      .mockResolvedValueOnce(json(200, ok));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AzureOpenAIProvider(base).generateCompletion(msgs, '', { maxTokens: 32768 });

    expect(result.success).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ max_tokens: 4096 });
  });

  it('keeps a gateway base path in front of /openai', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, ok));
    vi.stubGlobal('fetch', fetchMock);

    for (const endpoint of [
      'https://team.azure-api.net/ai/',
      'https://team.azure-api.net/ai/openai/deployments/x/chat/completions?api-version=2024-02-01',
    ]) {
      await new AzureOpenAIProvider({ ...base, endpoint }).generateCompletion(msgs, '');
    }

    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toBe(
        'https://team.azure-api.net/ai/openai/deployments/clloh-n8n-gpt-4.1-mini/chat/completions?api-version=2024-12-01-preview'
      );
    }
  });

  it('shows the message from a gateway error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(404, { statusCode: 404, message: 'Resource not found' })));

    const result = await new AzureOpenAIProvider(base).generateCompletion(msgs, '');

    expect(result.error).toContain('Resource not found (HTTP 404');
  });

  it('retries with max_completion_tokens when the model rejects max_tokens', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(400, { error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } }))
      .mockResolvedValueOnce(json(200, ok));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AzureOpenAIProvider(base).generateCompletion(msgs, '', { maxTokens: 50 });

    expect(result.success).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ max_completion_tokens: 50 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).max_tokens).toBeUndefined();
  });

  it('retries without temperature when the model only supports the default', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(400, { error: { message: "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported." } }))
      .mockResolvedValueOnce(json(200, ok));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AzureOpenAIProvider(base).generateCompletion(msgs, '', { temperature: 0 });

    expect(result.success).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).temperature).toBe(0);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).temperature).toBeUndefined();
  });

  it('adapts to both max_tokens and temperature being rejected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(400, { error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } }))
      .mockResolvedValueOnce(json(400, { error: { message: "Unsupported value: 'temperature' does not support 0.3 with this model." } }))
      .mockResolvedValueOnce(json(200, ok));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AzureOpenAIProvider(base).generateCompletion(msgs, '', { temperature: 0.3, maxTokens: 50 });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ max_completion_tokens: 50 });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).temperature).toBeUndefined();
  });

  it('explains a 404 with the URL and the deployment name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(404, { error: { message: 'Resource not found' } })));

    const result = await new AzureOpenAIProvider(base).generateCompletion(msgs, '');

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 404');
    expect(result.error).toContain('/openai/deployments/clloh-n8n-gpt-4.1-mini/chat/completions');
    expect(result.error).toContain('deployment "clloh-n8n-gpt-4.1-mini" exists');
  });
});
