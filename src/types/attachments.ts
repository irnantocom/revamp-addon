/**
 * Files attached to an AI chat message. File content is turned into provider-neutral
 * parts in the panel; each provider adapter maps the parts to its own wire format.
 */

export type AttachmentKind = 'image' | 'pdf' | 'video' | 'document';

/** What is kept in the chat history: no file content, so it is safe in chrome.storage */
export interface AttachmentMeta {
  id: string;
  name: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  /** Small data URL (at most 12,000 characters) shown in the chat */
  thumb?: string;
}

/** What is sent to the model. Videos are already turned into image parts. `data` is base64 without a data: prefix. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: string; data: string }
  | { type: 'pdf'; name: string; data: string };

export interface StoredAttachment {
  meta: AttachmentMeta;
  parts: ContentPart[];
  /** Summed length of base64 data and text in `parts` */
  bytes: number;
}
