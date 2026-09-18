/**
 * Content Script - Inspector & DOM Manipulation
 * Handles element inspection, selection, and modification
 */

import { SelectorGenerator, SelectorInfo } from '../utils/selector-generator';
import { HighlightOverlay } from '../utils/highlight-overlay';
import { AIResponseParser } from '../utils/ai-response-parser';
import { changeManager } from '../utils/change-manager';
import { AIRevampResponse, AIChange } from '../types/ai-response';
import { SubtreeSnapshot, ChildSummary, ElementAttribute } from '../types/dom-snapshot';
import {
  InspectedElement,
  EditOperation,
  ApplyChangePayload,
  MessageResponse,
} from '../types/inspector';

interface ApplyRevampPayload {
  rawResponse?: string;
  parsedResponse?: AIRevampResponse;
  changes?: AIChange[];
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

        case 'APPLY_AI_REVAMP':
          this.applyRevampChanges(message.payload).then(sendResponse);
          return true; // Keep channel open for async

        case 'PREVIEW_CHANGES':
          this.previewChanges(message.payload).then(sendResponse);
          return true;

        case 'CLEAR_PREVIEW':
          this.clearPreview();
          sendResponse({ success: true });
          break;

        case 'UNDO_CHANGE':
          const undoSuccess = changeManager.undo();
          sendResponse({ success: undoSuccess, undoCount: changeManager.getUndoStackSize() });
          break;

        case 'UNDO_ALL':
          const undoneCount = changeManager.undoAll();
          sendResponse({ success: true, undoneCount });
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

        case 'GET_SUBTREE_SNAPSHOT':
          this.getSubtreeSnapshot(message.selector).then(sendResponse);
          return true; // Keep channel open for async

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

    // Notify popup of state change
    chrome.runtime.sendMessage({
      type: 'INSPECTOR_STATE_CHANGED',
      isActive: true,
    }).catch(() => {
      // Popup might be closed, that's okay
    });

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

    // Notify popup of state change
    chrome.runtime.sendMessage({
      type: 'INSPECTOR_STATE_CHANGED',
      isActive: false,
    }).catch(() => {
      // Popup might be closed, that's okay
    });

