/**
 * AI Provider Adapter Interface
 * Provider-agnostic abstraction for multiple AI services
 */

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIRequest {
  provider: 'openai' | 'claude' | 'gemini' | 'perplexity' | 'mistral' | 'cohere' | 'groq' | 'openrouter';
  model: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface AIResponse {
  success: boolean;
  content?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIProviderConfig {
  apiKey: string;
  baseURL?: string;
  organizationId?: string;
}

/**
 * Base interface that all AI providers must implement
 */
export interface IAIProvider {
  name: string;
  models: string[];
  
  /**
   * Generate completion from messages
   */
  generateCompletion(
    messages: AIMessage[],
    model: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    }
  ): Promise<AIResponse>;

  /**
   * Validate API key
   */
  validateApiKey(apiKey: string): Promise<boolean>;

  /**
   * Get available models
   */
  getAvailableModels(): Promise<string[]>;
}

/**
 * AI Provider Factory
 */
export class AIProviderFactory {
  private static providers = new Map<string, IAIProvider>();

  static register(name: string, provider: IAIProvider): void {
    this.providers.set(name, provider);
  }

  static get(name: string): IAIProvider | undefined {
    return this.providers.get(name);
  }

  static getAll(): Map<string, IAIProvider> {
    return this.providers;
  }
}
