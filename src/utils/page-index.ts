/**
 * Page index: gives meaningful page elements a numeric Revamp ID and renders
 * a compact table the AI can reference ("[12] h1 ..."). Nothing is written to
 * the page DOM: ids live in a WeakMap, so they are stable across re-indexing
 * within one page session and never leak into exported HTML.
 */

import { SectionInfo } from '../types/demo';

const LANDMARK_TAGS = new Set(['header', 'nav', 'main', 'section', 'article', 'aside', 'footer', 'form']);
const TEXT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'button', 'li', 'label',
  'blockquote', 'figcaption', 'dt', 'dd', 'th', 'td', 'summary', 'span',
]);
const MEDIA_TAGS = new Set(['img', 'video', 'picture', 'iframe']);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'link', 'meta']);

/** Smaller boxes with a background image are icons and sprites, not something to restyle */
const BG_MIN_WIDTH = 100;
const BG_MIN_HEIGHT = 50;
const BG_PREVIEW = 300;

/** Page furniture that a content rewrite should leave alone, so it is never offered for hiding */
const FURNITURE_TAGS = new Set(['header', 'nav', 'footer']);

const MAX_ENTRIES = 400;
const TEXT_PREVIEW = 80;
/** Editable text is shown in full up to this length, so the AI can rewrite or translate all of it */
const TEXT_FULL = 800;
/** Once the index has used this many characters, remaining text falls back to short previews */
const TEXT_BUDGET = 40000;

export class PageIndex {
  private ids = new WeakMap<Element, number>();
  private refs = new Map<number, WeakRef<Element>>();
  private nextId = 1;
  /** Characters of full text emitted during the current build() */
  private textUsed = 0;
  /** Elements hidden by Revamp itself, so they stay listed (and can be shown again) */
  private hiddenByRevamp = new WeakSet<Element>();

  markHidden(el: Element, hidden: boolean): void {
    if (hidden) this.hiddenByRevamp.add(el);
    else this.hiddenByRevamp.delete(el);
  }

  idOf(el: Element): number {
    let id = this.ids.get(el);
    if (id === undefined) {
      id = this.nextId++;
      this.ids.set(el, id);
      this.refs.set(id, new WeakRef(el));
    }
    return id;
  }

  /** Resolve an id; null if unknown or the element left the document */
  resolve(id: number): Element | null {
    const el = this.refs.get(id)?.deref();
    return el && el.isConnected ? el : null;
  }

  /**
   * Build the index text for the subtree under `root`.
   * Entries are indented by nesting depth among indexed elements.
   */
  build(root: Element): { text: string; count: number; truncated: boolean } {
    const lines: string[] = [];
    let truncated = false;
    this.textUsed = 0;

    const walk = (el: Element, depth: number) => {
      if (lines.length >= MAX_ENTRIES) {
        truncated = true;
        return;
      }

      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag) || el.closest('[data-revamp-ui]')) return;

      const hidden = !this.isVisible(el);
      if (hidden && !this.hiddenByRevamp.has(el)) return;

      let line = this.describe(el, tag, hidden);
      const background = MEDIA_TAGS.has(tag) ? '' : this.backgroundFlag(el);
      if (background) line = `${line ?? `[${this.idOf(el)}] ${tag} (block)${hidden ? ' (HIDDEN)' : ''}`}${background}`;
      const childDepth = line ? depth + 1 : depth;
      if (line) lines.push('  '.repeat(depth) + line);
      if (hidden) return;

      // Media and text leaves are described fully; don't descend into them
      if (MEDIA_TAGS.has(tag) || (line && this.isTextLeaf(el, tag))) return;

