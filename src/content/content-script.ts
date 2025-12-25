/**
 * Content Script - Inspector & DOM Manipulation
 * Handles element inspection, selection, and modification
 */

import { SelectorGenerator, SelectorInfo } from '../utils/selector-generator';
import { HighlightOverlay } from '../utils/highlight-overlay';

interface InspectedElement {
  selector: SelectorInfo;
  tagName: string;
  attributes: Record<string, string>;
  textContent: string;
  innerHTML: string;
  rect: DOMRect;
}

interface EditOperation {
  selector: SelectorInfo;
  type: 'text' | 'html' | 'attribute' | 'style';
  value: any;
  originalValue?: any;
}

class RevampInspector {
  private isActive = false;
  private overlay: HighlightOverlay;
  private selectedElement: Element | null = null;
  private editHistory: EditOperation[] = [];
  private maxHistorySize = 50;

  constructor() {
    this.overlay = new HighlightOverlay();
    this.setupMessageListener();
    console.log('[Revamp] Content script loaded');
  }

  /**
   * Setup message listener for popup commands
   */
  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('[Content] Received message:', message.type);

      switch (message.type) {
        case 'START_INSPECTOR':
          this.startInspector();
          sendResponse({ success: true });
          break;

        case 'STOP_INSPECTOR':
          this.stopInspector();
          sendResponse({ success: true });
          break;

        case 'GET_SELECTED_ELEMENT':
          const info = this.getSelectedElementInfo();
          sendResponse({ success: true, data: info });
          break;

        case 'EDIT_TEXT':
          this.editText(message.payload.selector, message.payload.value);
          sendResponse({ success: true });
          break;

        case 'EDIT_ATTRIBUTE':
          this.editAttribute(
            message.payload.selector,
            message.payload.attribute,
            message.payload.value
          );
          sendResponse({ success: true });
          break;

        case 'UNDO_EDIT':
          this.undoLastEdit();
          sendResponse({ success: true });
          break;

        case 'GET_PAGE_HTML':
          const html = this.getPageHTML();
          sendResponse({ success: true, data: html });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown command' });
      }

      return false;
    });
  }

  /**
   * Start inspector mode
   */
  startInspector(): void {
    if (this.isActive) return;

    this.isActive = true;
    document.addEventListener('mouseover', this.handleMouseOver);
    document.addEventListener('mouseout', this.handleMouseOut);
    document.addEventListener('click', this.handleClick, true);
    document.body.style.cursor = 'crosshair';

    console.log('[Revamp] Inspector started');
  }

  /**
   * Stop inspector mode
   */
  stopInspector(): void {
    if (!this.isActive) return;

    this.isActive = false;
    document.removeEventListener('mouseover', this.handleMouseOver);
    document.removeEventListener('mouseout', this.handleMouseOut);
    document.removeEventListener('click', this.handleClick, true);
    document.body.style.cursor = '';
    this.overlay.hide();

    console.log('[Revamp] Inspector stopped');
  }

  /**
   * Handle mouse over event
   */
  private handleMouseOver = (event: MouseEvent): void => {
    if (!this.isActive) return;

    const element = event.target as Element;
    if (element && element !== document.body && element !== document.documentElement) {
      this.overlay.highlight(element);
    }
  };

  /**
   * Handle mouse out event
   */
  private handleMouseOut = (): void => {
    // Keep overlay visible
  };

  /**
   * Handle click event
   */
  private handleClick = (event: MouseEvent): void => {
    if (!this.isActive) return;

    event.preventDefault();
    event.stopPropagation();

    const element = event.target as Element;
    if (element && element !== document.body && element !== document.documentElement) {
      this.selectedElement = element;
      console.log('[Revamp] Element selected:', element);

      // Notify popup of selection
      chrome.runtime.sendMessage({
        type: 'ELEMENT_SELECTED',
        payload: this.getSelectedElementInfo(),
      });

      // Stop inspector after selection
      this.stopInspector();
    }
  };

  /**
   * Get information about the selected element
   */
  private getSelectedElementInfo(): InspectedElement | null {
    if (!this.selectedElement) return null;

    const selector = SelectorGenerator.generate(this.selectedElement);
    const attributes: Record<string, string> = {};

    for (const attr of this.selectedElement.getAttributeNames()) {
      attributes[attr] = this.selectedElement.getAttribute(attr) || '';
    }

    return {
      selector,
      tagName: this.selectedElement.tagName.toLowerCase(),
      attributes,
      textContent: this.selectedElement.textContent || '',
      innerHTML: this.selectedElement.innerHTML,
      rect: this.selectedElement.getBoundingClientRect() as DOMRect,
    };
  }

  /**
   * Edit text content of an element
   */
  editText(selectorInfo: SelectorInfo, newValue: string): void {
    const element = SelectorGenerator.resolve(selectorInfo.selector, selectorInfo.type);
    if (!element) {
      console.error('[Revamp] Element not found:', selectorInfo.selector);
      return;
    }

    // Save to history
    this.addToHistory({
      selector: selectorInfo,
      type: 'text',
      value: newValue,
      originalValue: element.textContent,
    });

    element.textContent = newValue;
    console.log('[Revamp] Text edited:', selectorInfo.selector);
  }

  /**
   * Edit attribute of an element
   */
  editAttribute(selectorInfo: SelectorInfo, attribute: string, value: string): void {
    const element = SelectorGenerator.resolve(selectorInfo.selector, selectorInfo.type);
    if (!element) {
      console.error('[Revamp] Element not found:', selectorInfo.selector);
      return;
    }

    // Save to history
    this.addToHistory({
      selector: selectorInfo,
      type: 'attribute',
      value: { attribute, value },
      originalValue: element.getAttribute(attribute),
    });

    element.setAttribute(attribute, value);
    console.log('[Revamp] Attribute edited:', attribute, '=', value);
  }

  /**
   * Add operation to edit history
   */
  private addToHistory(operation: EditOperation): void {
    this.editHistory.push(operation);
    if (this.editHistory.length > this.maxHistorySize) {
      this.editHistory.shift();
    }
  }

  /**
   * Undo the last edit
   */
  undoLastEdit(): void {
    const operation = this.editHistory.pop();
    if (!operation) {
      console.log('[Revamp] No edits to undo');
      return;
    }

    const element = SelectorGenerator.resolve(
      operation.selector.selector,
      operation.selector.type
    );
    if (!element) {
      console.error('[Revamp] Element not found for undo');
      return;
    }

    switch (operation.type) {
      case 'text':
        element.textContent = operation.originalValue || '';
        break;
      case 'attribute':
        const { attribute } = operation.value;
        if (operation.originalValue) {
          element.setAttribute(attribute, operation.originalValue);
        } else {
          element.removeAttribute(attribute);
        }
        break;
    }

    console.log('[Revamp] Undo performed');
  }

  /**
   * Get full page HTML
   */
  getPageHTML(): string {
    return document.documentElement.outerHTML;
  }
}

// Initialize inspector
const inspector = new RevampInspector();

export {};
