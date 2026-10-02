import { SelectorGenerator } from './selector-generator';

/**
 * A durable description of an element that can be resolved again after a page
 * reload, when in-memory Revamp ids no longer exist.
 */
export interface Locator {
  /** Structural CSS path (or XPath) captured when the element was targeted */
  selector: string;
  tag: string;
  /** Start of the element's normalized text, used to confirm / re-find it */
  text: string;
  /** Position among elements with the same tag and text start (for repeated items) */
  ord: number;
}

const TEXT_KEY_LENGTH = 80;

const textKey = (el: Element): string =>
  (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, TEXT_KEY_LENGTH);

const sameKey = (el: Element, tag: string, text: string): boolean =>
  el.tagName.toLowerCase() === tag && textKey(el) === text;

export function captureLocator(el: Element): Locator {
  const tag = el.tagName.toLowerCase();
  const text = textKey(el);
  const same = Array.from(document.getElementsByTagName(tag)).filter((c) => textKey(c) === text);

  return {
    selector: SelectorGenerator.generate(el).selector,
    tag,
    text,
    ord: Math.max(0, same.indexOf(el)),
  };
}

/**
 * Find the element a locator describes. Tries, in order:
 *  1. the stored selector, if it still points at the same kind of element with the same text
 *  2. any element with the same tag and text (using the ordinal to pick among repeats)
 *  3. the stored selector alone (the site's text changed but the structure did not)
 */
export function resolveLocator(loc: Locator): Element | null {
  const { elements } = SelectorGenerator.query(loc.selector);

  if (elements.length === 1 && sameKey(elements[0], loc.tag, loc.text)) return elements[0];

  if (loc.text) {
    const same = Array.from(document.getElementsByTagName(loc.tag)).filter((c) => textKey(c) === loc.text);
    if (same.length > 0) return same[Math.min(loc.ord, same.length - 1)];
  }

  if (elements.length === 1 && elements[0].tagName.toLowerCase() === loc.tag) return elements[0];

  return null;
}
