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
