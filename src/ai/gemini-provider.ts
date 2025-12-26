/**
 * Google Gemini Provider Adapter
 * Implements IAIProvider for Google Gemini API
 */

import { IAIProvider, AIMessage, AIResponse, AIProviderConfig } from './provider-interface';

export class GeminiProvider implements IAIProvider {
  name = 'Gemini';
  models = ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'];

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
      // Convert messages to Gemini format
      const contents = messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const systemInstruction = messages.find(m => m.role === 'system');

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents,
            ...(systemInstruction && {
              systemInstruction: { parts: [{ text: systemInstruction.content }] },
            }),
            generationConfig: {
              temperature: options?.temperature ?? 0.7,
              maxOutputTokens: options?.maxTokens ?? 2000,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        return {
          success: false,
          error: error.error?.message || 'Gemini API request failed',
        };
      }

      const data = await response.json();
      
      return {
        success: true,
        content: data.candidates[0]?.content?.parts[0]?.text || '',
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount || 0,
          completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata?.totalTokenCount || 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Gemini request failed: ${error}`,
      };
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.config.apiKey}`
      );

      if (!response.ok) return this.models;

      const data = await response.json();
      return data.models
        .filter((model: any) => model.name.includes('gemini'))
        .map((model: any) => model.name.replace('models/', ''));
    } catch {
      return this.models;
    }
  }
}
