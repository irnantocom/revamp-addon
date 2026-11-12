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

export const MAX_WEB_IMAGES = 60;
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

/**
 * The same picture at another size shares one key: WordPress "-300x200", "-scaled" and "-e1700000000000",
 * and resize query strings such as "?w=768" (kept only when the path is not an image file, where a query
 * can select a different picture).
 */
export function imageKey(url: URL): string {
  const path = url.pathname.replace(/-(?:\d{2,5}x\d{2,5}|scaled|e\d{10,})(?=\.[a-z0-9]+$)/i, '');
  return `${url.origin}${path}${IMAGE_FILE.test(pathOf(url)) ? '' : url.search}`;
}

/** Pixel area from a "-WxH" suffix; a file without one is the original and counts as the largest */
const areaOf = (url: URL): number => {
  const size = /-(\d{2,5})x(\d{2,5})\.[a-z0-9]+$/i.exec(url.pathname);
  return size ? Number(size[1]) * Number(size[2]) : Infinity;
};

/** A URL worth listing as a picture, or null */
function pictureUrl(raw: string, base?: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  const path = pathOf(url);
  return /^https?:$/.test(url.protocol) && !SKIPPED_FILE.test(path) && !PLACEHOLDER.test(path) ? url : null;
}

// People write "www.example.com" without the scheme. A bare name counts only with www. or a well-known ending, so that
// file names (index.html), code (element.id, node.js), versions and e-mail addresses are not taken for sites.
const TLD = '(?:(?:com|co|net|org|gov|edu|ac|or|go)\\.[a-z]{2}|com|net|org|io|info|biz|edu|gov|app|dev|sg|my|au|uk|de|fr|nl|jp|cn|us|ca)';
const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const ADDRESS = new RegExp(
  `https?://[^\\s<>"'\`]+|(?<![\\w@./:-])(?:www\\.${LABEL}(?:\\.${LABEL})+|${LABEL}(?:\\.${LABEL})*\\.${TLD})(?![\\w@-])(?::\\d+)?(?:/[^\\s<>"'\`]*)?`,
  'gi'
);

/** Web pages (not image files) typed into a message, with or without https://, at most MAX_WEB_PAGES */
export function pageUrlsFrom(text: string): string[] {
  const pages: string[] = [];
  for (const match of text.matchAll(ADDRESS)) {
    const raw = match[0].replace(/[.,;:!?)\]}]+$/, '');
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
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
  const found = new Map<string, { url: string; alt: string; area: number }>();

  const add = (raw: string | null | undefined, alt = '') => {
    const url = raw ? pictureUrl(raw, pageUrl) : null;
    if (!url) return;
    const key = imageKey(url);
    const known = found.get(key);
    if (!known && found.size >= MAX_WEB_IMAGES) return;
    // Another size of a picture already listed: keep the larger file, and any alt text the first one lacked
    const area = areaOf(url);
    found.set(key, {
      url: known && known.area >= area ? known.url : url.href,
      area: Math.max(known?.area ?? 0, area),
      alt: known?.alt || cleanAlt(alt),
    });
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

  return Array.from(found.values(), ({ url, alt }) => ({ url, alt }));
}

