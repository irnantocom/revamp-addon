import type { AIMessage } from '../ai/provider-interface';
import { estimateRequestBytes, MAX_PAYLOAD_BYTES } from '../ai/message-format';

/** Returns the error to show when a request is too large to send, or null when it is fine */
export function assertPayloadSize(messages: AIMessage[]): string | null {
  const bytes = estimateRequestBytes(messages);
  if (bytes <= MAX_PAYLOAD_BYTES) return null;
  const mb = Math.ceil(bytes / (1024 * 1024));
  return `Attachments are too large to send (${mb} MB). Remove some and try again.`;
}
