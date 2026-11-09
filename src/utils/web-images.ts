/**
 * Images from a web page the user names in the chat ("use the pictures from https://example.com").
 * The AI cannot browse, so the panel reads the page once and hands the model a list of image URLs
 * to choose from. The page is third-party data: it is parsed inertly and nothing from it is trusted.
 */

export interface WebImage {
  url: string;
  alt: string;
}

export interface WebImageSource {
  page: string;
  images: WebImage[];
}

export type WebImageResult = { ok: true; source: WebImageSource } | { ok: false; error: string };

export const MAX_WEB_IMAGES = 30;
/** Pages named in one message; the rest are ignored */
export const MAX_WEB_PAGES = 2;
const MAX_HTML_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 10_000;
/** Below this width or height (from the attributes) an image is an icon or a tracking pixel */
const MIN_SIDE = 80;

const IMAGE_FILE = /\.(jpe?g|png|gif|webp|avif|bmp|svg|ico)$/i;
// Vector logos and icons are rarely a replacement picture
const SKIPPED_FILE = /\.(svg|ico)$/i;
const PLACEHOLDER = /(^|[/_-])(pixel|spacer|blank|1x1)\.[a-z]+$/i;
// Lazy-loading sites keep a placeholder in src and the real file in a data-* attribute, so src comes last
const SRCSET_ATTRS = ['srcset', 'data-srcset', 'data-lazy-srcset'];
const SOURCE_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'src'];
const BACKGROUND_ATTRS = ['data-bg', 'data-background-image'];

const pathOf = (url: URL) => url.pathname.toLowerCase();

/** Web pages (not image files) typed into a message, at most MAX_WEB_PAGES */
export function pageUrlsFrom(text: string): string[] {
  const pages: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const raw = match[0].replace(/[.,;:!?)\]}]+$/, '');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (IMAGE_FILE.test(pathOf(url)) || pages.includes(url.href)) continue;
    pages.push(url.href);
    if (pages.length === MAX_WEB_PAGES) break;
  }
  return pages;
}

/** Strip anything that could read as an instruction to the model; the alt text is the page owner's, not the user's */
const cleanAlt = (alt: string): string =>
  alt.replace(/[^\p{L}\p{N} .,'&-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

/** The widest candidate of a srcset ("a.jpg 480w, b.jpg 960w"), or the only URL */
function largestCandidate(srcset: string): string {
  let best = '';
  let bestWidth = -1;
  for (const entry of srcset.split(',')) {
    const [url, descriptor] = entry.trim().split(/\s+/);
    if (!url) continue;
    const width = descriptor?.endsWith('w') ? parseInt(descriptor, 10) : 0;
    if (width > bestWidth) {
      best = url;
      bestWidth = width;
    }
  }
  return best;
}

/** Image URLs found in a page's HTML, main picture first, resolved against the page URL */
export function extractWebImages(html: string, pageUrl: string): WebImage[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const found = new Map<string, string>();

  const add = (raw: string | null | undefined, alt = '') => {
    if (!raw || found.size >= MAX_WEB_IMAGES) return;
    let url: URL;
    try {
      url = new URL(raw.trim(), pageUrl);
    } catch {
      return;
    }
    const path = pathOf(url);
    if (!/^https?:$/.test(url.protocol) || SKIPPED_FILE.test(path) || PLACEHOLDER.test(path)) return;
    if (!found.has(url.href)) found.set(url.href, cleanAlt(alt));
  };

  doc.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach((el) =>
    add(el.getAttribute('content'), 'main picture of the page')
  );

  const selector = ['img', 'source', '[style]', ...BACKGROUND_ATTRS.map((attr) => `[${attr}]`)].join(', ');
  doc.querySelectorAll(selector).forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'img' || tag === 'source') {
      const side = (name: string) => Number(el.getAttribute(name));
      if ((side('width') > 0 && side('width') < MIN_SIDE) || (side('height') > 0 && side('height') < MIN_SIDE)) return;
      // <source> is only a picture for <picture>; inside <video> or <audio> it is a media file
      if (tag === 'source' && el.parentElement?.tagName.toLowerCase() !== 'picture') return;
      const srcset = SRCSET_ATTRS.map((name) => el.getAttribute(name)).find(Boolean);
      const single = SOURCE_ATTRS.map((name) => el.getAttribute(name)).find(Boolean);
      add((srcset && largestCandidate(srcset)) || single, el.getAttribute('alt') || '');
      return;
    }

    for (const match of (el.getAttribute('style') || '').matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) add(match[2]);
    BACKGROUND_ATTRS.forEach((attr) => add(el.getAttribute(attr)));
  });

  return Array.from(found, ([url, alt]) => ({ url, alt }));
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, maxBytes);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (bytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return text;
}

/** Read one page and list its images. Never throws: the reason comes back in `error`. */
export async function fetchWebImages(page: string, fetchImpl: typeof fetch = fetch): Promise<WebImageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(page, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) return { ok: false, error: `the site answered HTTP ${response.status}` };

    const type = response.headers.get('content-type') || '';
    if (type && !/html/i.test(type)) return { ok: false, error: 'the address is not a web page' };

    const images = extractWebImages(await readCapped(response, MAX_HTML_BYTES), response.url || page);
    if (images.length === 0) {
      return { ok: false, error: 'no images found in the page source (the site may build its images with JavaScript)' };
    }
    return { ok: true, source: { page, images } };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return { ok: false, error: timedOut ? 'the site took too long to answer' : 'the site could not be reached' };
  } finally {
    clearTimeout(timer);
  }
}
