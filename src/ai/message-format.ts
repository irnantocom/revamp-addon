import type { ContentPart } from '../types/attachments';
import type { AIMessage } from './provider-interface';

/** Upper bound for one request's attachments plus text; the service worker refuses anything larger */
export const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024;

export function contentToText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export function estimateRequestBytes(messages: AIMessage[]): number {
  let total = 0;
  for (const { content } of messages) {
    if (typeof content === 'string') {
      total += content.length;
      continue;
    }
    for (const part of content) total += part.type === 'text' ? part.text.length : part.data.length;
  }
  return total;
}

type OpenAIPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export function toOpenAIMessages(messages: AIMessage[]): Array<{ role: AIMessage['role']; content: string | OpenAIPart[] }> {
  return messages.map(({ role, content }) => ({
    role,
    content:
      typeof content === 'string'
        ? content
        : content.map((part): OpenAIPart => {
            if (part.type === 'text') return { type: 'text', text: part.text };
            if (part.type === 'image') return { type: 'image_url', image_url: { url: `data:${part.mime};base64,${part.data}` } };
            return { type: 'file', file: { filename: part.name, file_data: `data:application/pdf;base64,${part.data}` } };
          }),
  }));
}

type ClaudeBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeBlock[];
}

export function toClaudeRequest(messages: AIMessage[]): { system?: string; messages: ClaudeMessage[] } {
  const system = messages.find((m) => m.role === 'system');
  const conversation = messages
    .filter((m) => m.role !== 'system')
    .map(({ role, content }): ClaudeMessage => ({
      role: role as 'user' | 'assistant',
      content:
        typeof content === 'string'
          ? content
          : content.map((part): ClaudeBlock => {
              if (part.type === 'text') return { type: 'text', text: part.text };
              if (part.type === 'image') return { type: 'image', source: { type: 'base64', media_type: part.mime, data: part.data } };
              return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: part.data } };
            }),
    }));
  return { ...(system && { system: contentToText(system.content) }), messages: conversation };
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export function toGeminiRequest(messages: AIMessage[]): {
  systemInstruction?: { parts: [{ text: string }] };
  contents: GeminiContent[];
} {
  const system = messages.find((m) => m.role === 'system');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map(({ role, content }): GeminiContent => ({
      role: role === 'assistant' ? 'model' : 'user',
      parts:
        typeof content === 'string'
          ? [{ text: content }]
          : content.map((part): GeminiPart => {
              if (part.type === 'text') return { text: part.text };
              if (part.type === 'image') return { inlineData: { mimeType: part.mime, data: part.data } };
              return { inlineData: { mimeType: 'application/pdf', data: part.data } };
            }),
    }));
  return { ...(system && { systemInstruction: { parts: [{ text: contentToText(system.content) }] as [{ text: string }] } }), contents };
}