export async function readCapped(response: Response, maxBytes: number): Promise<string> {
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

/** Places for a picture in the page index: <img> entries and elements with a CSS background image */
export function countImageSlots(indexText: string): number {
  return (indexText.match(/^\s*\[\d+\] img /gm) ?? []).length + (indexText.match(/ bg-image="/g) ?? []).length;
}

const STOPWORDS = new Set(
  'this that with from your have will they them their what when where which about would there these those into over than then also been were more most such only some very just yang dari dengan untuk pada akan atau dalam juga bisa'.split(' ')
);
const WORDS = /[\p{L}\p{N}]{4,}/gu;

/** The words a text keeps coming back to, most frequent first: what the pictures should be about */
export function keywordsFrom(texts: string[], max = 25): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const word of text.toLowerCase().match(WORDS) ?? []) {
      if (!STOPWORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return Array.from(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([word]) => word);
}

/** Images whose alt text or file name shares the most words with the keywords first; ties keep their order */
export function rankByKeywords(images: WebImage[], keywords: string[]): WebImage[] {
  const wanted = new Set(keywords);
  const score = (image: WebImage) => {
    const words = new Set(`${image.alt} ${image.url.split('/').pop() ?? ''}`.toLowerCase().match(WORDS) ?? []);
    let hits = 0;
    words.forEach((word) => wanted.has(word) && hits++);
    return hits;
  };
  return images
    .map((image, order) => ({ image, order, hits: score(image) }))
    .sort((a, b) => b.hits - a.hits || a.order - b.order)
    .map(({ image }) => image);
}

const LIBRARY_PAGES = 3;
const LIBRARY_PER_PAGE = 100;

/**
 * The newest pictures of a WordPress site's public media library (`/wp-json/wp/v2/media`), with the
 * titles and alt text its owner wrote. Never throws: a site without the endpoint gives an empty list.
 */
export async function fetchWordPressMedia(site: string, fetchImpl: typeof fetch = fetch): Promise<WebImage[]> {
  let origin: string;
  try {
    origin = new URL(site).origin;
  } catch {
    return [];
  }

  const readPage = async (page: number): Promise<unknown[]> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const query = `per_page=${LIBRARY_PER_PAGE}&page=${page}&media_type=image&_fields=source_url,alt_text,title`;
      const response = await fetchImpl(`${origin}/wp-json/wp/v2/media?${query}`, { credentials: 'omit', signal: controller.signal });
      if (!response.ok) return [];
      const items = await response.json();
      return Array.isArray(items) ? items : [];
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  };

  const items = (await Promise.all(Array.from({ length: LIBRARY_PAGES }, (_, i) => readPage(i + 1)))).flat();
  const seen = new Set<string>();
  const images: WebImage[] = [];
  for (const item of items as Array<{ source_url?: unknown; alt_text?: unknown; title?: { rendered?: unknown } }>) {
    const url = typeof item?.source_url === 'string' ? pictureUrl(item.source_url) : null;
    if (!url || seen.has(imageKey(url))) continue;
    seen.add(imageKey(url));
    const label = [item.alt_text, item.title?.rendered].find((value) => typeof value === 'string' && value.trim());
    images.push({ url: url.href, alt: cleanAlt(String(label ?? '')) });
  }
  return images;
}

export type GatheredImages = { ok: true; source: WebImageSource; fromLibrary: number } | { ok: false; error: string };

/** Pictures from the library are added only to fill the places the page's own pictures cannot, plus a little choice */
const LIBRARY_MARGIN = 10;
const LIBRARY_MAX = 60;

/**
 * The pictures of the named page. When it has fewer than the page being edited has places for (`needed`),
 * or none at all, the site's WordPress media library fills the gap with the pictures that best match `keywords`.
 */
export async function gatherWebImages(
  page: string,
  { needed, keywords, fetchImpl = fetch }: { needed: number; keywords: string[]; fetchImpl?: typeof fetch }
): Promise<GatheredImages> {
  const result = await fetchWebImages(page, fetchImpl);
  const images = result.ok ? [...result.source.images] : [];
  let fromLibrary = 0;

  if (needed > 0 && images.length < needed) {
    const have = new Set(images.map((image) => imageKey(new URL(image.url))));
    const library = rankByKeywords(await fetchWordPressMedia(page, fetchImpl), keywords).filter((image) => !have.has(imageKey(new URL(image.url))));
    const extra = library.slice(0, Math.min(LIBRARY_MAX, needed - images.length + LIBRARY_MARGIN));
    images.push(...extra);
    fromLibrary = extra.length;
  }

  if (images.length === 0) return { ok: false, error: result.ok ? 'no images found' : result.error };
  return { ok: true, source: { page, images }, fromLibrary };
}
