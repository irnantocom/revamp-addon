import type { StoredAttachment } from '../types/attachments';
import type { Operation } from '../types/operations';

/** How the AI points at an uploaded image; the panel swaps it for a data URL before the page sees it */
export const ATTACHMENT_SRC_PREFIX = 'attachment:';

/**
 * Longest data URL accepted. The demo keeps applied operations in chrome.storage.session (10 MB per
 * browser session for every tab), so one image must not take a large share of it.
 */
export const MAX_IMAGE_DATA_URL_CHARS = 2_000_000;

/** Style properties whose url(attachment:<id>) is resolved; anywhere else the reference is left as it is */
const BACKGROUND_PROPERTIES = new Set(['background', 'background-image']);
const STYLE_REF = /url\(\s*(['"]?)attachment:([^'")\s]+)\1\s*\)/gi;

type Load = (id: string) => Promise<StoredAttachment | undefined>;
/** Re-encodes a data URL smaller (or returns it unchanged); a failure keeps the original */
export type Shrink = (dataUrl: string) => Promise<string>;

export interface AttachmentRefResult {
  operations: Operation[];
  /** Operations that could not be resolved; they are left out of `operations` */
  errors: Array<{ operationId: string; error: string }>;
}

/** The stored image as a data URL, or the reason it cannot be used */
async function imageDataUrl(id: string, load: Load, shrink?: Shrink): Promise<{ url: string } | { error: string }> {
  const file = await load(id.trim()).catch(() => undefined);
  if (!file) return { error: 'The uploaded image is no longer available. Attach it again.' };

  const image = file.meta.kind === 'image' ? file.parts.find((part) => part.type === 'image') : undefined;
  if (!image || image.type !== 'image') return { error: `"${file.meta.name}" is not an image, so it cannot be placed on the page.` };

  const original = `data:${image.mime};base64,${image.data}`;
  const url = shrink ? await shrink(original).catch(() => original) : original;
  if (url.length > MAX_IMAGE_DATA_URL_CHARS) {
    return { error: `"${file.meta.name}" is too large to keep in the demo. Use a smaller image or an image URL.` };
  }
  return { url };
}

/** Replace url(attachment:<id>) in one CSS value; the first failure wins */
async function resolveStyleValue(value: string, load: Load, shrink?: Shrink): Promise<{ value: string } | { error: string }> {
  let result = value;
  for (const match of Array.from(value.matchAll(STYLE_REF))) {
    const image = await imageDataUrl(match[2], load, shrink);
    if ('error' in image) return image;
    result = result.replace(match[0], () => `url("${image.url}")`);
  }
  return { value: result };
}

/**
 * Replace attachment references with the stored image as a data URL: the "src" of replace_image and
 * url(attachment:<id>) in the background properties of set_style. The model only ever sees the id;
 * the file content stays in the panel until this point.
 */
export async function resolveAttachmentSources(operations: Operation[], load: Load, shrink?: Shrink): Promise<AttachmentRefResult> {
  const resolved: Operation[] = [];
  const errors: AttachmentRefResult['errors'] = [];

  for (const op of operations) {
    if (op.op === 'replace_image' && op.src.toLowerCase().startsWith(ATTACHMENT_SRC_PREFIX)) {
      const image = await imageDataUrl(op.src.slice(ATTACHMENT_SRC_PREFIX.length), load, shrink);
      if ('error' in image) errors.push({ operationId: op.id, error: image.error });
      else resolved.push({ ...op, src: image.url });
      continue;
    }

    if (op.op === 'set_style') {
      const styles: Record<string, string> = { ...op.styles };
      let failure: string | undefined;
      for (const [property, value] of Object.entries(styles)) {
        if (!BACKGROUND_PROPERTIES.has(property.replace(/([A-Z])/g, '-$1').toLowerCase()) || failure) continue;
        const next = await resolveStyleValue(value, load, shrink);
        if ('error' in next) failure = next.error;
        else styles[property] = next.value;
      }
      if (failure) errors.push({ operationId: op.id, error: failure });
      else resolved.push({ ...op, styles });
      continue;
    }

    resolved.push(op);
  }

  return { operations: resolved, errors };
}
