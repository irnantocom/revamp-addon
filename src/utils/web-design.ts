/**
 * The look of a web page the user names in the chat ("apply the design system of https://example.com").
 * The AI cannot browse, so the panel reads the page's HTML and its stylesheets once and hands the model
 * what a designer would copy: the root variables, the text styles and the button and link styles.
 * The CSS is third-party data: it is parsed without being applied, only chosen properties are kept,
 * and every value is flattened to one short line.
 */
import { prioritiseVariables, rootVariablesFrom, type ThemeVariable } from './theme-variables';
import { readCapped } from './web-images';
import type { RenderedResult } from './rendered-design';

export interface WebDesign {
  page: string;
  variables: ThemeVariable[];
  /** "selector: property: value; …" for body and headings */
  text: string[];
  /** The same for buttons and links */
  components: string[];
  /** Stylesheets that were read, inline ones included */
  sheets: number;
  /** How the page looks once drawn (see rendered-design.ts); absent when it could not be drawn */
  rendered?: string[];
}

export type WebDesignResult = { ok: true; design: WebDesign } | { ok: false; error: string };

const MAX_SHEETS = 8;
const MAX_INLINE_STYLES = 6;
const MAX_HTML_BYTES = 2_000_000;
const MAX_SHEET_BYTES = 600_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_VARIABLES = 60;
const MAX_TEXT_LINES = 10;
const MAX_COMPONENT_LINES = 14;
const MAX_VALUE = 200;
const MAX_SELECTOR = 80;

/** Words that say the user wants a site's look and not only its pictures or text */
const DESIGN_REQUEST =
  /design system|desain sistem|\b(style|styling|styles|gaya|tema|theme|warna|colou?rs?|font|huruf|tipografi|typography|tombol|buttons?|brand|branding|palet|palette|css)\b/i;

export const wantsDesign = (text: string): boolean => DESIGN_REQUEST.test(text);

