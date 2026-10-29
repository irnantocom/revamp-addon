/**
 * Azure OpenAI Provider Adapter
 * Implements IAIProvider for Azure OpenAI deployments (custom endpoint)
 */

import { IAIProvider, AIMessage, AIResponse, AIProviderConfig } from './provider-interface';
import { toOpenAIMessages } from './message-format';

export interface AzureOpenAIConfig extends AIProviderConfig {
  endpoint: string;
  apiVersion: string;
  deployment: string;
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
      const { url, deployment } = this.buildRequest(model);
      let tokenParam: 'max_tokens' | 'max_completion_tokens' = 'max_tokens';
      let sendTemperature = true;
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
            [tokenParam]: options?.maxTokens ?? 2000,
            stream: false,
          }),
        });

      let response = await send();

      // Reasoning deployments reject max_tokens (want max_completion_tokens) and any
      // temperature other than the default; adapt to whichever the model complains about.
      for (let attempt = 0; attempt < 2 && response.status === 400; attempt++) {
        const body = await response.clone().json().catch(() => ({}));
        const message: string = body?.error?.message || '';
        if (tokenParam === 'max_tokens' && /max_completion_tokens/i.test(message)) {
          tokenParam = 'max_completion_tokens';
        } else if (sendTemperature && /temperature/i.test(message)) {
          sendTemperature = false;
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
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Azure OpenAI request failed: ${error}`,
      };
    }
  }

  /**
   * Build the request URL. Accepts a bare resource endpoint, but also copes with a pasted
   * full request URL (".../openai/deployments/<name>/chat/completions?api-version=...").
   */
  private buildRequest(model: string): { url: string; deployment: string } {
    let endpoint = this.config.endpoint.trim();
    let deployment = (this.config.deployment || model || '').trim();
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
      url: `${endpoint.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
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
