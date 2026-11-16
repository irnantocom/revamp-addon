/**
 * What lazy-loading plugins (lazysizes, WP Rocket, LiteSpeed, a3 Lazy Load, native scripts) leave on an image:
 * the real picture in a data-* attribute and a placeholder in `src`. When the image nears the screen the
 * plugin copies the data-* value into `src`/`srcset`.
 */
export const LAZY_SRC_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-srcset-src'];
export const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset'];
export const LAZY_BG_ATTRS = ['data-bg', 'data-background', 'data-bg-src', 'data-background-image', 'data-lazy-background'];

/** A 1px / inline placeholder that a lazy-loader replaces later */
export const isPlaceholderSrc = (src: string | null): boolean =>
  !src || /^data:image\/(gif|svg\+xml|png);/i.test(src) || /(^|\/)(blank|placeholder|spacer|pixel|lazy)[^/]*\.(gif|png|svg|jpg)/i.test(src);

/** The picture a lazy image will show once its loader has run, or null when it keeps none */
export const lazyOriginal = (el: Element): string | null => {
  for (const attr of LAZY_SRC_ATTRS) {
    const value = el.getAttribute(attr)?.trim();
    if (value) return value;
  }
  return null;
};
