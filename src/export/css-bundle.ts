/**
 * Text-level CSS helpers for building a self-contained stylesheet:
 * making url()s absolute, mapping them to local files, and flattening @import.
 */

export type CssAssetKind = 'image' | 'font';

const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"][^)]*?))\s*\)/gi;
const IMAGE_SET_RE = /image-set\(([^)]*)\)/gi;
const FONT_FACE_RE = /@font-face\s*\{[^}]*\}/gi;
const IMPORT_RE = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"][^)]*?))\s*\)|"([^"]*)"|'([^']*)')\s*([^;]*);/gi;

const skipUrl = (url: string): boolean =>
  !url || /^(data:|blob:|about:|javascript:|#)/i.test(url.trim());

function resolveUrl(url: string, base: string): string | null {
  try {
    return new URL(url.trim(), base).href;
  } catch {
    return null;
  }
}

/**
 * Replace every asset URL in `css`. `fn` receives the absolute URL and what kind of asset it is,
 * and returns the replacement, or null to leave the URL absolute but otherwise untouched.
 * `base` is where relative URLs in this CSS come from (the stylesheet's own URL).
 */
export function mapCssUrls(
  css: string,
  base: string,
  fn: (absoluteUrl: string, kind: CssAssetKind) => string | null
): string {
  const rewriteSegment = (segment: string, kind: CssAssetKind): string => {
    let out = segment.replace(URL_RE, (whole, dq, sq, bare) => {
      const raw = dq ?? sq ?? bare ?? '';
      if (skipUrl(raw)) return whole;
      const abs = resolveUrl(raw, base);
      if (!abs) return whole;
      const mapped = fn(abs, kind) ?? abs;
      return `url("${mapped.replace(/"/g, '%22')}")`;
    });

    // image-set("a.png" 1x, "b.png" 2x): URLs are bare strings
    out = out.replace(IMAGE_SET_RE, (whole, inner: string) => {
      const mapped = inner.replace(/(["'])(.+?)\1/g, (m, quote, raw) => {
        if (skipUrl(raw)) return m;
        const abs = resolveUrl(raw, base);
        if (!abs) return m;
        return `${quote}${(fn(abs, 'image') ?? abs).replace(/"/g, '%22')}${quote}`;
      });
      return whole.replace(inner, mapped);
    });
    return out;
  };

  // @font-face blocks hold fonts; everything else is treated as images
  let result = '';
  let last = 0;
  for (const match of css.matchAll(FONT_FACE_RE)) {
    const start = match.index ?? 0;
    result += rewriteSegment(css.slice(last, start), 'image');
    result += rewriteSegment(match[0], 'font');
    last = start + match[0].length;
  }
  result += rewriteSegment(css.slice(last), 'image');
  return result;
}

/** Every distinct absolute asset URL referenced by `css` */
export function extractCssUrls(css: string, base: string): Array<{ url: string; kind: CssAssetKind }> {
  const found = new Map<string, CssAssetKind>();
  mapCssUrls(css, base, (url, kind) => {
    // A font reference wins if the same file is also used as an image
    if (!found.has(url) || kind === 'font') found.set(url, kind);
    return null;
  });
  return Array.from(found, ([url, kind]) => ({ url, kind }));
}

export interface CssImport {
  url: string;
  media: string;
}

/** @import rules with absolute URLs. They must be inlined, since a file:// bundle can't rely on them. */
export function extractImports(css: string, base: string): CssImport[] {
  const imports: CssImport[] = [];
  for (const m of css.matchAll(IMPORT_RE)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
    const abs = skipUrl(raw) ? null : resolveUrl(raw, base);
    if (abs) imports.push({ url: abs, media: (m[6] || '').trim() });
  }
  return imports;
}

export function removeImports(css: string): string {
  return css.replace(IMPORT_RE, '');
}

/** Wrap CSS in an @media block when it only applies to some media (e.g. a print stylesheet) */
export function wrapMedia(css: string, media?: string | null): string {
  const m = (media || '').trim();
  if (!m || m.toLowerCase() === 'all') return css;
  return `@media ${m} {\n${css}\n}`;
}

/**
 * Keep one font file per face. A face usually lists woff2, woff and ttf; every browser the
 * export targets reads woff2, so downloading the rest only makes the package bigger.
 */
export function pruneFontSources(css: string): string {
  return css.replace(FONT_FACE_RE, (block) => {
    const decls = Array.from(block.matchAll(/src\s*:\s*([^;}]+)/gi));
    const woff2 = decls
      .flatMap((d) => splitTopLevel(d[1]))
      .find((entry) => /woff2/i.test(entry));
    if (!woff2) return block;

    // Replace the first src declaration with the woff2 entry and drop the older fallbacks (eot, ttf...)
    let first = true;
    return block.replace(/src\s*:\s*[^;}]+;?/gi, () => {
      if (!first) return '';
      first = false;
      return `src: ${woff2.trim()};`;
    });
  });
}

/** Split on commas that are not inside parentheses or quotes */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const ch of list) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}
