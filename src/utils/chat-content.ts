import type { AIMessage } from '../ai/provider-interface';
import type { ProviderCapabilities } from '../ai/capabilities';
import type { AttachmentKind, AttachmentMeta, ContentPart, StoredAttachment } from '../types/attachments';

/** Attachments sent with one request: newest messages are served first, older files become a note */
export const MAX_REQUEST_BYTES = 15 * 1024 * 1024;

export interface HistoryEntry {
  role: 'user' | 'assistant';
  text: string;
  attachments?: AttachmentMeta[];
}

export interface BuildRequestInput {
  systemPrompt: string;
  history: HistoryEntry[];
  draft: { text: string; attachments: AttachmentMeta[] };
  load: (id: string) => Promise<StoredAttachment | undefined>;
  caps: ProviderCapabilities;
  providerLabel: string;
  maxBytes?: number;
}

const LABEL: Record<AttachmentKind, string> = { image: 'image', pdf: 'PDF', video: 'video', document: 'file' };

const acceptedBy = (kind: AttachmentKind, caps: ProviderCapabilities): boolean =>
  kind === 'pdf' ? caps.pdf : kind === 'image' || kind === 'video' ? caps.image : true;

const refusedWhat = (kind: AttachmentKind): string => (kind === 'pdf' ? 'PDF files' : 'images');

/**
 * Turn the chat into the messages sent to the model. Files the provider cannot take, files that are
 * gone from storage and files over the size budget become one-line notes, never an API error.
 * `notes` repeats those lines so the UI can show them.
 */
export async function buildRequestMessages(input: BuildRequestInput): Promise<{ messages: AIMessage[]; notes: string[] }> {
  const { systemPrompt, history, draft, load, caps, providerLabel } = input;
  let budget = input.maxBytes ?? MAX_REQUEST_BYTES;
  const notes: string[] = [];

  const contentFor = async (text: string, attachments: AttachmentMeta[] | undefined): Promise<string | ContentPart[]> => {
    if (!attachments?.length) return text;

    // Claude rejects blank text blocks, so whitespace counts as no text
    const trimmed = text.trim();
    const parts: ContentPart[] = trimmed ? [{ type: 'text', text: trimmed }] : [];
    const note = (line: string) => {
      notes.push(line);
      parts.push({ type: 'text', text: line });
    };

    for (const meta of attachments) {
      const file = await load(meta.id);
      if (!file) {
        note(`[Attached file "${meta.name}" is no longer available.]`);
      } else if (!acceptedBy(meta.kind, caps)) {
        note(`[Attached ${LABEL[meta.kind]} "${meta.name}" was not sent: ${providerLabel} does not accept ${refusedWhat(meta.kind)}.]`);
      } else if (file.bytes > budget) {
        note(`[Attached file "${meta.name}" was left out to keep the request small.]`);
      } else {
        budget -= file.bytes;
        parts.push(...file.parts);
      }
    }
    return parts;
  };

  // The budget goes to the newest content first, so the draft is resolved before history, newest to oldest
  const draftContent = await contentFor(draft.text, draft.attachments);
  const resolved: Array<string | ContentPart[]> = new Array(history.length);
  for (let i = history.length - 1; i >= 0; i--) {
    resolved[i] = await contentFor(history[i].text, history[i].attachments);
  }

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      ...history.map((entry, i): AIMessage => ({ role: entry.role, content: resolved[i] })),
      { role: 'user', content: draftContent },
    ],
    notes,
  };
}
