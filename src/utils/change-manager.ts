import { AIChange, ChangeResult, UndoEntry } from '../types/ai-response';

/**
 * Manages DOM changes dengan undo capability
 */
export class ChangeManager {
  private undoStack: UndoEntry[] = [];
  private maxUndoSize = 50;

  /**
   * Apply single change ke DOM
   */
  async applyChange(change: AIChange): Promise<ChangeResult> {
    const elements = document.querySelectorAll(change.selector);
    
    if (elements.length === 0) {
      return {
        changeId: change.id,
        success: false,
        elementsAffected: 0,
        error: `No elements found for selector: ${change.selector}`
      };
    }

    const undoEntries: UndoEntry[] = [];

    try {
      elements.forEach((element) => {
        const el = element as HTMLElement;
        
        // Save state for undo
        const undoEntry: UndoEntry = {
          id: `undo-${Date.now()}-${Math.random()}`,
          timestamp: Date.now(),
          changeId: change.id,
          selector: change.selector,
          action: change.action,
          previousState: this.captureState(el, change.action)
        };
        undoEntries.push(undoEntry);

        // Apply change
        this.applyToElement(el, change);
      });

      // Add to undo stack
      undoEntries.forEach(entry => this.addToUndoStack(entry));

      return {
        changeId: change.id,
        success: true,
        elementsAffected: elements.length,
        undoData: undoEntries[0]
      };
    } catch (error) {
      console.error('[ChangeManager] Error applying change:', error);
      return {
        changeId: change.id,
        success: false,
        elementsAffected: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Apply multiple changes
   */
  async applyChanges(changes: AIChange[]): Promise<ChangeResult[]> {
    const results: ChangeResult[] = [];
    
    for (const change of changes) {
      const result = await this.applyChange(change);
      results.push(result);
      
      // Stop on critical error if needed
      if (!result.success && change.action === 'html') {
        console.warn(`[ChangeManager] Stopping due to HTML change failure`);
        break;
      }
    }

    return results;
  }

  /**
   * Undo last change
   */
  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;

    try {
      const elements = document.querySelectorAll(entry.selector);
      elements.forEach(element => {
        const el = element as HTMLElement;
        this.restoreState(el, entry);
      });
      return true;
    } catch (error) {
      console.error('[ChangeManager] Error during undo:', error);
      return false;
    }
  }

  /**
   * Undo all changes
   */
  undoAll(): number {
    let count = 0;
    while (this.undoStack.length > 0) {
      if (this.undo()) count++;
    }
    return count;
  }

  /**
   * Get undo stack size
   */
  getUndoStackSize(): number {
    return this.undoStack.length;
  }

  /**
   * Capture element state untuk undo
   */
  private captureState(el: HTMLElement, action: string): UndoEntry['previousState'] {
    const state: UndoEntry['previousState'] = {};

    switch (action) {
      case 'css':
        state.styles = {};
        // Capture inline styles
        for (let i = 0; i < el.style.length; i++) {
          const prop = el.style[i];
          state.styles[prop] = el.style.getPropertyValue(prop);
        }
        break;

      case 'html':
      case 'insert':
      case 'remove':
        state.html = el.outerHTML;
        break;

      case 'text':
        state.text = el.textContent || '';
        break;

      case 'attribute':
        state.attributes = {};
        Array.from(el.attributes).forEach(attr => {
          state.attributes![attr.name] = attr.value;
        });
        break;
    }

    return state;
  }

  /**
   * Apply change to single element
   */
  private applyToElement(el: HTMLElement, change: AIChange): void {
    switch (change.action) {
      case 'css':
        if (typeof change.value === 'object') {
          Object.entries(change.value).forEach(([prop, val]) => {
            el.style.setProperty(
              prop.replace(/([A-Z])/g, '-$1').toLowerCase(),
              val as string
            );
          });
        }
        break;

      case 'html':
        el.innerHTML = change.value;
        break;

      case 'text':
        el.textContent = change.value;
        break;

      case 'attribute':
        if (change.attribute) {
          el.setAttribute(change.attribute, change.value);
        }
        break;

      case 'remove':
        el.remove();
        break;

      case 'insert':
        const template = document.createElement('template');
        template.innerHTML = change.value.trim();
        const newElement = template.content.firstChild;
        
        if (newElement) {
          switch (change.position) {
            case 'before':
              el.parentNode?.insertBefore(newElement, el);
              break;
            case 'after':
              el.parentNode?.insertBefore(newElement, el.nextSibling);
              break;
            case 'prepend':
              el.insertBefore(newElement, el.firstChild);
              break;
            case 'append':
            default:
              el.appendChild(newElement);
              break;
          }
        }
        break;
    }
  }

  /**
   * Restore element state from undo entry
   */
  private restoreState(el: HTMLElement, entry: UndoEntry): void {
    switch (entry.action) {
      case 'css':
        if (entry.previousState.styles) {
          // Clear current inline styles
          el.removeAttribute('style');
          // Restore previous styles
          Object.entries(entry.previousState.styles).forEach(([prop, val]) => {
            el.style.setProperty(prop, val);
          });
        }
        break;

      case 'html':
      case 'remove':
        if (entry.previousState.html) {
          el.outerHTML = entry.previousState.html;
        }
        break;

      case 'text':
        if (entry.previousState.text !== undefined) {
          el.textContent = entry.previousState.text;
        }
        break;

      case 'attribute':
        if (entry.previousState.attributes) {
          // Remove all current attributes
          Array.from(el.attributes).forEach(attr => {
            el.removeAttribute(attr.name);
          });
          // Restore previous attributes
          Object.entries(entry.previousState.attributes).forEach(([name, value]) => {
            el.setAttribute(name, value);
          });
        }
        break;
    }
  }

  /**
   * Add entry to undo stack dengan size limit
   */
  private addToUndoStack(entry: UndoEntry): void {
    this.undoStack.push(entry);
    
    // Trim stack if exceeds max size
    while (this.undoStack.length > this.maxUndoSize) {
      this.undoStack.shift();
    }
  }
}

// Singleton instance
export const changeManager = new ChangeManager();
