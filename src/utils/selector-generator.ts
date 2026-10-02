/**
 * Selector Generator Utility
 * Generates stable, production-ready CSS selectors for DOM elements
 * Priority: data-* attributes > unique IDs > CSS path > XPath (fallback)
 */

export interface SelectorInfo {
  selector: string;
  type: 'data-attribute' | 'id' | 'class' | 'css-path' | 'xpath';
  confidence: 'high' | 'medium' | 'low';
}

export class SelectorGenerator {
  /**
   * Generate the best possible selector for an element
   */
  static generate(element: Element): SelectorInfo {
    // Priority 1: data-* attributes
    const dataSelector = this.getDataAttributeSelector(element);
    if (dataSelector) {
      return {
        selector: dataSelector,
        type: 'data-attribute',
        confidence: 'high',
      };
    }

    // Priority 2: Unique ID
    const idSelector = this.getIdSelector(element);
    if (idSelector && this.isUnique(idSelector)) {
      return {
        selector: idSelector,
        type: 'id',
        confidence: 'high',
      };
    }

    // Priority 3: CSS path
    const cssPath = this.getCssPath(element);
    if (cssPath && this.isUnique(cssPath)) {
      return {
        selector: cssPath,
        type: 'css-path',
        confidence: 'medium',
      };
    }

    // Priority 4: XPath (fallback)
    const xpath = this.getXPath(element);
    return {
      selector: xpath,
      type: 'xpath',
      confidence: 'low',
    };
  }

  /**
   * Check for data-* attributes (highest priority)
   */
  private static getDataAttributeSelector(element: Element): string | null {
    const dataAttrs = ['data-testid', 'data-id', 'data-cy', 'data-test'];

    for (const attr of dataAttrs) {
      const value = element.getAttribute(attr);
      if (value) {
        const candidate = `[${attr}="${CSS.escape(value)}"]`;
        if (this.isUnique(candidate)) return candidate;
      }
    }

    // Check for any other data-* attributes
    for (const attr of element.getAttributeNames()) {
      if (attr.startsWith('data-')) {
        const value = element.getAttribute(attr);
        if (!value || attr.startsWith('data-revamp')) continue;
        const candidate = `[${attr}="${CSS.escape(value)}"]`;
        if (this.isUnique(candidate)) return candidate;
      }
    }

    return null;
  }

  /**
   * Generate ID-based selector
   */
  private static getIdSelector(element: Element): string | null {
    const id = element.id;
    if (!id) return null;

    // Avoid auto-generated IDs that might change
    if (/^[a-z0-9\-_]+$/i.test(id) && !id.match(/^(ember|react|vue)\d+/i)) {
      return `#${CSS.escape(id)}`;
    }

    return null;
  }

  /**
   * Generate CSS path selector
   */
  private static getCssPath(element: Element): string {
    const path: string[] = [];
    let current: Element | null = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      // A unique id anchors the path and stands in for this element's own segment
      if (current.id && this.isUnique(`#${CSS.escape(current.id)}`)) {
        path.unshift(`#${CSS.escape(current.id)}`);
        break;
      }

      let selector = current.tagName.toLowerCase();

      // Add nth-of-type if there are siblings with same tag
      const parent: Element | null = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (e) => e.tagName === current!.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          // nth-of-type counts siblings of the same tag, matching how index is computed
          selector += `:nth-of-type(${index})`;
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  /**
   * Generate XPath selector (fallback)
   */
  private static getXPath(element: Element): string {
    if (element.id) {
      return `//*[@id="${element.id}"]`;
    }

    const path: string[] = [];
    let current: Element | null = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 0;
      let sibling: Element | null = current;

      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === current.tagName) {
          index++;
        }
        sibling = sibling.previousElementSibling;
      }

      const tagName = current.tagName.toLowerCase();
      // Always index: "/section/h2" would match every section's h2, not just the first
      path.unshift(`${tagName}[${index}]`);

      current = current.parentElement;
    }

    return `/${path.join('/')}`;
  }

  /**
   * Check if a selector uniquely identifies a single element
   */
  private static isUnique(selector: string): boolean {
    try {
      const elements = document.querySelectorAll(selector);
      return elements.length === 1;
    } catch {
      return false;
    }
  }

  /**
   * Query all elements matching a CSS selector or XPath. Never throws.
   * Returns an error message when the selector is invalid.
   */
  static query(selector: string): { elements: Element[]; error?: string } {
    const sel = selector.trim();
    if (!sel) return { elements: [], error: 'Empty selector' };

    try {
      if (sel.startsWith('/') || sel.startsWith('(/')) {
        const snapshot = document.evaluate(
          sel,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        const elements: Element[] = [];
        for (let i = 0; i < snapshot.snapshotLength; i++) {
          const node = snapshot.snapshotItem(i);
          if (node && node.nodeType === Node.ELEMENT_NODE) elements.push(node as Element);
        }
        return { elements };
      }
      return { elements: Array.from(document.querySelectorAll(sel)) };
    } catch (e) {
      return { elements: [], error: `Invalid selector: ${sel}` };
    }
  }

  /**
   * Resolve an element from a selector (handles both CSS and XPath)
   */
  static resolve(selector: string, type: SelectorInfo['type']): Element | null {
    try {
      if (type === 'xpath') {
        const result = document.evaluate(
          selector,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        return result.singleNodeValue as Element | null;
      } else {
        return document.querySelector(selector);
      }
    } catch {
      return null;
    }
  }
}