const TEXT_SELECTOR = /^(html|body|:root|p|h[1-6])$/i;
// a link or a button: `a`, `button`, or a class with btn, button or cta in its name
const COMPONENT_SELECTOR = /(^|[\s>+~])(a|button)(?=$|[.:#[\s>+~])|\.[\w-]*(btn|button|cta)[\w-]*/i;
const TEXT_PROPERTIES = ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color', 'text-transform', 'letter-spacing'];
const COMPONENT_PROPERTIES = [
  'background', 'background-color', 'background-image', 'color', 'border', 'border-color', 'border-radius',
  'padding', 'font-family', 'font-weight', 'text-transform', 'letter-spacing', 'box-shadow',
];
// WordPress ships these colours and gradients with every site; they say nothing about this site's brand
// Only the presets that carry a look are worth reading: colours, gradients and font families
const WP_NOISE = /^--wp--(?!preset--(color|gradient|font-family)--)/;
const WP_CORE_PRESET = new RegExp(
  '^--wp--preset--(color--(black|white|cyan-bluish-gray|pale-pink|vivid-red|luminous-vivid-orange|luminous-vivid-amber|light-green-cyan|vivid-green-cyan|pale-cyan-blue|vivid-cyan-blue|vivid-purple)' +
    '|gradient--(vivid-cyan-blue-to-vivid-purple|light-green-cyan-to-vivid-green-cyan|luminous-vivid-amber-to-luminous-vivid-orange|luminous-vivid-orange-to-vivid-red|very-light-gray-to-cyan-bluish-gray|cool-to-warm-spectrum|blush-light-purple|blush-bordeaux|luminous-dusk|pale-ocean|electric-grass|midnight))$'
);
/** What a shorthand already says, so the longhands are not repeated */
const LONGHANDS: Record<string, string[]> = { background: ['background-color', 'background-image'], border: ['border-color'] };
/** A value that says nothing about the look */
const NO_STYLE = /^(initial|inherit|unset|revert|none|normal)$/i;
const VAR_REFERENCE = /var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g;

/** One short line of plain text: no line breaks, control characters or quote marks */
const flatten = (text: string, max: number): string => {
  const line = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/["`]/g, "'").replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

function parseRules(css: string): CSSRuleList | null {
  try {
    // A constructed stylesheet is never attached to a document, so nothing in it is applied
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return sheet.cssRules;
  } catch {
    return null;
  }
}

/** Style rules at the top level and inside @supports and @layer; @media and @container branches are left out */
function styleRules(rules: CSSRuleList, out: CSSStyleRule[] = []): CSSStyleRule[] {
  for (const rule of Array.from(rules)) {
    if ('selectorText' in rule && 'style' in rule) out.push(rule as CSSStyleRule);
    else if ('cssRules' in rule && !('media' in rule) && rule.constructor.name !== 'CSSContainerRule') {
      styleRules((rule as CSSGroupingRule).cssRules, out);
    }
  }
  return out;
}

/** Properties of one kind of rule, merged by selector so a later rule overrides an earlier one */
function collect(
  rules: CSSStyleRule[],
  matches: (selector: string) => boolean,
  properties: string[],
  resolve: (value: string) => string
): Map<string, Map<string, string>> {
  const bySelector = new Map<string, Map<string, string>>();
  for (const rule of rules) {
    const selectors = rule.selectorText.split(',').map((part) => part.trim());
    if (!selectors.some(matches)) continue;
    // Read by name: a shorthand that holds var() only answers to its own name
    const read = properties.flatMap((name): Array<[string, string]> => {
      const value = rule.style.getPropertyValue(name).trim();
      return value && !NO_STYLE.test(value) ? [[name, value]] : [];
    });
    const covered = new Set(read.flatMap(([name]) => LONGHANDS[name] ?? []));
    const found = read.filter(([name]) => !covered.has(name));
    if (found.length === 0) continue;

    const key = flatten(selectors.join(', '), MAX_SELECTOR);
    const merged = bySelector.get(key) ?? new Map<string, string>();
    found.forEach(([name, value]) => {
      // A later shorthand replaces what an earlier rule said about its parts; a later part overrides the shorthand's
      LONGHANDS[name]?.forEach((longhand) => merged.delete(longhand));
      merged.delete(name);
      merged.set(name, resolve(value));
    });
    bySelector.set(key, merged);
  }
  return bySelector;
}

const lineOf = (selector: string, declared: Map<string, string>): string =>
  `${selector}: ${Array.from(declared, ([name, value]) => `${name}: ${value}`).join('; ')}`;

/** The design a list of stylesheets describes, later sheets overriding earlier ones */
export function extractDesign(page: string, stylesheets: string[]): WebDesign {
  const found = new Map<string, string>();
  const rules: CSSStyleRule[] = [];
  let sheets = 0;

  for (const css of stylesheets) {
    const parsed = parseRules(css);
    if (!parsed) continue;
    sheets++;
    rootVariablesFrom(parsed, { includeMedia: false, found });
    styleRules(parsed, rules);
  }

  // A value that reads a variable is shown with what the variable holds, so it can be matched by colour
  const resolve = (value: string): string => {
    let result = value;
    // a variable may point at another one
    for (let pass = 0; pass < 3 && result.includes('var('); pass++) {
      result = result.replace(VAR_REFERENCE, (whole, name: string) => found.get(name) ?? whole);
    }
    return flatten(result, MAX_VALUE);
  };
  const variables = prioritiseVariables(
    Array.from(found, ([name, value]) => ({ name, value: resolve(value) })).filter((v) => v.value && !WP_CORE_PRESET.test(v.name) && !WP_NOISE.test(v.name)),
    MAX_VARIABLES
  );

  const text = Array.from(collect(rules, (selector) => TEXT_SELECTOR.test(selector), TEXT_PROPERTIES, resolve), ([selector, declared]) => lineOf(selector, declared))
    .slice(0, MAX_TEXT_LINES);

  // A button's own base rule carries the brand's look; long selectors are one place it is used, and hover comes after
  const paints = (declared: Map<string, string>) =>
    [...declared].some(([name, value]) => name.startsWith('background') && !/^(transparent|rgba?\([^)]*,\s*0\))$/i.test(value));
  const components = Array.from(
    collect(rules, (selector) => !TEXT_SELECTOR.test(selector) && !selector.includes('::') && COMPONENT_SELECTOR.test(selector), COMPONENT_PROPERTIES, resolve)
  )
    .map(([selector, declared], order) => ({ selector, declared, order }))
    .sort(
      (a, b) =>
        Number(!paints(a.declared)) - Number(!paints(b.declared)) ||
        Number(/:(hover|focus|active)/.test(a.selector)) - Number(/:(hover|focus|active)/.test(b.selector)) ||
        a.selector.split(/[\s>+~]+/).length - b.selector.split(/[\s>+~]+/).length ||
        a.order - b.order
    )
    .map(({ selector, declared }) => lineOf(selector, declared))
    .slice(0, MAX_COMPONENT_LINES);

  return { page, variables, text, components, sheets };
}

type Fetched = { text: string; url: string } | { error: string };

async function fetchText(url: string, maxBytes: number, fetchImpl: typeof fetch, accept: (type: string) => boolean, notAccepted: string): Promise<Fetched> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) return { error: `the site answered HTTP ${response.status}` };
    if (!accept(response.headers.get('content-type') || '')) return { error: notAccepted };
    return { text: await readCapped(response, maxBytes), url: response.url || url };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return { error: timedOut ? 'the site took too long to answer' : 'the site could not be reached' };
  } finally {
    clearTimeout(timer);
  }
}

