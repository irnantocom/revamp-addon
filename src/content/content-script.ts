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

interface ApplyChangePayload {
  action: 'text' | 'css' | 'html' | 'attribute';
  selector: SelectorInfo;
  value: any;
  attribute?: string;
}

class RevampInspector {
  private isActive = false;
  private overlay: HighlightOverlay;
  private selectedElement: Element | null = null;
  private editHistory: EditOperation[] = [];
  private maxHistorySize = 50;
  private panelOpen = false;
  private panelElement: HTMLIFrameElement | null = null;

  constructor() {
    this.overlay = new HighlightOverlay();
    this.setupMessageListener();
    this.injectStyles();
    console.log('[Revamp] Content script initialized');
  }

  /**
   * Inject styles for inspector mode
   */
  private injectStyles(): void {
    const style = document.createElement('style');
    style.id = 'revamp-inspector-styles';
    style.textContent = `
      body.revamp-inspector-active {
        cursor: crosshair !important;
      }
      body.revamp-inspector-active * {
        cursor: crosshair !important;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Setup message listener for popup commands
   */
  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      console.log('[Content] Received message:', message.type);

      switch (message.type) {
        case 'PING':
          // Health check to verify content script is loaded
          sendResponse({ success: true, ready: true });
          break;

        case 'TOGGLE_PANEL':
          this.togglePanel();
          sendResponse({ success: true, open: this.panelOpen });
          break;

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

        case 'APPLY_CSS':
          this.applyCSS(message.payload.selector, message.payload.styles);
          sendResponse({ success: true });
          break;

        case 'APPLY_AI_CHANGE':
          const result = this.applyAIChange(message.payload);
          sendResponse(result);
          break;

        case 'GET_ELEMENT_INFO':
          const elementInfo = this.getElementInfo(message.payload.selector);
          sendResponse({ success: true, data: elementInfo });
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
    this.injectStyles();
    
    document.body.classList.add('revamp-inspector-active');
    document.addEventListener('mouseover', this.handleMouseOver, true);
    document.addEventListener('mouseout', this.handleMouseOut, true);
    document.addEventListener('click', this.handleClick, true);

    console.log('[Revamp] Inspector started');
  }

  /**
   * Stop inspector mode
   */
  stopInspector(): void {
    if (!this.isActive) return;

    this.isActive = false;
    document.body.classList.remove('revamp-inspector-active');
    document.removeEventListener('mouseover', this.handleMouseOver, true);
    document.removeEventListener('mouseout', this.handleMouseOut, true);
    document.removeEventListener('click', this.handleClick, true);
    this.overlay.hide();

    console.log('[Revamp] Inspector stopped');
  }

  /**
   * Create and inject floating panel
   */
  private createFloatingPanel(): void {
    if (this.panelElement) return;

    // Create container
    const container = document.createElement('div');
    container.id = 'revamp-floating-panel';
    container.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      width: 420px;
      height: 600px;
      z-index: 2147483647;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      border-radius: 8px;
      overflow: hidden;
      background: white;
      border: 1px solid #e5e7eb;
    `;

    // Create drag handle
    const dragHandle = document.createElement('div');
    dragHandle.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 30px;
      background: linear-gradient(to bottom, #f9fafb, #f3f4f6);
      cursor: move;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      padding: 0 12px;
      font-size: 12px;
      color: #6b7280;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    dragHandle.innerHTML = '⋮⋮ Revamp Panel - Drag to move';

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
      position: absolute;
      top: 5px;
      right: 8px;
      width: 20px;
      height: 20px;
      border: none;
      background: transparent;
      color: #6b7280;
      font-size: 16px;
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
    `;
    closeBtn.onmouseover = () => {
      closeBtn.style.background = '#fee2e2';
      closeBtn.style.color = '#dc2626';
    };
    closeBtn.onmouseout = () => {
      closeBtn.style.background = 'transparent';
      closeBtn.style.color = '#6b7280';
    };
    closeBtn.onclick = () => this.togglePanel();

    dragHandle.appendChild(closeBtn);

    // Create iframe for popup
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('popup/index.html');
    iframe.style.cssText = `
      width: 100%;
      height: calc(100% - 30px);
      border: none;
      margin-top: 30px;
    `;

    container.appendChild(dragHandle);
    container.appendChild(iframe);
    document.body.appendChild(container);

    this.panelElement = iframe;

    // Make draggable
    this.makeDraggable(container, dragHandle);

    // Prevent clicks on panel from triggering inspector
    container.addEventListener('mousedown', (e) => e.stopPropagation(), true);
    container.addEventListener('click', (e) => e.stopPropagation(), true);
  }

  /**
   * Make panel draggable
   */
  private makeDraggable(element: HTMLElement, handle: HTMLElement): void {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    handle.onmousedown = dragMouseDown;

    function dragMouseDown(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e: MouseEvent) {
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      element.style.top = (element.offsetTop - pos2) + 'px';
      element.style.left = (element.offsetLeft - pos1) + 'px';
      element.style.right = 'auto';
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  /**
   * Remove floating panel
   */
  private removeFloatingPanel(): void {
    const container = document.getElementById('revamp-floating-panel');
    if (container) {
      container.remove();
      this.panelElement = null;
    }
  }

  /**
   * Toggle floating panel
   */
  togglePanel(): void {
    if (this.panelOpen) {
      this.removeFloatingPanel();
      this.panelOpen = false;
    } else {
      this.createFloatingPanel();
      this.panelOpen = true;
    }
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
      console.log('[Revamp] ✓ Element selected:', element.tagName, element.className || '(no class)');

      // Notify popup of selection
      chrome.runtime.sendMessage({
        type: 'ELEMENT_SELECTED',
        payload: this.getSelectedElementInfo(),
      });

      // Auto-stop inspector after selection
      console.log('[Revamp] → Auto-stopping inspector...');
      this.stopInspector();
      console.log('[Revamp] ✓ Inspector stopped automatically');
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
   * Apply CSS styles to an element
   */
  applyCSS(selectorInfo: SelectorInfo, styles: Record<string, string>): void {
    const element = SelectorGenerator.resolve(selectorInfo.selector, selectorInfo.type);
    if (!element || !(element instanceof HTMLElement)) {
      console.error('[Revamp] Element not found:', selectorInfo.selector);
      return;
    }

    // Get current styles for undo
    const originalStyles: Record<string, string> = {};
    Object.keys(styles).forEach((property) => {
      originalStyles[property] = element.style.getPropertyValue(property);
    });

    // Save to history
    this.addToHistory({
      selector: selectorInfo,
      type: 'style',
      value: styles,
      originalValue: originalStyles,
    });

    // Apply new styles
    Object.entries(styles).forEach(([property, value]) => {
      element.style.setProperty(property, value);
    });

    console.log('[Revamp] CSS applied:', styles);
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
      case 'style':
        if (element instanceof HTMLElement) {
          Object.entries(operation.originalValue as Record<string, string>).forEach(
            ([property, value]) => {
              if (value) {
                element.style.setProperty(property, value);
              } else {
                element.style.removeProperty(property);
              }
            }
          );
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

  /**
   * Apply AI-generated change
   */
  applyAIChange(payload: ApplyChangePayload): MessageResponse {
    try {
      const element = SelectorGenerator.resolve(
        payload.selector.selector,
        payload.selector.type
      );

      if (!element) {
        return {
          success: false,
          error: 'Element not found',
        };
      }

      switch (payload.action) {
        case 'text':
          this.editText(payload.selector, payload.value);
          break;

        case 'html':
          if (element) {
            this.addToHistory({
              selector: payload.selector,
              type: 'html',
              value: payload.value,
              originalValue: element.innerHTML,
            });
            element.innerHTML = payload.value;
          }
          break;

        case 'css':
          this.applyCSS(payload.selector, payload.value);
          break;

        case 'attribute':
          if (payload.attribute) {
            this.editAttribute(payload.selector, payload.attribute, payload.value);
          }
          break;

        default:
          return {
            success: false,
            error: `Unknown action: ${payload.action}`,
          };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Get detailed information about an element
   */
  getElementInfo(selector: SelectorInfo): any {
    const element = SelectorGenerator.resolve(selector.selector, selector.type);
    
    if (!element) {
      return null;
    }

    const computedStyle = element instanceof HTMLElement 
      ? window.getComputedStyle(element) 
      : null;

    return {
      tagName: element.tagName.toLowerCase(),
      textContent: element.textContent?.trim().substring(0, 200),
      innerHTML: element.innerHTML.substring(0, 500),
      attributes: Array.from(element.attributes).reduce((acc, attr) => {
        acc[attr.name] = attr.value;
        return acc;
      }, {} as Record<string, string>),
      computedStyles: computedStyle ? {
        display: computedStyle.display,
        position: computedStyle.position,
        width: computedStyle.width,
        height: computedStyle.height,
        color: computedStyle.color,
        backgroundColor: computedStyle.backgroundColor,
        fontSize: computedStyle.fontSize,
        fontFamily: computedStyle.fontFamily,
        margin: computedStyle.margin,
        padding: computedStyle.padding,
      } : null,
      rect: element.getBoundingClientRect(),
    };
  }
}

interface MessageResponse {
  success: boolean;
  data?: any;
  error?: string;
}

// Initialize inspector (instantiation has side effects - sets up message listeners)
new RevampInspector();

export {};
