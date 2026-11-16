/**
 * AI Provider Adapter Interface
 * Provider-agnostic abstraction for multiple AI services
 */

import type { ContentPart } from '../types/attachments';

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  /** Plain text, or text plus attachments (images, PDFs) */
  content: string | ContentPart[];
}

export interface AIRequest {
  provider: 'openai' | 'azure' | 'claude' | 'gemini' | 'perplexity' | 'mistral' | 'cohere' | 'groq' | 'openrouter';
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
  /** The model stopped at the output token limit, so `content` may end mid-answer */
  truncated?: boolean;
  /** Why the model stopped, as the provider names it ("stop", "length", "content_filter", "max_tokens"...) */
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Part of completionTokens a reasoning model spent thinking; they leave no room for the answer */
    reasoningTokens?: number;
  };
}

/** One recorded clip to turn into text (16 kHz mono WAV, base64) */
export interface TranscribeRequest {
  audioBase64: string;
  mimeType: string;
  /** Model id, or the Azure transcription deployment name */
  model: string;
  /** ISO 639-1 hint such as "id"; omit to let the provider detect the language */
  language?: string;
}

export interface TranscribeResponse {
  success: boolean;
  text?: string;
  error?: string;
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
   * Speech to text. Optional: only providers with an audio endpoint implement it
   */
  transcribeAudio?(request: TranscribeRequest): Promise<TranscribeResponse>;

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
