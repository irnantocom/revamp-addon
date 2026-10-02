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

  it('explains a 404 with the URL and the deployment name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(404, { error: { message: 'Resource not found' } })));

    const result = await new AzureOpenAIProvider(base).generateCompletion(msgs, '');

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 404');
    expect(result.error).toContain('/openai/deployments/clloh-n8n-gpt-4.1-mini/chat/completions');
    expect(result.error).toContain('deployment "clloh-n8n-gpt-4.1-mini" exists');
  });
});
