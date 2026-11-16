import { NOISE_SELECTORS, isTrackingUrl } from './tracking';
import { rewriteHtmlAssets } from './html-assets';
import { PageSnapshot, SheetSource } from './types';
import { LAZY_BG_ATTRS, LAZY_SRCSET_ATTRS, LAZY_SRC_ATTRS, isPlaceholderSrc } from '../utils/lazy-images';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const absolute = (value: string, base: string): string => {
  try {
    return new URL(value.trim(), base).href;
  } catch {
    return value;
  }
};

/**
 * Collect every stylesheet in cascade order, following @import. Cross-origin sheets can't be read from the
 * page, so they are returned as "fetch me" entries.
 */
export function collectStyleSheets(doc: Document): { sheets: SheetSource[]; warnings: string[] } {
  const sheets: SheetSource[] = [];
  const warnings: string[] = [];
  const seen = new Set<CSSStyleSheet>();

  const visit = (sheet: CSSStyleSheet, depth: number) => {
    if (seen.has(sheet) || depth > 6 || sheet.disabled) return;
    seen.add(sheet);

    const owner = sheet.ownerNode as Element | null;
    if (owner && (owner.id === 'revamp-inspector-styles' || owner.closest?.('[data-revamp-ui]'))) return;
    const href = sheet.href;
    if (href && isTrackingUrl(href)) return;

    const baseUrl = href || doc.baseURI;
    const media = sheet.media?.mediaText || undefined;

    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      if (href) sheets.push({ baseUrl, css: null, fetchUrl: href, media });
      else warnings.push('A stylesheet could not be read and has no URL to fetch; it was skipped.');
      return;
    }

    let buffer: string[] = [];
    const flush = () => {
      if (buffer.length) sheets.push({ baseUrl, css: buffer.join('\n'), media });
      buffer = [];
    };

    for (const rule of Array.from(rules)) {
      if (rule.type === 3) {
        // @import: the imported sheet comes first in cascade order
        flush();
        const imported = (rule as CSSImportRule).styleSheet;
        if (imported) visit(imported, depth + 1);
        else {
          const target = absolute((rule as CSSImportRule).href, baseUrl);
          if (!isTrackingUrl(target)) {
            sheets.push({ baseUrl: target, css: null, fetchUrl: target, media: (rule as CSSImportRule).media?.mediaText || undefined });
          }
        }
      } else {
        buffer.push(rule.cssText);
      }
    }
    flush();
  };

  Array.from(doc.styleSheets).forEach((s) => visit(s, 0));
  ((doc as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets || []).forEach((s) => visit(s, 0));

  return { sheets, warnings };
}

/** Attributes lazy-loaders keep the original image in. Stale once the image is resolved, and misleading if a script re-runs. */
const LAZY_LEFTOVER_ATTRS = [
  ...LAZY_SRC_ATTRS, ...LAZY_SRCSET_ATTRS, 'data-sizes', 'data-lazyloaded', 'data-ll-status', 'data-lazy-sizes',
];

/**
 * Make lazy-loaded content real: swap data-src into src, data-bg into a background-image, drop loading="lazy".
 *
 * Only images that have NOT been loaded yet are touched (src missing or a placeholder). An image whose src is
 * already real was either loaded by the page's own loader or replaced by the user, and its data-src/data-srcset
 * still describe the *original* picture: copying them over would bring the old image back.
 */
