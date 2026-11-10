/** Smaller images are kept as they are */
const SHRINK_ABOVE_CHARS = 300_000;
const MAX_SIDE = 1600;
// GIF (animation) and SVG (vector) would lose more than they gain
const SHRINKABLE = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Re-encode a large image as WebP no wider than MAX_SIDE pixels. The demo is saved in
 * chrome.storage.session (10 MB for all tabs), where a few phone-sized pictures would not fit.
 * Returns the original when it is already small, cannot be re-encoded, or would not get smaller.
 */
export async function shrinkDataUrl(dataUrl: string): Promise<string> {
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1]?.toLowerCase();
  if (dataUrl.length <= SHRINK_ABOVE_CHARS || !mime || !SHRINKABLE.has(mime)) return dataUrl;

  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // A browser without WebP encoding answers with PNG, which is then not smaller and is dropped below
    const smaller = canvas.toDataURL('image/webp', 0.85);
    return smaller.length < dataUrl.length ? smaller : dataUrl;
  } finally {
    bitmap.close();
  }
}
