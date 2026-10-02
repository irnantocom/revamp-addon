/**
 * Highlight Overlay System
 * Provides visual feedback for element inspection and selection
 */

export interface OverlayStyles {
  borderColor?: string;
  borderWidth?: string;
  backgroundColor?: string;
  zIndex?: number;
}

export class HighlightOverlay {
  private overlay: HTMLDivElement | null = null;
  private label: HTMLDivElement | null = null;
  private readonly defaultStyles: Required<OverlayStyles> = {
    borderColor: '#3b82f6',
    borderWidth: '2px',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    zIndex: 2147483647,
  };

  constructor(private customStyles?: OverlayStyles) {}

  /**
   * Create overlay elements
   */
  private createOverlay(): void {
    if (this.overlay) return;

    const styles = { ...this.defaultStyles, ...this.customStyles };

    // Create main overlay
    this.overlay = document.createElement('div');
    this.overlay.id = 'revamp-highlight-overlay';
    this.overlay.setAttribute('data-revamp-ui', 'true');
    this.overlay.style.cssText = `
      position: absolute;
      pointer-events: none;
      border: ${styles.borderWidth} solid ${styles.borderColor};
      background-color: ${styles.backgroundColor};
      z-index: ${styles.zIndex};
      transition: all 0.1s ease;
      box-sizing: border-box;
    `;

    // Create label
    this.label = document.createElement('div');
    this.label.id = 'revamp-highlight-label';
    this.label.setAttribute('data-revamp-ui', 'true');
    this.label.style.cssText = `
      position: absolute;
      top: -24px;
      left: 0;
      padding: 4px 8px;
      background-color: ${styles.borderColor};
      color: white;
      font-size: 12px;
      font-family: monospace;
      border-radius: 3px;
      white-space: nowrap;
      pointer-events: none;
      z-index: ${styles.zIndex + 1};
    `;

    document.body.appendChild(this.overlay);
    document.body.appendChild(this.label);
  }

  /**
   * Highlight an element
   */
  highlight(element: Element, labelText?: string): void {
    if (!this.overlay || !this.label) {
      this.createOverlay();
    }

    const rect = element.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    if (this.overlay) {
      this.overlay.style.top = `${rect.top + scrollY}px`;
      this.overlay.style.left = `${rect.left + scrollX}px`;
      this.overlay.style.width = `${rect.width}px`;
      this.overlay.style.height = `${rect.height}px`;
      this.overlay.style.display = 'block';
    }

    if (this.label) {
      const label = labelText || this.generateLabel(element);
      this.label.textContent = label;
      this.label.style.top = `${rect.top + scrollY - 24}px`;
      this.label.style.left = `${rect.left + scrollX}px`;
      this.label.style.display = 'block';

      // Adjust label position if it's off-screen
      if (rect.top + scrollY < 30) {
        this.label.style.top = `${rect.bottom + scrollY}px`;
      }
    }
  }

  /**
   * Generate a descriptive label for an element
   */
  private generateLabel(element: Element): string {
    const tagName = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const classes = element.className
      ? `.${element.className.toString().trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';

    return `${tagName}${id}${classes}`;
  }

  /**
   * Hide the overlay
   */
  hide(): void {
    if (this.overlay) {
      this.overlay.style.display = 'none';
    }
    if (this.label) {
      this.label.style.display = 'none';
    }
  }

  /**
   * Remove overlay from DOM
   */
  destroy(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    if (this.label) {
      this.label.remove();
      this.label = null;
    }
  }

  /**
   * Check if overlay exists
   */
  exists(): boolean {
    return this.overlay !== null && document.body.contains(this.overlay);
  }
}

export interface PreviewTarget {
  id: string;
  selector: string;
  label: string;
}

export interface PreviewResult {
  matches: Record<string, number>;
  errors: Record<string, string>;
}

/**
 * Draws dashed boxes over every element a proposed change would touch.
 * Lives in its own container so the page's own styles and titles are never modified.
 */
export class PreviewOverlay {
  private container: HTMLDivElement | null = null;

  show(
    targets: PreviewTarget[],
    query: (selector: string) => { elements: Element[]; error?: string }
  ): PreviewResult {
    this.clear();

    const result: PreviewResult = { matches: {}, errors: {} };
    const container = document.createElement('div');
    container.id = 'revamp-preview-overlay';
    container.setAttribute('data-revamp-ui', 'true');
    container.style.cssText =
      'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483646;';

    let first: Element | null = null;

    for (const target of targets) {
      const { elements, error } = query(target.selector);
      if (error) result.errors[target.id] = error;
      result.matches[target.id] = elements.length;

      for (const el of elements) {
        if (!first) first = el;
        const rect = el.getBoundingClientRect();
        const box = document.createElement('div');
        box.style.cssText = `
          position:absolute;
          top:${rect.top + window.scrollY}px;
          left:${rect.left + window.scrollX}px;
          width:${rect.width}px;
          height:${rect.height}px;
          outline:2px dashed #3b82f6;
          outline-offset:2px;
          background:rgba(59,130,246,0.08);
          box-sizing:border-box;
        `;
        const tag = document.createElement('div');
        tag.textContent = target.label;
        tag.style.cssText = `
          position:absolute;top:0;left:0;transform:translateY(-100%);
          padding:2px 6px;background:#3b82f6;color:#fff;
          font:11px/1.4 monospace;white-space:nowrap;border-radius:3px;
        `;
        box.appendChild(tag);
        container.appendChild(box);
      }
    }

    document.documentElement.appendChild(container);
    this.container = container;

    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }

    return result;
  }

  clear(): void {
    this.container?.remove();
    this.container = null;
  }
}