export function activateLazyContent(root: ParentNode): void {
  const unresolved = (img: Element | null) => !!img && isPlaceholderSrc(img.getAttribute('src'));

  // <source> elements are judged first: activating their <img> would make the picture look "resolved"
  root.querySelectorAll('picture > source').forEach((source) => {
    const img = source.parentElement?.querySelector('img') ?? null;
    if (unresolved(img) && !source.getAttribute('srcset')) {
      for (const attr of LAZY_SRCSET_ATTRS) {
        const value = source.getAttribute(attr);
        if (value) {
          source.setAttribute('srcset', value);
          break;
        }
      }
    }
    LAZY_LEFTOVER_ATTRS.forEach((attr) => source.removeAttribute(attr));
  });

  root.querySelectorAll('img').forEach((img) => {
    if (unresolved(img)) {
      for (const attr of LAZY_SRC_ATTRS) {
        const value = img.getAttribute(attr);
        if (value) {
          img.setAttribute('src', value);
          break;
        }
      }
      for (const attr of LAZY_SRCSET_ATTRS) {
        const value = img.getAttribute(attr);
        if (value) {
          img.setAttribute('srcset', value);
          break;
        }
      }
    }
    img.removeAttribute('loading');
    LAZY_LEFTOVER_ATTRS.forEach((attr) => img.removeAttribute(attr));
  });

  root.querySelectorAll('iframe[loading]').forEach((el) => el.removeAttribute('loading'));

  for (const attr of LAZY_BG_ATTRS) {
    root.querySelectorAll(`[${attr}]`).forEach((el) => {
      const value = el.getAttribute(attr);
      const style = el.getAttribute('style') || '';
      if (value && !/background(-image)?\s*:[^;]*url\(/i.test(style) && !/^\s*(#|rgb|hsl)/i.test(value)) {
        el.setAttribute('style', `${style}${style && !style.trim().endsWith(';') ? ';' : ''}background-image:url("${value.replace(/"/g, '%22')}")`);
      }
    });
  }
}

export interface CleanOptions {
  keepScripts: boolean;
}

/**
 * Strip a cloned document down to layout: no tracking, no consent/chat widgets, no inline handlers,
 * no stylesheets (collected separately), and every URL absolute.
 */
export function cleanClone(clone: HTMLElement, base: string, options: CleanOptions): string[] {
  const warnings: string[] = [];
  const count = { tracking: 0, scripts: 0 };

  // Revamp's own UI and bookkeeping
  clone.querySelectorAll('[data-revamp-ui], #revamp-inspector-styles').forEach((el) => el.remove());
  clone.querySelectorAll('[data-revamp-hidden], [data-revamp-display]').forEach((el) => {
    el.removeAttribute('data-revamp-hidden');
    el.removeAttribute('data-revamp-display');
  });

  clone.querySelectorAll(NOISE_SELECTORS).forEach((el) => el.remove());

  // Comments
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));

  // Scripts
  clone.querySelectorAll('script').forEach((script) => {
    const src = script.getAttribute('src');
    const tracking = src ? isTrackingUrl(absolute(src, base)) : false;
    if (!options.keepScripts || tracking) {
      script.remove();
      if (tracking) count.tracking++;
      else count.scripts++;
    } else if (src) {
      script.setAttribute('src', absolute(src, base));
      script.removeAttribute('integrity');
    }
  });
  clone.querySelectorAll('noscript').forEach((el) => el.remove());

  // <head> leftovers that don't affect the layout
  clone.querySelectorAll('link').forEach((link) => {
    const rel = (link.getAttribute('rel') || '').toLowerCase();
    if (!/\bicon\b|apple-touch-icon/.test(rel)) link.remove();
  });
  clone.querySelectorAll('style, base, meta[http-equiv]').forEach((el) => el.remove());

  // Tracking pixels, beacons and frames
  clone.querySelectorAll('img[src], iframe[src], embed[src], object[data], source[src]').forEach((el) => {
    const raw = el.getAttribute('src') || el.getAttribute('data') || '';
    if (raw && isTrackingUrl(absolute(raw, base))) {
      el.remove();
      count.tracking++;
    }
  });

  // Inline handlers and javascript: links would run (or error) offline. integrity/nonce/crossorigin
  // only make sense for the original origin and can block a locally served copy.
  clone.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const isHandler = /^on[a-z]+$/.test(name);
      if ((isHandler && !options.keepScripts) || name === 'integrity' || name === 'nonce' || name === 'crossorigin') {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'A' && /^\s*javascript:/i.test(el.getAttribute('href') || '')) el.setAttribute('href', '#');
  });

  activateLazyContent(clone);

  // Absolute URLs everywhere, so nothing depends on the page's location
  rewriteHtmlAssets(clone, (url) => absolute(url, base));
  clone.querySelectorAll('a[href], area[href], form[action]').forEach((el) => {
    const attr = el.hasAttribute('href') ? 'href' : 'action';
    const value = el.getAttribute(attr) || '';
    if (!value || value.startsWith('#') || /^(mailto:|tel:|sms:|javascript:)/i.test(value)) return;
    el.setAttribute(attr, absolute(value, base));
  });

  if (count.tracking) warnings.push(`Removed ${count.tracking} tracking/consent/chat element(s).`);
  if (count.scripts && !options.keepScripts) warnings.push(`Removed ${count.scripts} script(s). The export is layout-only; interactive features (menus, sliders) will not run.`);
  return warnings;
}