      for (const child of Array.from(el.children)) walk(child, childDepth);
    };

    walk(root, 0);

    return { text: lines.join('\n'), count: lines.length, truncated };
  }

  /**
   * Top-level page sections: the visible children of the page's main wrapper,
   * with <main> expanded into its own blocks. Sections hidden by Revamp stay listed.
   */
  listSections(): SectionInfo[] {
    const blocks = (container: Element): Element[] =>
      Array.from(container.children).filter((child) => {
        if (SKIP_TAGS.has(child.tagName.toLowerCase()) || child.closest('[data-revamp-ui]')) return false;
        if (this.hiddenByRevamp.has(child)) return true;
        return child instanceof HTMLElement && this.isVisible(child) && child.offsetHeight >= 40;
      });

    // Descend through single-child wrappers (#root > div > div ...)
    let container: Element = document.body;
    for (let depth = 0; depth < 4; depth++) {
      const kids = blocks(container);
      if (kids.length === 1 && kids[0].children.length > 0 && !LANDMARK_TAGS.has(kids[0].tagName.toLowerCase())) {
        container = kids[0];
      } else break;
    }

    let items: Element[] = [];
    for (const child of blocks(container)) {
      const inner = child.tagName.toLowerCase() === 'main' ? blocks(child) : [];
      if (inner.length >= 2) items.push(...inner);
      else items.push(child);
    }
    items = items.slice(0, 60);

    return items.map((el) => {
      const siblings = items.filter((other) => other.parentElement === el.parentElement);
      const pos = siblings.indexOf(el);
      const heading = el.querySelector('h1,h2,h3,h4,h5,h6');
      const label =
        el.getAttribute('aria-label') ||
        (heading?.textContent || '').trim() ||
        (el.id ? `#${el.id}` : '') ||
        el.tagName.toLowerCase();
      return {
        id: this.idOf(el),
        label: this.clip(label, 60) || el.tagName.toLowerCase(),
        tag: el.tagName.toLowerCase(),
        hidden: this.hiddenByRevamp.has(el),
        canMoveUp: pos > 0,
        canMoveDown: pos !== -1 && pos < siblings.length - 1,
        previousId: pos > 0 ? this.idOf(siblings[pos - 1]) : undefined,
        nextId: pos !== -1 && pos < siblings.length - 1 ? this.idOf(siblings[pos + 1]) : undefined,
      };
    });
  }

  /**
   * Sections that no target element sits in: what a page-wide rewrite from a document would leave
   * as it was. Hidden sections and the header, navigation and footer are not reported.
   */
  untouchedSections(targetIds: number[]): SectionInfo[] {
    const targets = targetIds.map((id) => this.resolve(id)).filter((el): el is Element => el !== null);
    return this.listSections().filter((section) => {
      if (section.hidden || FURNITURE_TAGS.has(section.tag)) return false;
      const el = this.resolve(section.id);
      return el !== null && !targets.some((target) => el.contains(target));
    });
  }

  private describe(el: Element, tag: string, hidden: boolean): string | null {
    const flags = hidden ? ' (HIDDEN)' : '';

    if (tag === 'img') {
      const img = el as HTMLImageElement;
      const src = img.currentSrc || img.getAttribute('src') || '';
      return `[${this.idOf(el)}] img alt="${this.clip(img.alt, 40)}" src="${this.clip(src, 120)}"${flags}`;
    }

    if (MEDIA_TAGS.has(tag)) {
      return `[${this.idOf(el)}] ${tag}${flags}`;
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      const label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.name || '';
      return `[${this.idOf(el)}] ${tag}${el instanceof HTMLInputElement ? `[${el.type}]` : ''} "${this.clip(label, TEXT_PREVIEW)}"${flags}`;
    }

    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      return `[${this.idOf(el)}] a "${this.editableText(el)}" href="${this.clip(href, 100)}"${flags}`;
    }

    if (LANDMARK_TAGS.has(tag) || this.isSectionCandidate(el)) {
      const heading = el.querySelector('h1,h2,h3,h4,h5,h6');
      const name = el.getAttribute('aria-label') || heading?.textContent || '';
      const label = name.trim() ? ` "${this.clip(name, 60)}"` : '';
      const idPart = el.id ? ` #${el.id}` : '';
      return `[${this.idOf(el)}] ${LANDMARK_TAGS.has(tag) ? tag : `${tag} (block)`}${idPart}${label}${flags}`;
    }

    if (TEXT_TAGS.has(tag)) {
      const text = this.ownText(el);
      if (!text) return null;
      return `[${this.idOf(el)}] ${tag} "${this.editableText(el)}"${flags}`;
    }

    // Generic containers (div, etc.) that hold their own text, e.g. <div>Welcome</div>
    if (this.hasDirectText(el)) {
      return `[${this.idOf(el)}] ${tag} "${this.editableText(el)}"${flags}`;
    }

    return null;
  }

  /**
   * The computed background-image of a sizeable element, shown whole so the AI can keep gradient
   * layers when it swaps the picture. Empty when there is no url() layer.
   */
  private backgroundFlag(el: Element): string {
    if (!(el instanceof HTMLElement)) return '';
    const value = getComputedStyle(el).backgroundImage;
    if (!value || !/url\(/i.test(value)) return '';
    if (el.offsetWidth < BG_MIN_WIDTH || el.offsetHeight < BG_MIN_HEIGHT) return '';
    return ` bg-image="${this.clip(value, BG_PREVIEW)}"`;
  }

  /** Text leaves are fully described by their line; their children are inline noise */
  private isTextLeaf(el: Element, tag: string): boolean {
    if (tag === 'a' || tag === 'button') return true;
    if (!TEXT_TAGS.has(tag)) return el.children.length === 0;
    if (tag === 'li') return false;
    return !el.querySelector('img,video,iframe,a,button');
  }

  /** Large block directly inside body/landmarks that likely forms a page section */
  private isSectionCandidate(el: Element): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const parent = el.parentElement;
    if (!parent) return false;
    const parentTag = parent.tagName.toLowerCase();
    const parentIsRoot = parentTag === 'body' || parentTag === 'main' || parent.id === 'root' || parent.id === 'app' || parent.id === '__next';
    if (!parentIsRoot || el.children.length === 0) return false;
    return el.offsetHeight >= 80;
  }

  private hasDirectText(el: Element): boolean {
    return Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim().length > 0
    );
  }

  private ownText(el: Element): string {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Text of an editable element. Shown in full so rewrites/translations cover all of it;
   * when it has to be cut, the marker says so and how long the original is.
   */
  private editableText(el: Element): string {
    const text = this.ownText(el).replace(/"/g, "'");
    const limit = this.textUsed < TEXT_BUDGET ? TEXT_FULL : TEXT_PREVIEW;
    if (text.length <= limit) {
      this.textUsed += text.length;
      return text;
    }
    this.textUsed += limit;
    return `${text.slice(0, limit)} …[TRUNCATED: ${text.length} chars total]`;
  }

  private clip(text: string, max: number): string {
    const t = (text || '').replace(/\s+/g, ' ').trim().replace(/"/g, "'");
    return t.length > max ? t.slice(0, max) + '…' : t;
  }

  private isVisible(el: Element): boolean {
    if (!(el instanceof HTMLElement)) return true;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    // display:contents and zero-size inline wrappers are still walked into
    return style.display === 'contents' || el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
  }
}

export const pageIndex = new PageIndex();
