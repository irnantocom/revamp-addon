/**
 * Azure OpenAI Provider Adapter
 * Implements IAIProvider for Azure OpenAI deployments (custom endpoint)
 */

import { IAIProvider, AIMessage, AIResponse, AIProviderConfig } from './provider-interface';

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
      // Azure routes by deployment name; the configured deployment always wins
      // over the chat's model dropdown (which may hold a stale non-Azure model)
      const deployment = (this.config.deployment || model).trim();
      const base = this.config.endpoint.trim().replace(/\/+$/, '');
      const url = `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(this.config.apiVersion.trim())}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.config.apiKey.trim(),
        },
        body: JSON.stringify({
          messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 2000,
          stream: false,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return {
          success: false,
          error: `${error.error?.message || 'Azure OpenAI request failed'} (HTTP ${response.status}, ${url.split('?')[0]})`,
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

  async validateApiKey(apiKey: string): Promise<boolean> {
    return apiKey.trim().length > 0;
  }

  async getAvailableModels(): Promise<string[]> {
    return this.models;
  }
}
