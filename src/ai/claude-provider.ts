/**
 * Anthropic Claude Provider Adapter
 * Implements IAIProvider for Anthropic Claude API
 */

import { IAIProvider, AIMessage, AIResponse, AIProviderConfig } from './provider-interface';
import { toClaudeRequest } from './message-format';

export class ClaudeProvider implements IAIProvider {
  name = 'Claude';
  models = ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229'];

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
      // Claude API requires system messages to be separate
      const { system, messages: conversationMessages } = toClaudeRequest(messages);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          messages: conversationMessages,
          ...(system !== undefined && { system }),
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 2000,
          stream: options?.stream ?? false,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return {
          success: false,
          error: error.error?.message || 'Claude API request failed',
        };
      }

      const data = await response.json();
      
      return {
        success: true,
        content: data.content[0]?.text || '',
        usage: {
          promptTokens: data.usage?.input_tokens || 0,
          completionTokens: data.usage?.output_tokens || 0,
          totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Claude request failed: ${error}`,
      };
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      // Test with a minimal request
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-sonnet-20240229',
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1,
        }),
      });
      return response.ok || response.status === 400; // 400 means API key is valid but request format issue
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    // Claude doesn't have a models endpoint, return predefined list
    return this.models;
  }
}
