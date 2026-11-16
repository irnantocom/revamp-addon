// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../src/ai/openai-provider';
import { AzureOpenAIProvider } from '../src/ai/azure-openai-provider';
import { GeminiProvider } from '../src/ai/gemini-provider';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const audio = { audioBase64: btoa('RIFFdata'), mimeType: 'audio/wav', model: 'whisper-1', language: 'id' };

afterEach(() => vi.unstubAllGlobals());

describe('transcribeAudio', () => {
  it('OpenAI posts a multipart file with the model and language', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { text: ' halo dunia ' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new OpenAIProvider({ apiKey: 'k' }).transcribeAudio(audio);

    expect(result).toEqual({ success: true, text: 'halo dunia' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(init.headers.Authorization).toBe('Bearer k');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('id');
    expect((form.get('file') as File).size).toBe(8);
  });

  it('OpenAI returns the API error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { error: { message: 'bad key' } })));
    const result = await new OpenAIProvider({ apiKey: 'k' }).transcribeAudio(audio);
    expect(result).toEqual({ success: false, error: 'bad key' });
  });

  it('Azure uses the transcription deployment in the URL and no model field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { text: 'hi' }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new AzureOpenAIProvider({
      apiKey: ' key ',
      endpoint: 'https://res.openai.azure.com/',
      apiVersion: '2024-12-01-preview',
      deployment: 'chat-dep',
    });

    const result = await provider.transcribeAudio({ ...audio, model: 'whisper-dep' });

    expect(result).toEqual({ success: true, text: 'hi' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://res.openai.azure.com/openai/deployments/whisper-dep/audio/transcriptions?api-version=2024-12-01-preview');
    expect(init.headers['api-key']).toBe('key');
    expect((init.body as FormData).get('model')).toBeNull();
  });

  it('Azure names the deployment when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(404, { error: { message: 'DeploymentNotFound' } })));
    const provider = new AzureOpenAIProvider({ apiKey: 'k', endpoint: 'https://r.openai.azure.com', apiVersion: 'v', deployment: 'd' });
    const result = await provider.transcribeAudio({ ...audio, model: 'whisper-dep' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('whisper-dep');
    expect(result.error).toContain('HTTP 404');
  });

  it('Gemini sends inline audio, keeps the key out of the URL and joins the text parts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { candidates: [{ content: { parts: [{ text: 'a ' }, { text: 'b' }] } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GeminiProvider({ apiKey: 'secret' }).transcribeAudio({ ...audio, model: 'gemini-2.5-flash' });

    expect(result).toEqual({ success: true, text: 'a b' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain('secret');
    expect(init.headers['x-goog-api-key']).toBe('secret');
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[1].inlineData).toEqual({ mimeType: 'audio/wav', data: audio.audioBase64 });
  });
});
