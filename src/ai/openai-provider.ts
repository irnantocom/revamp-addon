/**
 * OpenAI Provider Adapter
 * Implements IAIProvider for OpenAI API
 */

import { IAIProvider, AIMessage, AIResponse, AIProviderConfig } from './provider-interface';
import { toOpenAIMessages } from './message-format';

export class OpenAIProvider implements IAIProvider {
  name = 'OpenAI';
  models = ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];

  constructor(private config: AIProviderConfig) {}

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
      let tokenParam: 'max_tokens' | 'max_completion_tokens' = 'max_tokens';
      let sendTemperature = true;
      let tokenLimit = options?.maxTokens ?? 2000;
      const send = () =>
        fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
            ...(this.config.organizationId && {
              'OpenAI-Organization': this.config.organizationId,
            }),
          },
          body: JSON.stringify({
            model,
            messages: toOpenAIMessages(messages),
            ...(sendTemperature && { temperature: options?.temperature ?? 0.7 }),
            [tokenParam]: tokenLimit,
            stream: options?.stream ?? false,
          }),
        });

      let response = await send();

      // Reasoning models (o-series, gpt-5) reject max_tokens (want max_completion_tokens)
      // and any temperature other than the default, and each has its own output ceiling; adapt to whichever the model complains about.
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
        return {
          success: false,
          error: error.error?.message || 'OpenAI API request failed',
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
        error: `OpenAI request failed: ${error}`,
      };
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) return this.models;

      const data = await response.json();
      return data.data
        .filter((model: any) => model.id.includes('gpt'))
        .map((model: any) => model.id);
    } catch {
      return this.models;
    }
  }
}