/** Stylesheet addresses of a page, its own host first (a theme's CSS) and other hosts (CDNs, fonts) after */
function stylesheetUrls(doc: Document, pageUrl: string): string[] {
  const origin = new URL(pageUrl).origin;
  const urls: URL[] = [];
  doc.querySelectorAll('link[rel~="stylesheet" i][href]').forEach((link) => {
    if (/^print$/i.test(link.getAttribute('media')?.trim() ?? '')) return;
    try {
      const url = new URL(link.getAttribute('href') as string, pageUrl);
      if (/^https?:$/.test(url.protocol) && !urls.some((known) => known.href === url.href)) urls.push(url);
    } catch {
      // not an address
    }
  });
  const own = urls.filter((url) => url.origin === origin);
  return [...own, ...urls.filter((url) => url.origin !== origin)].slice(0, MAX_SHEETS).map((url) => url.href);
}

/** Read one page and its stylesheets. Never throws: the reason comes back in `error`. */
export async function fetchWebDesign(page: string, fetchImpl: typeof fetch = fetch): Promise<WebDesignResult> {
  const html = await fetchText(page, MAX_HTML_BYTES, fetchImpl, (type) => !type || /html/i.test(type), 'the address is not a web page');
  if ('error' in html) return { ok: false, error: html.error };

  const doc = new DOMParser().parseFromString(html.text, 'text/html');
  const inline = Array.from(doc.querySelectorAll('style'), (style) => style.textContent ?? '').filter((css) => css.trim()).slice(0, MAX_INLINE_STYLES);
  // A stylesheet that cannot be read is skipped; the others still describe the site
  const linked = await Promise.all(
    stylesheetUrls(doc, html.url).map((url) => fetchText(url, MAX_SHEET_BYTES, fetchImpl, (type) => !/html/i.test(type), 'not a stylesheet'))
  );

  const design = extractDesign(page, [...linked.flatMap((sheet) => ('text' in sheet ? [sheet.text] : [])), ...inline]);
  if (design.sheets === 0) return { ok: false, error: 'no stylesheets could be read from the page' };
  if (design.variables.length + design.text.length + design.components.length === 0) {
    return { ok: false, error: 'no colours, fonts or button styles found in its CSS (the site may style itself with JavaScript)' };
  }
  return { ok: true, design };
}

export type GatheredDesign =
  | { ok: true; design: WebDesign; render?: { ok: true; elements: number } | { ok: false; error: string } }
  | { ok: false; error: string };

/**
 * The design of a page from both sources: its stylesheets (names, variables, rules) and, when `render`
 * is given, the page drawn in a background tab (which colour and font each part really has). Either
 * one is enough; the stylesheets stay the fallback when the page cannot be drawn.
 */
export async function gatherWebDesign(
  page: string,
  { fetchImpl = fetch, render }: { fetchImpl?: typeof fetch; render?: (page: string) => Promise<RenderedResult> } = {}
): Promise<GatheredDesign> {
  const [css, drawn] = await Promise.all([fetchWebDesign(page, fetchImpl), render ? render(page) : Promise.resolve(undefined)]);
  const lines = drawn?.ok ? drawn.lines : undefined;
  const render_ = drawn && (drawn.ok ? ({ ok: true, elements: drawn.elements } as const) : drawn);

  if (css.ok) return { ok: true, design: { ...css.design, ...(lines ? { rendered: lines } : {}) }, ...(render_ ? { render: render_ } : {}) };
  if (lines && render_) return { ok: true, design: { page, variables: [], text: [], components: [], sheets: 0, rendered: lines }, render: render_ };
  return { ok: false, error: drawn && !drawn.ok ? `${css.error} (and ${drawn.error})` : css.error };
}
