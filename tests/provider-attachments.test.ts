// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../src/ai/openai-provider';
import { AzureOpenAIProvider } from '../src/ai/azure-openai-provider';
import { ClaudeProvider } from '../src/ai/claude-provider';
import { GeminiProvider } from '../src/ai/gemini-provider';
import { assertPayloadSize } from '../src/background/payload-guard';
import type { AIMessage } from '../src/ai/provider-interface';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse(fetchMock.mock.calls[0][1].body);

const withFiles: AIMessage[] = [
  { role: 'system', content: 'rules' },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'look' },
      { type: 'image', mime: 'image/png', data: 'AAA' },
      { type: 'pdf', name: 'a.pdf', data: 'BBB' },
    ],
  },
];

afterEach(() => vi.unstubAllGlobals());

describe('providers send attachments', () => {
  it('OpenAI maps parts to image_url and file parts and leaves string messages alone', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    await new OpenAIProvider({ apiKey: 'k' }).generateCompletion(withFiles, 'gpt-4o');
    const body = bodyOf(fetchMock);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'rules' });
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      { type: 'file', file: { filename: 'a.pdf', file_data: 'data:application/pdf;base64,BBB' } },
    ]);

    const plain: AIMessage[] = [{ role: 'user', content: 'hi' }];
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(json({ choices: [{ message: { content: 'ok' } }] }));
    await new OpenAIProvider({ apiKey: 'k' }).generateCompletion(plain, 'gpt-4o');
    expect(bodyOf(fetchMock).messages).toEqual(plain);
  });

  it('Azure sends the same shape to the deployment URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    await new AzureOpenAIProvider({
      apiKey: 'k', endpoint: 'https://r.openai.azure.com', apiVersion: '2024-12-01-preview', deployment: 'd',
    }).generateCompletion(withFiles, '');

    expect(fetchMock.mock.calls[0][0]).toContain('/openai/deployments/d/chat/completions');
    expect(bodyOf(fetchMock).messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } });
  });

  it('Claude sends system as a string and the PDF as a document block', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ content: [{ text: 'ok' }], usage: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await new ClaudeProvider({ apiKey: 'k' }).generateCompletion(withFiles, 'claude-3-5-sonnet-20241022');
    const body = bodyOf(fetchMock);
    expect(body.system).toBe('rules');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } });
    expect(body.messages[0].content[2].type).toBe('document');
  });

  it('Gemini sends attachments as inlineData', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    await new GeminiProvider({ apiKey: 'k' }).generateCompletion(withFiles, 'gemini-1.5-pro');
    const body = bodyOf(fetchMock);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'rules' }] });
    expect(body.contents[0].parts).toContainEqual({ inlineData: { mimeType: 'image/png', data: 'AAA' } });
    expect(body.contents[0].parts).toContainEqual({ inlineData: { mimeType: 'application/pdf', data: 'BBB' } });
  });
});

describe('assertPayloadSize', () => {
  it('rejects a request over 20 MB with a readable message', () => {
    const big: AIMessage[] = [{ role: 'user', content: [{ type: 'image', mime: 'image/png', data: 'x'.repeat(21 * 1024 * 1024) }] }];
    expect(assertPayloadSize(big)).toMatch(/too large/i);
  });

  it('accepts a normal request', () => {
    expect(assertPayloadSize(withFiles)).toBeNull();
  });
});
