import type { ProviderCapabilities } from '../ai/capabilities';
import type { AttachmentKind, ContentPart, StoredAttachment } from '../types/attachments';
import { decodeText, extractDocxText, limitText, wrapDocument } from './document-text';
import { sniffFileType, type SniffedType } from './file-sniff';

const MB = 1024 * 1024;

export const LIMITS = {
  maxFiles: 5,
  imageBytes: 10 * MB,
  // Base64 adds a third: anything above 11 MB could never fit the 15 MB request budget
  pdfBytes: 11 * MB,
  documentBytes: 5 * MB,
  videoBytes: 100 * MB,
  documentChars: 60_000,
  videoFrames: 6,
  imageMaxEdge: 1568,
  videoMaxEdge: 1024,
  thumbEdge: 96,
} as const;

/** Longest thumbnail data URL kept in the chat history */
const THUMB_MAX_CHARS = 12_000;
const SNIFF_BYTES = 4096;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** An error whose message can be shown to the user as is */
export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentError';
  }
}

/** Browser-only work, injected so the rules above can be tested without a canvas or a video decoder */
export interface ReaderDeps {
  /** Returns the input unchanged when the image already fits within `maxEdge` */
  downscaleImage(bytes: Uint8Array, mime: string, maxEdge: number): Promise<{ mime: string; data: Uint8Array }>;
  /** JPEG frames and the second each one was taken at */
  videoFrames(file: File, count: number, maxEdge: number): Promise<{ frames: Uint8Array[]; times: number[] }>;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const KIND: Record<SniffedType, AttachmentKind> = {
  png: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  pdf: 'pdf', mp4: 'video', webm: 'video', docx: 'document', text: 'document',
};

const MIME: Record<SniffedType, string> = {
  png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', docx: DOCX_MIME, text: 'text/plain',
};

const LIMIT_BY_KIND: Record<AttachmentKind, number> = {
  image: LIMITS.imageBytes, pdf: LIMITS.pdfBytes, document: LIMITS.documentBytes, video: LIMITS.videoBytes,
};

const partBytes = (parts: ContentPart[]): number =>
  parts.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : part.data.length), 0);

async function makeThumb(bytes: Uint8Array, mime: string, deps: ReaderDeps): Promise<string | undefined> {
  try {
    const thumb = await deps.downscaleImage(bytes, mime, LIMITS.thumbEdge);
    const url = `data:${thumb.mime};base64,${toBase64(thumb.data)}`;
    return url.length <= THUMB_MAX_CHARS ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Validate a picked file and turn it into what is sent to the model. The type is decided from the
 * file's bytes; the extension and file.type are ignored. Throws AttachmentError with a readable message.
 */
export async function readAttachment(file: File, caps: ProviderCapabilities, deps: ReaderDeps): Promise<StoredAttachment> {
  const name = file.name;
  if (file.size === 0) throw new AttachmentError(`"${name}" is empty.`);

  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const type = sniffFileType(head, name);
  if (!type) {
    const looksLikeSvg = /\.svg$/i.test(name) || new TextDecoder().decode(head).includes('<svg');
    throw new AttachmentError(
      looksLikeSvg
        ? `"${name}": SVG is not supported. Export it as PNG instead.`
        : `"${name}" is not a supported file. Use PNG, JPEG, GIF, WebP, PDF, MP4, WebM, TXT, MD, CSV, JSON, HTML or DOCX.`
    );
  }

  const kind = KIND[type];
  const limit = LIMIT_BY_KIND[kind];
  if (file.size > limit) throw new AttachmentError(`"${name}" is larger than ${limit / MB} MB.`);
  if (kind === 'pdf' && !caps.pdf) {
    throw new AttachmentError(`"${name}" cannot be attached: the selected AI provider does not accept PDF files.`);
  }
  if ((kind === 'image' || kind === 'video') && !caps.image) {
    throw new AttachmentError(
      `"${name}" cannot be attached: the selected AI provider does not accept images${kind === 'video' ? ', so videos cannot be used' : ''}.`
    );
  }

  const mime = MIME[type];
  let parts: ContentPart[];
  let thumb: string | undefined;

  if (kind === 'video') {
    const { frames, times } = await deps.videoFrames(file, LIMITS.videoFrames, LIMITS.videoMaxEdge);
    const at = times.map((t) => `${Math.round(t)}s`).join(', ');
    parts = [
      { type: 'text', text: `Frames sampled from video "${name}" at ${at}` },
      ...frames.map((frame): ContentPart => ({ type: 'image', mime: 'image/jpeg', data: toBase64(frame) })),
    ];
    thumb = frames[0] ? await makeThumb(frames[0], 'image/jpeg', deps) : undefined;
  } else {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (kind === 'image') {
      const scaled = await deps.downscaleImage(bytes, mime, LIMITS.imageMaxEdge);
      parts = [{ type: 'image', mime: scaled.mime, data: toBase64(scaled.data) }];
      thumb = await makeThumb(bytes, mime, deps);
    } else if (kind === 'pdf') {
      parts = [{ type: 'pdf', name, data: toBase64(bytes) }];
    } else {
      let text: string;
      try {
        text = type === 'docx' ? await extractDocxText(bytes) : decodeText(bytes);
      } catch {
        throw new AttachmentError(`"${name}" could not be read as a Word file.`);
      }
      parts = [{ type: 'text', text: wrapDocument(name, limitText(text, LIMITS.documentChars)) }];
    }
  }

  return {
    meta: { id: crypto.randomUUID(), name, kind, mime, size: file.size, ...(thumb && { thumb }) },
    parts,
    bytes: partBytes(parts),
  };
}
