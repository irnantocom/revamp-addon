/**
 * How a site looks once it is drawn: which colour its buttons, headings, header and sections really have.
 * Its stylesheets only hold rules; which rule wins for which element, and which elements show at all,
 * is known only after the page is rendered. So the panel opens the page the user named in a background
 * tab, a script reads the computed styles, and the tab is closed.
 *
 * What comes back is page-controlled data: it holds colours, fonts and sizes only (no text of the page),
 * and every value is checked against a strict shape before it reaches the model.
 */

export interface RenderedStyles {
  elements: number;
  roles: Array<{ name: string; bg: string; text: string; font: string }>;
  buttons: Array<{ bg: string; text: string; radius: string; transform: string; font: string; count: number }>;
  links: Array<{ color: string; count: number }>;
  headings: Array<{ tag: string; color: string; font: string; size: string; weight: string; transform: string; count: number }>;
  backgrounds: Array<{ color: string; weight: number }>;
  texts: Array<{ color: string; weight: number }>;
  accents: Array<{ color: string; weight: number }>;
}

/**
 * Runs inside the page, injected with chrome.scripting.executeScript, so it must not use anything
 * defined outside it. `pace` scales its waits (tests pass 0).
 */
export async function sampleRenderedDesign(pace = 1): Promise<RenderedStyles> {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms * pace));
  await sleep(800);
  // Sections that load as they scroll into view; a hidden tab runs timers slowly, so only a few stops
  const height = document.documentElement.scrollHeight;
  for (const fraction of [0.33, 0.66, 1]) {
    window.scrollTo(0, height * fraction);
    await sleep(350);
  }
  window.scrollTo(0, 0);
  await sleep(250);

  const parse = (value: string) => {
    const match = /rgba?\(([^)]+)\)/.exec(value);
    if (!match) return null;
    const [r, g, b, a] = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a: a === undefined ? 1 : a };
  };
  const hex = (c: { r: number; g: number; b: number }) =>
    `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  // How far a colour is from grey. HSL saturation would count a pale cream as vivid; the spread of the channels does not.
  const chroma = (c: { r: number; g: number; b: number }) => (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
  const family = (value: string) => value.split(',')[0].replace(/["']/g, '').trim();
  const paint = (value: string) => {
    const c = parse(value);
    return c && c.a > 0.3 ? c : null;
  };
  const showing = (el: Element, s: CSSStyleDeclaration) => {
    const r = el.getBoundingClientRect();
    const opacity = parseFloat(s.opacity);
    return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && (Number.isNaN(opacity) || opacity > 0.1);
  };
  const ownTextLength = (el: Element) =>
    Array.from(el.childNodes).reduce((sum, node) => sum + (node.nodeType === 3 ? (node.textContent ?? '').trim().length : 0), 0);

  type Tally<T> = Map<string, { item: T; weight: number }>;
  const add = <T>(map: Tally<T>, key: string, item: T, by: number) => {
    const known = map.get(key);
    if (known) known.weight += by;
    else map.set(key, { item, weight: by });
  };
  const top = <T>(map: Tally<T>) => Array.from(map.values()).sort((a, b) => b.weight - a.weight).slice(0, 8);

  const buttons: Tally<Omit<RenderedStyles['buttons'][number], 'count'>> = new Map();
  const links: Tally<{ color: string }> = new Map();
  const headings: Tally<Omit<RenderedStyles['headings'][number], 'count'>> = new Map();
  const backgrounds: Tally<{ color: string }> = new Map();
  const texts: Tally<{ color: string }> = new Map();
  const accents: Tally<{ color: string }> = new Map();
  const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'LINK', 'META']);

  let elements = 0;
  for (const el of Array.from(document.body.querySelectorAll('*')).slice(0, 4000)) {
    if (SKIPPED.has(el.tagName.toUpperCase())) continue;
    const s = getComputedStyle(el);
    if (!showing(el, s)) continue;
    elements++;

    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    const bg = paint(s.backgroundColor);
    const fg = parse(s.color);
    const gradient = /gradient/.test(s.backgroundImage);
    const font = family(s.fontFamily);
    const chars = ownTextLength(el);
    const label = (el.textContent ?? '').trim().length;
    const clickable = el.matches('a, button, input[type="submit"], input[type="button"], [role="button"]');

    if (clickable && (bg || gradient) && area > 800 && label >= 2 && label <= 40 && !el.querySelector('img')) {
      const fill = gradient ? s.backgroundImage.slice(0, 80) : bg ? hex(bg) : '';
      const radius = s.borderTopLeftRadius || s.borderRadius;
      const text = fg ? hex(fg) : '';
      add(buttons, [fill, text, radius, s.textTransform, font].join('|'), { bg: fill, text, radius, transform: s.textTransform, font }, 1);
    } else if (el.tagName === 'A' && fg && chars > 0) {
      add(links, hex(fg), { color: hex(fg) }, 1);
    }

    if (/^H[1-3]$/.test(el.tagName) && fg) {
      const item = { tag: el.tagName, color: hex(fg), font, size: s.fontSize, weight: s.fontWeight, transform: s.textTransform };
      add(headings, Object.values(item).join('|'), item, 1);
    }
    if (bg && area > 20000) {
      add(backgrounds, hex(bg), { color: hex(bg) }, area / 10000);
      if (chroma(bg) > 0.15) add(accents, hex(bg), { color: hex(bg) }, area / 10000);
    }
    if (fg && chars > 0) {
      add(texts, hex(fg), { color: hex(fg) }, chars);
      if (chroma(fg) > 0.15) add(accents, hex(fg), { color: hex(fg) }, chars / 4);
    }
  }

  const role = (name: string, selector: string) => {
    const el = Array.from(document.querySelectorAll(selector)).find((candidate) => showing(candidate, getComputedStyle(candidate)));
    if (!el) return null;
    const s = getComputedStyle(el);
    const bg = paint(s.backgroundColor) ?? (name === 'body' ? paint(getComputedStyle(document.documentElement).backgroundColor) : null);
    const text = parse(s.color);
    return { name, bg: bg ? hex(bg) : '', text: text ? hex(text) : '', font: family(s.fontFamily) };
  };
  const roles = [
    role('body', 'body'),
    role('header', 'header'),
    role('nav links', 'header a, nav a'),
    role('footer', 'footer'),
    role('h1', 'h1'),
    role('h2', 'h2'),
    role('paragraph', 'main p, p'),
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return {
    elements,
    roles,
    buttons: top(buttons).map(({ item, weight }) => ({ ...item, count: weight })),
    links: top(links).map(({ item, weight }) => ({ color: item.color, count: weight })),
    headings: top(headings).map(({ item, weight }) => ({ ...item, count: weight })),
    backgrounds: top(backgrounds).map(({ item, weight }) => ({ color: item.color, weight: Math.round(weight) })),
    texts: top(texts).map(({ item, weight }) => ({ color: item.color, weight: Math.round(weight) })),
    accents: top(accents).map(({ item, weight }) => ({ color: item.color, weight: Math.round(weight) })),
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
const LENGTHS = /^\d{1,4}(\.\d{1,2})?(px|em|rem|%)( \d{1,4}(\.\d{1,2})?(px|em|rem|%))*$/;
const GRADIENT = /^(repeating-)?(linear|radial|conic)-gradient\([#\w\s(),.%/-]*\)$/;
const FONT_NAME = /[^\p{L}\p{N} ._-]/gu;
const WEIGHT = /^(\d{3}|normal|bold)$/;
const TRANSFORMS = new Set(['uppercase', 'lowercase', 'capitalize']);
const ROLE_NAMES = new Set(['body', 'header', 'nav links', 'footer', 'h1', 'h2', 'paragraph']);
const MAX_PER_KIND = 8;
const MAX_COUNT = 99999;

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const list = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.flatMap((entry) => (record(entry) ? [record(entry) as Record<string, unknown>] : [])).slice(0, MAX_PER_KIND) : [];
const colour = (value: unknown): string | null => (typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : null);
const length = (value: unknown): string | null => (typeof value === 'string' && LENGTHS.test(value.trim()) ? value.trim() : null);
// A real font name is short; a long one is more likely a sentence aimed at the model than a font
const font = (value: unknown): string | null => {
  const name = typeof value === 'string' ? value.replace(FONT_NAME, '').replace(/\s+/g, ' ').trim() : '';
  return name && name.length <= 30 && name.split(' ').length <= 4 ? name : null;
};
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), MAX_COUNT) : null);
const join = (parts: Array<string | null | false>): string => parts.filter(Boolean).join('; ');

/** Turn a sample into short lines for the prompt. Anything that does not have the expected shape is left out. */
export function describeRendered(raw: unknown): string[] {
  const sample = record(raw);
  if (!sample) return [];
  const lines: string[] = [];

  for (const entry of list(sample.roles)) {
    const name = typeof entry.name === 'string' && ROLE_NAMES.has(entry.name) ? entry.name : null;
    const [bg, text, family] = [colour(entry.bg), colour(entry.text), font(entry.font)];
    if (name && (bg || text)) lines.push(`${name}: ${join([bg && `background ${bg}`, text && `text ${text}`, family && `font ${family}`])}`);
  }

  for (const entry of list(sample.buttons)) {
    const fill = colour(entry.bg) ?? (typeof entry.bg === 'string' && GRADIENT.test(entry.bg) ? entry.bg : null);
    const n = count(entry.count);
    if (!fill || n === null) continue;
    const transform = typeof entry.transform === 'string' && TRANSFORMS.has(entry.transform) ? entry.transform : null;
    const [text, radius, family] = [colour(entry.text), length(entry.radius), font(entry.font)];
    lines.push(`Button: ${join([`background ${fill}`, text && `text ${text}`, radius && `radius ${radius}`, transform, family && `font ${family}`, `${n} on the page`])}`);
  }

  const links = list(sample.links).flatMap((entry) => {
    const [c, n] = [colour(entry.color), count(entry.count)];
    return c && n !== null ? [`${c} (${n})`] : [];
  });
  if (links.length) lines.push(`Links without a background: ${links.join(', ')}`);

  for (const entry of list(sample.headings)) {
    const tag = typeof entry.tag === 'string' && /^H[1-3]$/.test(entry.tag) ? entry.tag : null;
    const [c, n] = [colour(entry.color), count(entry.count)];
    if (!tag || !c || n === null) continue;
    const transform = typeof entry.transform === 'string' && TRANSFORMS.has(entry.transform) ? entry.transform : null;
    const [family, size] = [font(entry.font), length(entry.size)];
    const weight = typeof entry.weight === 'string' && WEIGHT.test(entry.weight) ? entry.weight : null;
    lines.push(`Heading: ${tag} ${c}${join(['', family && `font ${family}`, size, weight && `weight ${weight}`, transform, `${n} on the page`]).replace(/^/, '; ')}`);
  }

  const colours = (value: unknown) => list(value).flatMap((entry) => (colour(entry.color) && count(entry.weight) !== null ? [colour(entry.color) as string] : []));
  const ranked: Array<[string, string[]]> = [
    ['Largest backgrounds, by area covered', colours(sample.backgrounds)],
    ['Text colours, by amount of text', colours(sample.texts)],
    ['Brand colours (saturated), most used first', colours(sample.accents)],
  ];
  for (const [label, found] of ranked) if (found.length) lines.push(`${label}: ${found.join(', ')}`);

  return lines;
}

export type RenderedResult = { ok: true; lines: string[]; elements: number } | { ok: false; error: string };

interface Options {
  api?: typeof chrome;
  /** Longest wait for the page to finish loading */
  timeoutMs?: number;
  pollMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const SCRIPT_TIMEOUT_MS = 10_000;
class Unreachable extends Error {}

/**
 * Open `page` in a background tab, read how it is drawn, and close the tab. Never throws: the reason
 * comes back in `error`. Only an http(s) address is opened.
 */
export async function readRenderedDesign(page: string, { api = chrome, timeoutMs = 15_000, pollMs = 250 }: Options = {}): Promise<RenderedResult> {
  let url: URL;
  try {
    url = new URL(page);
  } catch {
    return { ok: false, error: 'the address is not a web page' };
  }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, error: 'the address is not a web page' };

  let tabId: number | undefined;
  try {
    try {
      tabId = (await api.tabs.create({ url: url.href, active: false })).id;
    } catch {
      return { ok: false, error: 'a background tab could not be opened' };
    }
    if (tabId === undefined) return { ok: false, error: 'a background tab could not be opened' };

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const tab = await api.tabs.get(tabId);
      if (tab.url?.startsWith('chrome-error:')) return { ok: false, error: 'the site could not be reached' };
      // a tab that has not navigated yet can read "complete" for about:blank
      if (tab.status === 'complete' && /^https?:/.test(tab.url ?? '')) break;
      if (Date.now() >= deadline) return { ok: false, error: 'the site took too long to load' };
      await sleep(pollMs);
    }

    const injection = await Promise.race([
      api.scripting.executeScript({ target: { tabId }, func: sampleRenderedDesign }),
      sleep(SCRIPT_TIMEOUT_MS).then(() => Promise.reject(new Error('timeout'))),
    ]).catch((error: unknown) => {
      // a page that failed to load is shown as the browser's own error page, which a script cannot enter
      if (error instanceof Error && /showing error page/i.test(error.message)) throw new Unreachable();
      throw error;
    });
    const result = injection[0]?.result;
    const lines = describeRendered(result);
    if (lines.length === 0) return { ok: false, error: 'the page showed nothing to read' };
    const elements = record(result)?.elements;
    return { ok: true, lines, elements: typeof elements === 'number' ? elements : 0 };
  } catch (error) {
    return { ok: false, error: error instanceof Unreachable ? 'the site could not be reached' : 'the page could not be read' };
  } finally {
    if (tabId !== undefined) {
      try {
        await Promise.resolve(api.tabs.remove(tabId)).catch(() => undefined);
      } catch {
        // the tab is gone already
      }
    }
  }
}
