// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../src/ai/openai-provider';
import { AzureOpenAIProvider } from '../src/ai/azure-openai-provider';
import { ClaudeProvider } from '../src/ai/claude-provider';
import { GeminiProvider } from '../src/ai/gemini-provider';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const msgs = [{ role: 'user' as const, content: 'x' }];
const azure = { apiKey: 'k', endpoint: 'https://r.openai.azure.com', apiVersion: '2024-12-01-preview', deployment: 'd' };

const chat = (finish: string) => ({ choices: [{ message: { content: 'partial' }, finish_reason: finish }], usage: {} });
const claude = (stop: string) => ({ content: [{ text: 'partial' }], stop_reason: stop, usage: {} });
const gemini = (finish: string) => ({ candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: finish }], usageMetadata: {} });

const providers: Array<[string, (reply: unknown) => Promise<{ truncated?: boolean; success: boolean }>, (done: boolean) => unknown]> = [
  ['OpenAI', (r) => (vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(r))), new OpenAIProvider({ apiKey: 'k' }).generateCompletion(msgs, 'm')), (d) => chat(d ? 'stop' : 'length')],
  ['Azure OpenAI', (r) => (vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(r))), new AzureOpenAIProvider(azure).generateCompletion(msgs, 'm')), (d) => chat(d ? 'stop' : 'length')],
  ['Claude', (r) => (vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(r))), new ClaudeProvider({ apiKey: 'k' }).generateCompletion(msgs, 'm')), (d) => claude(d ? 'end_turn' : 'max_tokens')],
  ['Gemini', (r) => (vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(r))), new GeminiProvider({ apiKey: 'k' }).generateCompletion(msgs, 'm')), (d) => gemini(d ? 'STOP' : 'MAX_TOKENS')],
];

afterEach(() => vi.unstubAllGlobals());

describe.each(providers)('%s', (_name, call, reply) => {
  it('flags a reply that stopped at the output limit', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await call(reply(false));

    expect(result).toMatchObject({ success: true, truncated: true });
  });

  it('leaves the flag off for a finished reply', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await call(reply(true));

    expect(result.success).toBe(true);
    expect(result.truncated).toBeUndefined();
  });
});
