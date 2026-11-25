/**
 * Text of a web page the user names in the chat ("replace the content with the content of https://example.com").
 * The AI cannot browse, so the panel reads the page once and hands the model an outline of its words, in page
 * order. The page is third-party data: it is parsed inertly and its text never counts as an instruction.
 */

import { readCapped } from './web-images';

export interface WebText {
  page: string;
  /** One entry per line of the outline; '' separates sections */
  lines: string[];
  truncated: boolean;
}

export type WebTextResult = { ok: true; source: WebText } | { ok: false; error: string };

const MAX_HTML_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 10_000;
/** Characters of outline sent per page; the model needs the page's own wording, not all of a long blog */
const TEXT_BUDGET = 24_000;
const LINE_MAX = 800;
/** A page with less text than this has built it with JavaScript, or has none */
const MIN_TEXT = 40;

// The user asks for words, not only for pictures or looks
const CONTENT_REQUEST =
  /\b(contents?|texts?|copy|copywriting|wording|headlines?|descriptions?|konten|isi|teks|tulisan|kalimat|judul|deskripsi)\b/i;

export const wantsContent = (text: string): boolean => CONTENT_REQUEST.test(text);

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'iframe', 'nav', 'footer', 'select', 'option']);
const HEADINGS = /^h[1-6]$/;
// Elements whose whole text is one line of the outline
const TEXT_TAGS = new Set(['p', 'blockquote', 'figcaption', 'dt', 'dd', 'summary', 'label']);
const BLOCK_CHILDREN = 'p,ul,ol,h1,h2,h3,h4,h5,h6,div,table,blockquote,section';
const BUTTON_CLASS = /btn|button|cta/i;
const NOISE = /cookie|consent|gdpr/i;
const LINK_MAX = 60;

const clean = (text: string | null): string => (text || '').replace(/\s+/g, ' ').trim();

const isHidden = (el: Element): boolean =>
  el.hasAttribute('hidden') ||
  el.getAttribute('aria-hidden') === 'true' ||
  /display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute('style') || '') ||
  NOISE.test(`${el.id} ${el.getAttribute('class') || ''}`);

/** Outline of the visible words of a page's HTML, in page order. Navigation and footer are left out. */
export function extractWebText(html: string): { lines: string[]; truncated: boolean } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('br').forEach((br) => br.replaceWith(' '));

  const lines: string[] = [];
  let used = 0;
  let truncated = false;

  const emit = (prefix: string, raw: string) => {
    if (truncated) return;
    const text = clean(raw);
    if (!text) return;
    const body = text.length > LINE_MAX ? `${text.slice(0, LINE_MAX)} …` : text;
    const line = prefix ? `${prefix}: ${body}` : body;
    if (lines[lines.length - 1] === line) return;
    if (used + line.length > TEXT_BUDGET) {
      truncated = true;
      return;
    }
    used += line.length + 1;
    lines.push(line);
  };

  const separate = () => {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
  };

  const walk = (el: Element) => {
    if (truncated) return;
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag) || isHidden(el)) return;

    if (tag === 'section' || tag === 'article' || tag === 'h1' || tag === 'h2') separate();

    if (HEADINGS.test(tag) || TEXT_TAGS.has(tag)) {
      emit(HEADINGS.test(tag) || tag === 'p' ? tag : tag === 'blockquote' ? 'quote' : tag, el.textContent || '');
      return;
    }
    if (tag === 'tr') {
      emit('row', Array.from(el.children).map((cell) => clean(cell.textContent)).filter(Boolean).join(' | '));
      return;
    }
    if (tag === 'button') {
      emit('button', el.textContent || '');
      return;
    }
    if (tag === 'a') {
      const text = clean(el.textContent);
      if (BUTTON_CLASS.test(el.getAttribute('class') || '') || el.getAttribute('role') === 'button') emit('button', text);
      else if (text.length <= LINK_MAX) emit('link', text);
      return;
    }
    if (tag === 'li' && !el.querySelector(BLOCK_CHILDREN)) {
      emit('li', el.textContent || '');
      return;
    }

    // Containers: their own loose text, in order with their children
    let loose = '';
    const flush = () => {
      emit(tag === 'li' ? 'li' : '', loose);
      loose = '';
    };
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) loose += node.textContent;
      else if (node.nodeType === Node.ELEMENT_NODE) {
        flush();
        walk(node as Element);
      }
    }
    flush();
  };

  if (doc.body) walk(doc.body);
  while (lines[lines.length - 1] === '') lines.pop();
  return { lines, truncated };
}

/** Read one page and outline its text. Never throws: the reason comes back in `error`. */
export async function fetchWebText(page: string, fetchImpl: typeof fetch = fetch): Promise<WebTextResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(page, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) return { ok: false, error: `the site answered HTTP ${response.status}` };

    const type = response.headers.get('content-type') || '';
    if (type && !/html/i.test(type)) return { ok: false, error: 'the address is not a web page' };

    const { lines, truncated } = extractWebText(await readCapped(response, MAX_HTML_BYTES));
    if (lines.join('').length < MIN_TEXT) {
      return { ok: false, error: 'no readable text in the page source (the site may build its text with JavaScript)' };
    }
    return { ok: true, source: { page, lines, truncated } };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return { ok: false, error: timedOut ? 'the site took too long to answer' : 'the site could not be reached' };
  } finally {
    clearTimeout(timer);
  }
}