/** Scroll top to bottom so scroll-triggered loaders and reveal animations run, then restore the position. */
export async function scrollThroughPage(maxMs = 20000): Promise<void> {
  const startX = window.scrollX;
  const startY = window.scrollY;
  const root = document.documentElement;
  const previous = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  const began = Date.now();

  try {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < root.scrollHeight && Date.now() - began < maxMs; y += step) {
      window.scrollTo(0, y);
      await sleep(120);
    }
    window.scrollTo(0, root.scrollHeight);
    await sleep(250);

    const pending = Array.from(document.images).filter((img) => !img.complete);
    await Promise.race([Promise.all(pending.map((img) => img.decode().catch(() => undefined))), sleep(3000)]);
  } finally {
    root.style.scrollBehavior = previous;
    window.scrollTo(startX, startY);
    // Scroll listeners (sticky/transparent headers, back-to-top buttons) run on the next frames.
    // Wait for them so the snapshot shows the page as it looks at the restored position.
    await sleep(400);
  }
}

/** Attributes of user-edited elements that must survive the page's own scripts */
const PINNED_ATTRS = ['src', 'srcset', 'sizes', 'style', 'href', 'poster'];

export interface PinnedElement {
  el: Element;
  attrs: Record<string, string | null>;
}

/** Remember the edited state of elements, so it can be restored if a script changes it meanwhile */
export function pinAttributes(elements: Element[]): PinnedElement[] {
  return elements.map((el) => ({
    el,
    attrs: Object.fromEntries(PINNED_ATTRS.map((name) => [name, el.getAttribute(name)])),
  }));
}

export function restorePinned(pins: PinnedElement[]): void {
  for (const { el, attrs } of pins) {
    for (const [name, value] of Object.entries(attrs)) {
      if (el.getAttribute(name) === value) continue;
      if (value === null) el.removeAttribute(name);
      else el.setAttribute(name, value);
    }
  }
}

export async function capturePageSnapshot(options: {
  keepScripts: boolean;
  scrollFirst: boolean;
  /** Elements the user edited in demo mode. Scrolling runs lazy-loaders that would otherwise overwrite them. */
  editedElements?: Element[];
}): Promise<PageSnapshot> {
  const pins = pinAttributes(options.editedElements || []);
  if (options.scrollFirst) {
    await scrollThroughPage();
    restorePinned(pins);
  }

  const base = document.baseURI;
  const warnings: string[] = [];

  const { sheets, warnings: sheetWarnings } = collectStyleSheets(document);
  warnings.push(...sheetWarnings);

  const clone = document.documentElement.cloneNode(true) as HTMLElement;

  // Shadow DOM content is not part of cloneNode and is not exported
  let shadowHosts = 0;
  document.querySelectorAll('*').forEach((el) => {
    if (el.shadowRoot) shadowHosts++;
  });
  if (shadowHosts) warnings.push(`${shadowHosts} element(s) use Shadow DOM; their inner content is not exported.`);

  warnings.push(...cleanClone(clone, base, { keepScripts: options.keepScripts }));

  if (document.querySelector('canvas')) warnings.push('The page contains <canvas> content, which is not exported.');

  return {
    url: location.href,
    title: document.title,
    html: clone.outerHTML,
    sheets,
    warnings,
  };
}
