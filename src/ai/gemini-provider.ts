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
              maxOutputTokens: options?.maxTokens ?? 8192,
              // response_mime_type: 'application/json',
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
      
      // Log full response for debugging
      console.log('[Gemini] Full API response:', JSON.stringify(data, null, 2));
      
      // Check for prompt feedback (safety filters, blocked prompts)
      if (data.promptFeedback) {
        const feedback = data.promptFeedback;
        if (feedback.blockReason) {
          console.error('[Gemini] Prompt blocked:', feedback.blockReason);
          return {
            success: false,
            error: `Gemini blocked the prompt: ${feedback.blockReason}. Try rephrasing your request.`,
          };
        }
        if (feedback.safetyRatings) {
          console.warn('[Gemini] Safety ratings:', feedback.safetyRatings);
        }
      }
      
      // Validate response structure
      if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
        console.error('[Gemini] Invalid response structure - no candidates:', JSON.stringify(data, null, 2));
        return {
          success: false,
          error: 'Invalid response from Gemini API: no candidates returned. ' + 
                 (data.error?.message || data.promptFeedback?.blockReason || 'The model may have refused to generate content.'),
        };
      }

      const candidate = data.candidates[0];
      console.log('[Gemini] First candidate:', JSON.stringify(candidate, null, 2));
      
      // Check finish reason
      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        console.warn('[Gemini] Unusual finish reason:', candidate.finishReason);
        
        if (candidate.finishReason === 'SAFETY') {
          return {
            success: false,
            error: 'Gemini blocked the response due to safety concerns. Try a different request.',
          };
        }
        
        if (candidate.finishReason === 'RECITATION') {
          return {
            success: false,
            error: 'Gemini blocked the response due to recitation concerns.',
          };
        }
        
        if (candidate.finishReason === 'MAX_TOKENS') {
          console.warn('[Gemini] Response truncated at MAX_TOKENS');
          console.warn('[Gemini] Token usage:', JSON.stringify(data.usageMetadata, null, 2));
          
          // For experimental models with thoughts, warn about token distribution
          if (data.usageMetadata?.thoughtsTokenCount) {
            console.warn(`[Gemini] Model used ${data.usageMetadata.thoughtsTokenCount} tokens for internal reasoning`);
            console.warn(`[Gemini] Only ${data.usageMetadata.candidatesTokenCount} tokens for output`);
            console.warn('[Gemini] Try using a non-experimental model or increase maxTokens');
          }
          
          // Continue - we can still try to parse partial response
        }
      }
      
      // Validate content structure with multiple fallback paths
      if (!candidate.content) {
        console.error('[Gemini] Candidate missing content field:', JSON.stringify(candidate, null, 2));
        return {
          success: false,
          error: `Invalid response from Gemini API: candidate has no content field. Finish reason: ${candidate.finishReason || 'unknown'}`,
        };
      }
      
      // Try multiple ways to extract text (Gemini response structure varies)
      let text = '';
      
      // Method 1: Standard parts array
      if (candidate.content.parts && Array.isArray(candidate.content.parts) && candidate.content.parts.length > 0) {
        text = candidate.content.parts[0]?.text || '';
        console.log('[Gemini] Extracted text from parts array');
      }
      
      // Method 2: Direct text field in content
      if (!text && candidate.content.text) {
        text = candidate.content.text;
        console.log('[Gemini] Extracted text from content.text');
      }
      
      // Method 3: Text field at candidate level
      if (!text && candidate.text) {
        text = candidate.text;
        console.log('[Gemini] Extracted text from candidate.text');
      }
      
      // Method 4: Message field (some Gemini responses use this)
      if (!text && candidate.message?.content) {
        text = candidate.message.content;
        console.log('[Gemini] Extracted text from candidate.message.content');
      }
      
      // Method 5: Output field (alternative structure)
      if (!text && candidate.output) {
        text = typeof candidate.output === 'string' ? candidate.output : candidate.output.text || '';
        console.log('[Gemini] Extracted text from candidate.output');
      }
      
      if (!text || text.trim() === '') {
        console.error('[Gemini] All extraction methods failed. Candidate structure:', JSON.stringify(candidate, null, 2));
        return {
          success: false,
          error: 'Gemini API returned empty text content. The response may have been filtered or blocked.',
        };
      }
      
      console.log('[Gemini] Successfully extracted text, length:', text.length);
      console.log('[Gemini] Raw response text (first 2000 chars):', text.substring(0, 2000));
      console.log('[Gemini] Raw response text (last 500 chars):', text.substring(Math.max(0, text.length - 500)));
      
      return {
        success: true,
        content: text,
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount || 0,
          completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata?.totalTokenCount || 0,
        },
      };
    } catch (error) {
      console.error('[Gemini] Request error:', error);
      return {
        success: false,
        error: `Gemini request failed: ${error instanceof Error ? error.message : String(error)}`,
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
