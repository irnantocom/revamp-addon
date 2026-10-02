export type HtmlAssetKind = 'image' | 'media';

export interface SrcsetCandidate {
  url: string;
  descriptor: string;
}

export function parseSrcset(srcset: string): SrcsetCandidate[] {
  // HTML spec algorithm: a URL is a run of non-whitespace (it may contain commas); the
  // descriptor, if any, runs up to the next comma.
  const candidates: SrcsetCandidate[] = [];
  let i = 0;
  const n = srcset.length;

  while (i < n) {
    while (i < n && /[\s,]/.test(srcset[i])) i++;
    if (i >= n) break;

    let start = i;
    while (i < n && !/\s/.test(srcset[i])) i++;
    let url = srcset.slice(start, i);

    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      start = i;
      let depth = 0;
      while (i < n && !(srcset[i] === ',' && depth === 0)) {
        if (srcset[i] === '(') depth++;
        if (srcset[i] === ')') depth--;
        i++;
      }
      descriptor = srcset.slice(start, i).trim();
    }
    if (url) candidates.push({ url, descriptor });
  }
  return candidates;
}

export function serializeSrcset(candidates: SrcsetCandidate[]): string {
  return candidates.map((c) => (c.descriptor ? `${c.url} ${c.descriptor}` : c.url)).join(', ');
}

const skip = (url: string) => !url || /^(data:|blob:|about:|javascript:|#)/i.test(url.trim());

/**
 * Visit every asset reference in an HTML tree and let `fn` rewrite it. `fn` gets the URL as written and
 * returns the replacement (or null to keep it). Used twice: once to make URLs absolute, and again to
 * point them at downloaded files.
 */
export function rewriteHtmlAssets(
  root: ParentNode,
  fn: (url: string, kind: HtmlAssetKind) => string | null
): void {
  const setAttr = (el: Element, attr: string, kind: HtmlAssetKind) => {
    const value = el.getAttribute(attr);
    if (value === null || skip(value)) return;
    const mapped = fn(value.trim(), kind);
    if (mapped !== null && mapped !== value) el.setAttribute(attr, mapped);
  };

  const setSrcset = (el: Element, attr: string) => {
    const value = el.getAttribute(attr);
    if (!value) return;
    const mapped = parseSrcset(value).map((c) => {
      if (skip(c.url)) return c;
      return { url: fn(c.url, 'image') ?? c.url, descriptor: c.descriptor };
    });
    el.setAttribute(attr, serializeSrcset(mapped));
  };

  root.querySelectorAll('img[src]').forEach((el) => setAttr(el, 'src', 'image'));
  root.querySelectorAll('img[srcset], source[srcset]').forEach((el) => setSrcset(el, 'srcset'));
  root.querySelectorAll('input[type="image"][src]').forEach((el) => setAttr(el, 'src', 'image'));
  root.querySelectorAll('video[poster]').forEach((el) => setAttr(el, 'poster', 'image'));
  root
    .querySelectorAll('link[rel~="icon"][href], link[rel="apple-touch-icon"][href], link[rel="shortcut icon"][href]')
    .forEach((el) => setAttr(el, 'href', 'image'));

  // <source src> is an image inside <picture>, otherwise video/audio
  root.querySelectorAll('source[src]').forEach((el) => {
    const parent = el.parentElement?.tagName;
    setAttr(el, 'src', parent === 'PICTURE' ? 'image' : 'media');
  });
  root.querySelectorAll('video[src], audio[src]').forEach((el) => setAttr(el, 'src', 'media'));

  // Inline SVG <image>
  root.querySelectorAll('image').forEach((el) => {
    setAttr(el, 'href', 'image');
    setAttr(el, 'xlink:href', 'image');
  });

  // Inline styles: background-image and friends
  root.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style') || '';
    if (/url\(|image-set\(/i.test(style)) el.setAttribute('style', rewriteStyleUrls(style, fn));
  });
}

/** Rewrite url()s in a style attribute; `fn` decides what each URL becomes. */
function rewriteStyleUrls(style: string, fn: (url: string, kind: HtmlAssetKind) => string | null): string {
  return style.replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"][^)]*?))\s*\)/gi,
    (whole, dq, sq, bare) => {
      const raw = (dq ?? sq ?? bare ?? '') as string;
      if (skip(raw)) return whole;
      const mapped = fn(raw.trim(), 'image');
      return mapped === null ? whole : `url("${mapped.replace(/"/g, '%22')}")`;
    }
  );
}
