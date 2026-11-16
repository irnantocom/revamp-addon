/**
 * Azure OpenAI Provider Adapter
 * Implements IAIProvider for Azure OpenAI deployments (custom endpoint)
 */

import { IAIProvider, AIMessage, AIResponse, AIProviderConfig, TranscribeRequest, TranscribeResponse } from './provider-interface';
import { audioFormData } from './transcription';
import { toOpenAIMessages } from './message-format';

export interface AzureOpenAIConfig extends AIProviderConfig {
  endpoint: string;
  apiVersion: string;
  deployment: string;
}

/** The Deployment setting holds one or more deployment names, separated by commas or new lines */
export function parseAzureDeployments(setting: unknown): string[] {
  if (typeof setting !== 'string') return [];
  return Array.from(new Set(setting.split(/[,\n]/).map((name) => name.trim()).filter(Boolean)));
}

/** The deployment picked in the chat when it is one of the configured ones, otherwise the first */
export function pickAzureDeployment(setting: unknown, requested: string | undefined): string | undefined {
  const deployments = parseAzureDeployments(setting);
  const wanted = requested?.trim();
  return wanted && deployments.includes(wanted) ? wanted : deployments[0];
}

export class AzureOpenAIProvider implements IAIProvider {
  name = 'Azure OpenAI';
  models: string[];

  constructor(private config: AzureOpenAIConfig) {
    this.models = config.deployment ? [config.deployment] : [];
  }

  async generateCompletion(
    messages: AIMessage[],
    model: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    }
  ): Promise<AIResponse> {
    try {
      const { url, deployment } = this.buildRequest(model, 'chat/completions');
      let tokenParam: 'max_tokens' | 'max_completion_tokens' = 'max_tokens';
      let sendTemperature = true;
      let tokenLimit = options?.maxTokens ?? 2000;
      const send = () =>
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': this.config.apiKey.trim(),
          },
          body: JSON.stringify({
            messages: toOpenAIMessages(messages),
            ...(sendTemperature && { temperature: options?.temperature ?? 0.7 }),
            [tokenParam]: tokenLimit,
            stream: false,
          }),
        });

      let response = await send();

      // Reasoning deployments reject max_tokens (want max_completion_tokens) and any
      // temperature other than the default, and each has its own output ceiling; adapt to whichever the model complains about.
      for (let attempt = 0; attempt < 3 && response.status === 400; attempt++) {
        const body = await response.clone().json().catch(() => ({}));
        const message: string = body?.error?.message || '';
        if (tokenParam === 'max_tokens' && /max_completion_tokens/i.test(message)) {
          tokenParam = 'max_completion_tokens';
        } else if (sendTemperature && /temperature/i.test(message)) {
          sendTemperature = false;
        } else if (Number(/supports at most (\d+)/i.exec(message)?.[1]) < tokenLimit) {
          // "max_tokens is too large: 32768. This model supports at most 16384 completion tokens"
          tokenLimit = Number(/supports at most (\d+)/i.exec(message)![1]);
        } else {
          break;
        }
        response = await send();
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const hint =
          response.status === 404
            ? ` Check that deployment "${deployment}" exists in this resource and the endpoint is the resource root (https://<name>.openai.azure.com). Behind a gateway such as API Management, include its base path in the endpoint (https://<name>.azure-api.net/<path>).`
            : response.status === 401
            ? ' The API key was rejected.'
            : '';
        // Gateways answer with a flat { statusCode, message } instead of Azure's { error: { message } }
        return {
          success: false,
          error: `${error.error?.message || error.message || 'Azure OpenAI request failed'} (HTTP ${response.status}, ${url.split('?')[0]}).${hint}`,
        };
      }

      const data = await response.json();

      return {
        success: true,
        content: data.choices[0]?.message?.content || '',
        ...(data.choices[0]?.finish_reason === 'length' && { truncated: true }),
        ...(data.choices[0]?.finish_reason && { finishReason: String(data.choices[0].finish_reason) }),
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
          ...(data.usage?.completion_tokens_details?.reasoning_tokens > 0 && {
            reasoningTokens: data.usage.completion_tokens_details.reasoning_tokens,
          }),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Azure OpenAI request failed: ${error}`,
      };
    }
  }

  /** `request.model` is the transcription deployment (a Whisper or transcribe model), not a chat one */
  async transcribeAudio(request: TranscribeRequest): Promise<TranscribeResponse> {
    try {
      const { url } = this.buildRequest(request.model, 'audio/transcriptions', true);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'api-key': this.config.apiKey.trim() },
        body: audioFormData(request, false),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          success: false,
          error: `${data.error?.message || 'Azure OpenAI transcription failed'} (HTTP ${response.status}). Check that "${request.model}" is a transcription deployment (Whisper) in this resource.`,
        };
      }
      return { success: true, text: String(data.text ?? '').trim() };
    } catch (error) {
      return { success: false, error: `Azure OpenAI transcription failed: ${error}` };
    }
  }

  /**
   * Build the request URL. Accepts a bare resource endpoint, but also copes with a pasted
   * full request URL (".../openai/deployments/<name>/chat/completions?api-version=...").
   */
  private buildRequest(model: string, operation: string, preferModel = false): { url: string; deployment: string } {
    let endpoint = this.config.endpoint.trim();
    // Chat uses the configured deployment; transcription names its own (a different model)
    let deployment = (preferModel ? model || this.config.deployment : this.config.deployment || model || '').trim();
    let apiVersion = this.config.apiVersion.trim();

    // Keep any path before "/openai": gateways such as API Management serve the API under a
    // base path (https://<name>.azure-api.net/<suffix>/openai/...), and dropping it gives a 404.
    const pasted = endpoint.match(/^(https?:\/\/[^/?#]+)((?:\/(?!openai(?:\/|\?|#|$))[^/?#]+)*)(?:\/openai(?:\/deployments\/([^/?#]+))?[^?#]*)?[^?#]*(?:\?([^#]*))?/i);
    if (pasted) {
      endpoint = pasted[1] + pasted[2];
      if (!deployment && pasted[3]) deployment = decodeURIComponent(pasted[3]);
      const version = new URLSearchParams(pasted[4] || '').get('api-version');
      if (version && !apiVersion) apiVersion = version;
    }

    return {
      url: `${endpoint.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/${operation}?api-version=${encodeURIComponent(apiVersion)}`,
      deployment,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    return apiKey.trim().length > 0;
  }

  async getAvailableModels(): Promise<string[]> {
    return this.models;
  }
}