    console.log('[Revamp] Inspector stopped');
  }

  /**
   * Create and inject floating panel
   */
  private createFloatingPanel(): void {
    if (this.panelElement) return;

    // Load saved position/size from localStorage
    const savedPos = this.loadPanelPosition();
    const savedSize = this.loadPanelSize();

    // Create container
    const container = document.createElement('div');
    container.id = 'revamp-floating-panel';
    container.style.cssText = `
      position: fixed;
      ${savedPos.x !== null ? `left: ${savedPos.x}px;` : 'right: 20px;'}
      ${savedPos.y !== null ? `top: ${savedPos.y}px;` : 'top: 80px;'}
      width: ${savedSize.width ?? 420}px;
      height: ${savedSize.height ?? 600}px;
      z-index: 2147483647;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      border-radius: 8px;
      overflow: hidden;
      background: white;
      border: 1px solid #e5e7eb;
    `;

    // Create drag handle
    const dragHandle = document.createElement('div');
    dragHandle.classList.add('revamp-drag-handle');
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
      user-select: none;
    `;
    dragHandle.innerHTML = '⋮⋮ Revamp Panel - Drag to move';

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.id = 'revamp-close-btn';
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
      z-index: 10;
    `;
    
    closeBtn.addEventListener('mouseover', () => {
      closeBtn.style.background = '#fee2e2';
      closeBtn.style.color = '#dc2626';
    });
    closeBtn.addEventListener('mouseout', () => {
      closeBtn.style.background = 'transparent';
      closeBtn.style.color = '#6b7280';
    });
    
    // Direct onclick for immediate close
    closeBtn.onclick = () => {
      this.removeFloatingPanel();
      this.panelOpen = false;
    };

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

    // Create resize handle (bottom-right corner)
    const resizeHandle = document.createElement('div');
    resizeHandle.classList.add('revamp-resize-handle');
    resizeHandle.style.cssText = `
      position: absolute;
      right: 0;
      bottom: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 50%, #9ca3af 50%);
      border-bottom-right-radius: 8px;
      z-index: 10;
    `;
    container.appendChild(resizeHandle);

    // Make draggable with professional logic
    this.makeDraggable(container, dragHandle);

    // Make resizable from the corner handle
    this.makeResizable(container, resizeHandle);

    // Note: previously this container also had capture-phase 'mousedown'/'click'
    // stopPropagation listeners meant to isolate panel clicks from the page's
    // inspector. Because they ran in the capture phase on an ancestor, they
    // stopped propagation before it ever reached descendants (drag handle,
    // close button), which silently broke drag and the close button. They were
    // also too late to shield document's own capture-phase listeners (which run
    // before an ancestor's capture handler further down the tree), so they never
    // achieved their intended purpose anyway.
  }

  /**
   * Make panel draggable - Professional implementation
   * Based on industry best practices (DevTools, Elementor pattern)
   */
  private makeDraggable(panel: HTMLElement, header: HTMLElement): void {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    // Mouse down on header - start drag
    const onMouseDown = (e: MouseEvent) => {
      // Ignore if clicking on close button
      const target = e.target as HTMLElement;
      if (target.id === 'revamp-close-btn' || target.tagName === 'BUTTON') {
        return;
      }

      isDragging = true;
      
      // Calculate offset from mouse to panel's top-left
      offsetX = e.clientX - panel.getBoundingClientRect().left;
      offsetY = e.clientY - panel.getBoundingClientRect().top;

      // Disable text selection during drag
      document.body.style.userSelect = 'none';
      
      e.preventDefault();
      e.stopPropagation();
    };

    // Mouse move - perform drag
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      // Calculate and apply new position
      panel.style.left = `${e.clientX - offsetX}px`;
      panel.style.top = `${e.clientY - offsetY}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };

    // Mouse up - end drag
    const onMouseUp = () => {
      if (!isDragging) return;
      
      isDragging = false;
      
      // Re-enable text selection
      document.body.style.userSelect = '';

      // Save position to localStorage
      this.savePanelPosition(panel.offsetLeft, panel.offsetTop);
    };

    // Attach event listeners
    header.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Store cleanup function for later removal
    (panel as any).__dragCleanup = () => {
      header.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }

  /**
   * Make panel resizable from a corner handle
   */
  private makeResizable(panel: HTMLElement, handle: HTMLElement): void {
    const MIN_WIDTH = 320;
    const MIN_HEIGHT = 300;

    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;

    // Mouse down on handle - start resize
    const onMouseDown = (e: MouseEvent) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = panel.offsetWidth;
      startHeight = panel.offsetHeight;

      // Disable text selection during resize
      document.body.style.userSelect = 'none';

      e.preventDefault();
      e.stopPropagation();
    };

    // Mouse move - perform resize
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const newWidth = Math.max(MIN_WIDTH, startWidth + (e.clientX - startX));
      const newHeight = Math.max(MIN_HEIGHT, startHeight + (e.clientY - startY));

      panel.style.width = `${newWidth}px`;
      panel.style.height = `${newHeight}px`;
    };

    // Mouse up - end resize
    const onMouseUp = () => {
      if (!isResizing) return;

      isResizing = false;

      // Re-enable text selection
      document.body.style.userSelect = '';

      // Save size to localStorage
      this.savePanelSize(panel.offsetWidth, panel.offsetHeight);
    };

    // Attach event listeners
    handle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Store cleanup function for later removal
    (panel as any).__resizeCleanup = () => {
      handle.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }

  /**
   * Save panel size to localStorage
   */
  private savePanelSize(width: number, height: number): void {
    try {
      localStorage.setItem('revamp-panel-size', JSON.stringify({ width, height }));
    } catch (error) {
      console.warn('[Revamp] Failed to save panel size:', error);
    }
  }

  /**
   * Load panel size from localStorage
   */
  private loadPanelSize(): { width: number | null; height: number | null } {
    try {
      const saved = localStorage.getItem('revamp-panel-size');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.warn('[Revamp] Failed to load panel size:', error);
    }
    return { width: null, height: null };
  }

  /**
   * Save panel position to localStorage
   */
  private savePanelPosition(x: number, y: number): void {
    try {
      localStorage.setItem('revamp-panel-position', JSON.stringify({ x, y }));
    } catch (error) {
      console.warn('[Revamp] Failed to save panel position:', error);
    }
  }

  /**
   * Load panel position from localStorage
   */
  private loadPanelPosition(): { x: number | null; y: number | null } {
    try {
      const saved = localStorage.getItem('revamp-panel-position');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.warn('[Revamp] Failed to load panel position:', error);
    }
    return { x: null, y: null };
  }

  /**
   * Remove floating panel
   */
  private removeFloatingPanel(): void {
    const container = document.getElementById('revamp-floating-panel');
    if (container) {
      // Cleanup drag/resize event listeners
      if ((container as any).__dragCleanup) {
        (container as any).__dragCleanup();
      }
      if ((container as any).__resizeCleanup) {
        (container as any).__resizeCleanup();
      }
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
      console.log('[Revamp] Applying AI change:', payload);

      // For script action, we don't need to resolve element first
      if (payload.action === 'script') {
        try {
          // Execute script in page context safely
          const script = document.createElement('script');
          script.textContent = `(function() { ${payload.value} })();`;
          document.head.appendChild(script);
          script.remove();
          
          this.addToHistory({
            selector: { selector: 'document', type: 'xpath', confidence: 'high' },
            type: 'style', // Use generic type for history
            value: { script: payload.value },
            originalValue: null,
          });
          
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: `Script execution failed: ${error}`,
          };
        }
      }

      // Resolve element(s) for other actions
      const selectorStr = payload.selector.selector;
      const selectorType = payload.selector.type;
      
      console.log('[Revamp] Selector:', selectorStr, 'Type:', selectorType);
      
      // Check if selector targets multiple elements (page-level)
      let elements: Element[];
      
      // Always try querySelectorAll for css-path type or comma-separated selectors
      if (selectorType === 'css-path' || selectorStr.includes(',')) {
        try {
          const nodeList = document.querySelectorAll(selectorStr);
          elements = Array.from(nodeList);
          console.log('[Revamp] Found', elements.length, 'elements with querySelectorAll');
        } catch (e) {
          console.error('[Revamp] querySelectorAll failed:', e);
          elements = [];
        }
      } else {
        // Single element resolution
        const singleElement = SelectorGenerator.resolve(selectorStr, selectorType);
        elements = singleElement ? [singleElement] : [];
        console.log('[Revamp] Found', elements.length, 'element with SelectorGenerator');
      }

      if (elements.length === 0) {
        console.error('[Revamp] No elements found for selector:', selectorStr);
        return {
          success: false,
          error: `No elements found matching selector: ${selectorStr}`,
        };
      }

      console.log('[Revamp] Applying', payload.action, 'to', elements.length, 'element(s)');

      // Apply changes to all matched elements
      let appliedCount = 0;
      
      for (const element of elements) {
        try {
          switch (payload.action) {
            case 'text':
              // Save original for undo (only for first element to avoid history bloat)
              if (appliedCount === 0) {
                this.addToHistory({
                  selector: payload.selector,
                  type: 'text',
                  value: payload.value,
                  originalValue: element.textContent,
                });
              }
              element.textContent = payload.value;
              appliedCount++;
              break;

            case 'html':
              if (appliedCount === 0) {
                this.addToHistory({
                  selector: payload.selector,
                  type: 'html',
                  value: payload.value,
                  originalValue: element.innerHTML,
                });
              }
              element.innerHTML = payload.value;
              appliedCount++;
              break;

            case 'css':
              if (element instanceof HTMLElement) {
                // Get current styles for undo (only for first element)
                if (appliedCount === 0) {
                  const originalStyles: Record<string, string> = {};
                  Object.keys(payload.value).forEach((property) => {
                    originalStyles[property] = element.style.getPropertyValue(property);
                  });
                  
                  this.addToHistory({
                    selector: payload.selector,
                    type: 'style',
                    value: payload.value,
                    originalValue: originalStyles,
                  });
                }

                // Apply styles
                Object.entries(payload.value as Record<string, string>).forEach(
                  ([property, value]) => {
                    element.style.setProperty(property, value);
                  }
                );
                appliedCount++;
              }
              break;

            case 'attribute':
              if (payload.attribute) {
                if (appliedCount === 0) {
                  this.addToHistory({
                    selector: payload.selector,
                    type: 'attribute',
                    value: { attribute: payload.attribute, value: payload.value },
                    originalValue: element.getAttribute(payload.attribute),
                  });
                }
                element.setAttribute(payload.attribute, payload.value);
                appliedCount++;
              }
              break;

            default:
              return {
                success: false,
                error: `Unknown action: ${payload.action}`,
              };
          }
        } catch (elementError) {
          console.warn('[Revamp] Failed to apply change to element:', elementError);
        }
      }

      if (appliedCount === 0) {
        return {
          success: false,
          error: 'Failed to apply changes to any elements',
        };
      }

      console.log(`[Revamp] Applied ${payload.action} to ${appliedCount} element(s)`);
      return { 
        success: true,
        data: { appliedCount },
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Apply AI Revamp Changes (new structured format)
   */
  async applyRevampChanges(payload: ApplyRevampPayload): Promise<MessageResponse> {
    try {
      let response: AIRevampResponse | null = null;

      // Parse response if raw text provided
      if (payload.rawResponse) {
        response = AIResponseParser.parse(payload.rawResponse);
      } else if (payload.parsedResponse) {
        response = payload.parsedResponse;
      }

      if (!response || !response.changes || response.changes.length === 0) {
        return {
          success: false,
          error: 'No valid changes found in AI response'
        };
      }

      console.log('[Revamp] Applying', response.changes.length, 'changes');

      // Apply all changes using ChangeManager
      const results = await changeManager.applyChanges(response.changes);

      // Calculate summary
      const successCount = results.filter(r => r.success).length;
      const totalElements = results.reduce((sum, r) => sum + r.elementsAffected, 0);
      const failures = results.filter(r => !r.success);

      return {
        success: successCount > 0,
        data: {
          summary: `Applied ${successCount}/${response.changes.length} changes to ${totalElements} element(s)`,
          results,
          failures: failures.length > 0 ? failures : undefined,
          undoCount: changeManager.getUndoStackSize()
        }
      };

    } catch (error) {
      console.error('[Revamp] Error applying revamp changes:', error);
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * Preview changes without applying
   */
  async previewChanges(payload: ApplyRevampPayload): Promise<MessageResponse> {
    try {
      let response: AIRevampResponse | null = null;

      if (payload.rawResponse) {
        response = AIResponseParser.parse(payload.rawResponse);
      } else if (payload.parsedResponse) {
        response = payload.parsedResponse;
      }

      if (!response || !response.changes) {
        return { success: false, error: 'No valid changes to preview' };
      }

      // Highlight elements that will be changed
      response.changes.forEach(change => {
        const elements = document.querySelectorAll(change.selector);
        elements.forEach(el => {
          const htmlEl = el as HTMLElement;
          htmlEl.style.outline = '2px dashed #3b82f6';
          htmlEl.style.outlineOffset = '2px';
          htmlEl.setAttribute('data-revamp-preview', change.id);
          htmlEl.title = `[${change.action}] ${change.explanation}`;
        });
      });

      return {
        success: true,
        data: {
          message: `Previewing ${response.changes.length} changes`,
          changes: response.changes
        }
      };

    } catch (error) {
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * Clear preview highlights
   */
  clearPreview(): void {
    document.querySelectorAll('[data-revamp-preview]').forEach(el => {
      const htmlEl = el as HTMLElement;
      htmlEl.style.outline = '';
      htmlEl.style.outlineOffset = '';
      htmlEl.removeAttribute('data-revamp-preview');
      htmlEl.title = '';
    });
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

  /**
   * Build stable selector for element using data attributes, ID, classes, or nth-of-type
   */
  private buildStableSelector(el: Element): string {
    if (!el || !(el instanceof Element)) return '';

    // Prefer data-* attributes for stability
    const dataAttrs = ['data-testid', 'data-test', 'data-id', 'data-qa', 'data-cy', 'data-component'];
    for (const attr of dataAttrs) {
      const value = el.getAttribute(attr);
      if (value) {
        return `[${attr}="${CSS.escape(value)}"]`;
      }
    }

    // Try ID
    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }

    // Try classes (limit to 3)
    const classes = Array.from(el.classList).slice(0, 3);
    if (classes.length > 0) {
      const classSelector = classes.map(c => `.${CSS.escape(c)}`).join('');
      return `${el.tagName.toLowerCase()}${classSelector}`;
    }

    // Fallback to tag + nth-of-type
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      const index = siblings.indexOf(el) + 1;
      const parentSelector = this.buildStableSelector(parent);
      const nthSelector = `${el.tagName.toLowerCase()}:nth-of-type(${index})`;
      return parentSelector ? `${parentSelector} > ${nthSelector}` : nthSelector;
    }

    return el.tagName.toLowerCase();
  }

  /**
   * Trim text to max length
   */
  private trimText(text: string, maxLength = 2000): string {
    if (!text) return '';
    const trimmed = text.replace(/\s+/g, ' ').trim();
    return trimmed.length > maxLength ? trimmed.substring(0, maxLength) + '…' : trimmed;
  }

  /**
   * Trim HTML to max length
   */
  private trimHTML(html: string, maxLength = 20000): string {
    if (!html) return '';
    return html.length > maxLength ? html.substring(0, maxLength) + '\n<!-- truncated -->' : html;
  }

  /**
   * Check if element is visible
   */
  private isElementVisible(el: Element): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           el.offsetWidth > 0 &&
           el.offsetHeight > 0;
  }

  /**
   * Summarize a child element
   */
  private summarizeChild(el: Element): ChildSummary {
    const tag = el.tagName.toLowerCase();
    const selector = this.buildStableSelector(el);
    const id = (el as HTMLElement).id || undefined;
    const classes = Array.from(el.classList);
    
    const attributes: ElementAttribute[] = Array.from(el.attributes).map(attr => ({
      name: attr.name,
      value: attr.value
    }));

    const textContent = this.trimText((el as HTMLElement).textContent || '', 300);
    
    // Extract src/href for media and links
    let src: string | undefined;
    let href: string | undefined;
    
    if (tag === 'img' || tag === 'video' || tag === 'source' || tag === 'audio') {
      src = (el as HTMLImageElement).src || 
            (el as HTMLVideoElement).src || 
            (el as HTMLSourceElement).src ||
            el.getAttribute('src') || undefined;
    }
    
    if (tag === 'a') {
      href = (el as HTMLAnchorElement).href || el.getAttribute('href') || undefined;
    }

    return {
      tag,
      selector,
      id,
      classes,
      attributes,
      textContent,
      src,
      href,
      isVisible: this.isElementVisible(el)
    };
  }

  /**
   * Capture subtree snapshot of selected element or body
   */
  async getSubtreeSnapshot(selector?: string): Promise<{ success: boolean; snapshot?: SubtreeSnapshot; error?: string }> {
    try {
      // Determine target element
      const targetElement = selector 
        ? document.querySelector(selector) 
        : (this.selectedElement || document.body);

      if (!targetElement) {
        return { 
          success: false, 
          error: selector ? `Element not found: ${selector}` : 'No element selected and body not found' 
        };
      }

      const rootSelector = selector || (this.selectedElement ? this.buildStableSelector(this.selectedElement) : 'body');
      const mode = targetElement === document.body ? 'page' : 'element';

      // Collect attributes
      const attributes: ElementAttribute[] = Array.from(targetElement.attributes).map(attr => ({
        name: attr.name,
        value: attr.value
      }));

      // Get HTML content (trimmed)
      const outerHTML = this.trimHTML((targetElement as HTMLElement).outerHTML || '');
      const innerHTML = this.trimHTML((targetElement as HTMLElement).innerHTML || '');
      const textContent = this.trimText((targetElement as HTMLElement).textContent || '');

      // Summarize direct children
      const children: ChildSummary[] = Array.from(targetElement.children).map(child => 
        this.summarizeChild(child)
      );

      // IMPORTANT: Also collect ALL images recursively (not just direct children)
      // This ensures images nested deep in structure are captured
      const allImages = Array.from(targetElement.querySelectorAll('img')).map(img => 
        this.summarizeChild(img)
      );

      const snapshot: SubtreeSnapshot = {
        mode,
        rootSelector,
        rootTag: targetElement.tagName.toLowerCase(),
        attributes,
        outerHTML,
        innerHTML,
        textContent,
        children,
        totalChildCount: targetElement.children.length,
        timestamp: Date.now(),
        // Add all images as separate property
        allImages
      };

      console.log('[Content] Subtree snapshot captured:', {
        mode,
        rootSelector,
        childCount: children.length
      });

      return { success: true, snapshot };

    } catch (error) {
      console.error('[Content] Error capturing subtree snapshot:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error capturing snapshot' 
      };
    }
  }
}

// Initialize inspector (instantiation has side effects - sets up message listeners)
new RevampInspector();

export {};
