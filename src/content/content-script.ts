/**
 * Content Script - Inspector & DOM Manipulation
 * Handles element inspection, selection, and modification
 */

import { SelectorGenerator, SelectorInfo } from '../utils/selector-generator';
import { HighlightOverlay, PreviewOverlay } from '../utils/highlight-overlay';
import { AIResponseParser } from '../utils/ai-response-parser';
import { changeManager } from '../utils/change-manager';
import { pageIndex } from '../utils/page-index';
import { DemoManager } from '../utils/demo-manager';
import { captureScreenshot, downloadBlob } from '../utils/screenshot';
import { AnnotationLayer } from '../utils/annotation-layer';
import { capturePageSnapshot } from '../export/snapshot';
import { ExportOptions } from '../export/types';
import { Annotation } from '../types/demo';
import { Operation } from '../types/operations';
import { AIRevampResponse, AIChange, ChangeResult } from '../types/ai-response';
import { legacyChangeToOperations } from '../utils/legacy-changes';
import { layoutRisk } from '../utils/operation-executor';
import { SubtreeSnapshot, ChildSummary, ElementAttribute } from '../types/dom-snapshot';
import {
  InspectedElement,
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
  private previewOverlay = new PreviewOverlay();
  private locateTimer: number | undefined;
  private demo = new DemoManager(changeManager, pageIndex);
  private pickOverlay = new HighlightOverlay({ borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.12)' });
  private annotations = new AnnotationLayer(
    () => this.demo.getAnnotations(),
    (annotation) => this.demo.resolveAnnotation(annotation),
    (annotation) => this.editAnnotation(annotation)
  );
  private selectedElement: Element | null = null;
  private panelOpen = false;
  private panelElement: HTMLIFrameElement | null = null;

  constructor() {
    this.overlay = new HighlightOverlay();
    this.setupMessageListener();
    this.injectStyles();
    this.demo.onAnnotationsChange(() => this.annotations.scheduleRender());
    // Pins sit at document coordinates, so re-place them when edits move or hide elements
    changeManager.onChange(() => this.annotations.scheduleRender());
    void this.demo.init();
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
          sendResponse(this.editText(message.payload.selector, message.payload.value));
          break;

        case 'EDIT_ATTRIBUTE':
          sendResponse(this.editAttribute(
            message.payload.selector,
            message.payload.attribute,
            message.payload.value
          ));
          break;

        case 'APPLY_CSS':
          sendResponse(this.applyCSS(message.payload.selector, message.payload.styles));
          break;

        case 'APPLY_AI_CHANGE':
          this.applyAIChange(message.payload).then(sendResponse);
          return true;

        case 'APPLY_AI_REVAMP':
          this.applyRevampChanges(message.payload).then(sendResponse);
          return true; // Keep channel open for async

        case 'DEMO_STATE':
          sendResponse({
            success: true,
            data: { ...this.demo.getState(), sections: pageIndex.listSections() },
          });
          break;

        case 'DEMO_SET_ENABLED':
          this.demo.setEnabled(!!message.enabled);
          sendResponse({ success: true });
          break;

        case 'DEMO_SET_NAME':
          this.demo.setName(String(message.name || ''));
          sendResponse({ success: true });
          break;

        case 'DEMO_REVERT':
          sendResponse({ success: true, data: { reverted: this.demo.revert(String(message.key)) } });
          break;

        case 'DEMO_RESET':
          this.demo.reset().then(() => sendResponse({ success: true }));
          return true;

        case 'DEMO_EXPORT':
          sendResponse({ success: true, data: this.demo.toConfig() });
          break;

        case 'DEMO_IMPORT':
          try {
            sendResponse({ success: true, data: this.demo.importConfig(message.config) });
          } catch (error) {
            sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
          }
          break;

        case 'ANNOTATION_ADD':
          void this.addAnnotation();
          sendResponse({ success: true });
          break;

        case 'ANNOTATION_NOTES_CONTEXT':
          sendResponse({ success: true, data: this.demo.openNotesWithContext() });
          break;

        case 'ANNOTATION_UPDATE':
          sendResponse({
            success: this.demo.updateAnnotation(String(message.id), {
              text: typeof message.text === 'string' ? message.text : undefined,
              resolved: typeof message.resolved === 'boolean' ? message.resolved : undefined,
            }),
          });
          break;

        case 'ANNOTATION_DELETE':
          sendResponse({ success: this.demo.deleteAnnotation(String(message.id)) });
          break;

        case 'ANNOTATION_VISIBLE':
          this.annotations.setVisible(!!message.visible);
          sendResponse({ success: true });
          break;

        case 'PRESENTATION_SET':
          this.setPresentation(!!message.on);
          sendResponse({ success: true });
          break;

        case 'EXPORT_SNAPSHOT':
          this.exportSnapshot(message.options).then(sendResponse);
          return true;

        case 'HANDOFF_CAPTURE':
          this.captureHandoff().then(sendResponse);
          return true;

        case 'SCREENSHOT':
          this.takeScreenshot(!!message.fullPage).then(sendResponse);
          return true;

        case 'LOCATE_ELEMENT':
          sendResponse(this.locateElement(Number(message.id), String(message.label || '')));
          break;

        case 'GET_PAGE_INDEX':
          sendResponse(this.getPageIndex(message.selector));
          break;

        case 'SECTION_COVERAGE':
          sendResponse({ success: true, data: { untouched: pageIndex.untouchedSections(message.payload?.targets || []) } });
          break;

        case 'APPLY_OPERATIONS':
          sendResponse(this.applyOperations(message.payload?.operations || []));
          break;

        case 'CHECK_OPERATIONS':
          sendResponse({
            success: true,
            data: {
              problems: (message.payload?.operations || [])
                .map((op: Operation) => ({ operationId: op.id, error: layoutRisk(op, pageIndex) }))
                .filter((problem: { error: string | null }) => problem.error),
            },
          });
          break;

        case 'PREVIEW_OPERATIONS':
          sendResponse(this.previewOperations(message.payload?.operations || []));
          break;

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

    // Position is not restored: each open starts at the right edge so a panel
    // dragged off-screen last time can never open unreachable.
    const savedSize = this.loadPanelSize();

    // Create container
    const container = document.createElement('div');
    container.id = 'revamp-floating-panel';
    container.setAttribute('data-revamp-ui', 'true');
    container.style.cssText = `
      position: fixed;
      right: 20px;
      top: 80px;
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
   * Run operations on elements found via legacy selector info, as one history entry each
   */
  private applyToSelector(
    selectorInfo: SelectorInfo,
    build: (id: number) => Operation
  ): MessageResponse {
    const element = SelectorGenerator.resolve(selectorInfo.selector, selectorInfo.type);
    if (!element) {
      console.error('[Revamp] Element not found:', selectorInfo.selector);
      return { success: false, error: 'The element was not found on the page. Select it again.' };
    }
    const [result] = changeManager.applyOperations([build(pageIndex.idOf(element))], pageIndex);
    if (!result.success) console.error('[Revamp] Edit failed:', result.error);
    return result.success ? { success: true } : { success: false, error: result.error };
  }

  /**
   * Edit text content of an element
   */
  editText(selectorInfo: SelectorInfo, newValue: string): MessageResponse {
    return this.applyToSelector(selectorInfo, (target) => ({
      id: `edit-text-${Date.now()}`, op: 'set_text', target, text: newValue, explanation: 'Edit text',
    }));
  }

  /**
   * Edit attribute of an element
   */
  editAttribute(selectorInfo: SelectorInfo, attribute: string, value: string): MessageResponse {
    return this.applyToSelector(selectorInfo, (target) => ({
      id: `edit-attr-${Date.now()}`, op: 'set_attr', target, name: attribute, value, explanation: `Set ${attribute}`,
    }));
  }

  /**
   * Apply CSS styles to an element
   */
  applyCSS(selectorInfo: SelectorInfo, styles: Record<string, string>): MessageResponse {
    return this.applyToSelector(selectorInfo, (target) => ({
      id: `edit-style-${Date.now()}`, op: 'set_style', target, styles, explanation: 'Edit style',
    }));
  }

  /**
   * Undo the last applied change
   */
  undoLastEdit(): void {
    if (!changeManager.undo()) console.log('[Revamp] No edits to undo');
  }

  /**
   * Get full page HTML
   */
  getPageHTML(): string {
    // Export the page as the demo shows it, without Revamp's own UI or bookkeeping attributes
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-revamp-ui], #revamp-inspector-styles').forEach(el => el.remove());
    clone.querySelectorAll('[data-revamp-hidden], [data-revamp-display]').forEach(el => {
      el.removeAttribute('data-revamp-hidden');
      el.removeAttribute('data-revamp-display');
    });
    return clone.outerHTML;
  }

  /**
   * Apply a single selector-based AI change (legacy format) to every matched element
   */
  async applyAIChange(payload: ApplyChangePayload): Promise<MessageResponse> {
    if ((payload.action as string) === 'script') {
      return { success: false, error: 'Script actions are not supported. Use text, style, html or attribute changes.' };
    }

    const [result] = await this.applySelectorChanges([{
      id: `legacy-${Date.now()}`,
      action: payload.action as AIChange['action'],
      selector: payload.selector.selector,
      value: payload.value,
      attribute: payload.attribute,
      explanation: 'AI change',
    }]);

    return result.success
      ? { success: true, data: { appliedCount: result.elementsAffected } }
      : { success: false, error: result.error };
  }

  /**
   * Apply selector-based changes. Everything except "insert" is converted to
   * operations so it is logged, revertible, saved and exportable like any other edit.
   */
  private async applySelectorChanges(changes: AIChange[]): Promise<ChangeResult[]> {
    const results: ChangeResult[] = [];

    for (const change of changes) {
      const converted = legacyChangeToOperations(change, pageIndex);

      if (converted === null) {
        // "insert" has no operation equivalent
        results.push(await changeManager.applyChange(change));
        continue;
      }
      if ('error' in converted) {
        results.push({ changeId: change.id, success: false, elementsAffected: 0, error: converted.error });
        continue;
      }

      const opResults = changeManager.applyOperations(converted.operations, pageIndex);
      const ok = opResults.filter(r => r.success).length;
      results.push({
        changeId: change.id,
        success: ok > 0,
        elementsAffected: ok,
        error: ok === 0 ? opResults[0]?.error : undefined,
      });
    }

    return results;
  }

  /**
   * Apply AI Revamp Changes (selector-based structured format)
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

      this.previewOverlay.clear();
      console.log('[Revamp] Applying', response.changes.length, 'changes');

      const results = await this.applySelectorChanges(response.changes);

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
   * Build the numbered page index the AI uses to reference elements
   */
  getPageIndex(selector?: string): MessageResponse {
    try {
      let root: Element | null = null;
      if (selector) root = SelectorGenerator.query(selector).elements[0] || null;
      if (!root) root = this.selectedElement || document.body;
      if (!root) return { success: false, error: 'No element to index' };

      const { text, count, truncated } = pageIndex.build(root);
      return {
        success: true,
        data: {
          mode: root === document.body ? 'page' : 'element',
          rootId: pageIndex.idOf(root),
          rootTag: root.tagName.toLowerCase(),
          index: text,
          count,
          truncated,
          url: location.href,
          title: document.title,
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Apply structured operations from the AI
   */
  applyOperations(operations: Operation[]): MessageResponse {
    this.previewOverlay.clear();
    if (operations.length === 0) return { success: false, error: 'No operations to apply' };

    const results = changeManager.applyOperations(operations, pageIndex);
    const succeeded = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success);

    return {
      success: succeeded > 0,
      data: {
        summary: `Applied ${succeeded}/${operations.length} change(s)`,
        results,
        failures: failures.length > 0 ? failures : undefined,
        undoCount: changeManager.getUndoStackSize(),
      },
      error: succeeded === 0 ? failures[0]?.error || 'No changes could be applied' : undefined,
    };
  }

  /**
   * Highlight the elements operations would touch
   */
  previewOperations(operations: Operation[]): MessageResponse {
    const result = this.previewOverlay.show(
      operations.map(op => ({
        id: op.id,
        selector: `revamp-id:${op.target}`,
        label: `[${op.target}] ${op.op}${op.explanation ? ` – ${op.explanation}` : ''}`.slice(0, 80),
      })),
      selector => this.resolvePreviewSelector(selector)
    );
    return { success: true, data: { matches: result.matches, errors: result.errors } };
  }

  /**
   * Let the user click an element, then write a note for it
   */
  private async addAnnotation(): Promise<void> {
    const el = await this.annotations.pickElement((target) => {
      if (target) this.pickOverlay.highlight(target);
      else this.pickOverlay.hide();
    });
    if (!el) return;

    this.annotations.openPopover(el, '', {
      onSave: (text) => this.demo.addAnnotation(el, text),
    });
  }

  private editAnnotation(annotation: Annotation): void {
    const el = this.demo.resolveAnnotation(annotation);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });

    this.annotations.openPopover(el, annotation.text, {
      resolved: annotation.resolved,
      onSave: (text) => this.demo.updateAnnotation(annotation.id, { text }),
      onToggleResolved: () => this.demo.updateAnnotation(annotation.id, { resolved: !annotation.resolved }),
      onDelete: () => this.demo.deleteAnnotation(annotation.id),
    });
  }

  /**
   * Presentation mode: hide Revamp's panel and overlays so the page looks like the real site,
   * leaving a small pill to exit (Esc also exits).
   */
  setPresentation(on: boolean): void {
    const panel = document.getElementById('revamp-floating-panel');
    const existing = document.getElementById('revamp-presentation-pill');

    if (!on) {
      existing?.remove();
      this.annotations.suspend(false);
      document.removeEventListener('keydown', this.handlePresentationKey, true);
      if (panel) panel.style.display = '';
      return;
    }

    this.stopInspector();
    this.previewOverlay.clear();
    this.annotations.suspend(true);
    if (panel) panel.style.display = 'none';
    existing?.remove();

    const pill = document.createElement('div');
    pill.id = 'revamp-presentation-pill';
    pill.setAttribute('data-revamp-ui', 'true');
    pill.style.cssText = `
      position: fixed; left: 16px; bottom: 16px; z-index: 2147483647;
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; border-radius: 999px;
      background: rgba(17, 24, 39, 0.85); color: #fff;
      font: 12px/1.2 system-ui, sans-serif; opacity: 0.35; transition: opacity .15s;
    `;
    pill.onmouseenter = () => (pill.style.opacity = '1');
    pill.onmouseleave = () => (pill.style.opacity = '0.35');

    const label = document.createElement('span');
    label.textContent = `${this.demo.getState().name || 'Demo preview'} · Esc to exit`;
    const exit = document.createElement('button');
    exit.textContent = 'Exit';
    exit.style.cssText = 'all: unset; cursor: pointer; font-weight: 600; text-decoration: underline;';
    exit.onclick = () => this.setPresentation(false);
    pill.append(label, exit);
    document.body.appendChild(pill);

    document.addEventListener('keydown', this.handlePresentationKey, true);
  }

  private handlePresentationKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.setPresentation(false);
  };

  /**
   * Run `fn` with all of Revamp's UI (panel, presentation pill, note pins, overlays) hidden
   */
  private async withCleanPage<T>(fn: () => Promise<T>): Promise<T> {
    const panel = document.getElementById('revamp-floating-panel');
    const pill = document.getElementById('revamp-presentation-pill');
    const hiddenUi = [panel, pill].filter((el): el is HTMLElement => !!el);
    const previousDisplay = hiddenUi.map(el => el.style.display);

    this.previewOverlay.clear();
    this.overlay.hide();
    this.annotations.suspend(true);
    hiddenUi.forEach(el => (el.style.display = 'none'));

    try {
      return await fn();
    } finally {
      hiddenUi.forEach((el, i) => (el.style.display = previousDisplay[i]));
      // Stay hidden if presentation mode is still on
      if (!document.getElementById('revamp-presentation-pill')) this.annotations.suspend(false);
    }
  }

  private requestFrame = async (): Promise<string> => {
    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' });
    if (!response?.success) throw new Error(response?.error || 'Screenshot capture failed');
    return response.data as string;
  };

  /**
   * Capture the page as a PNG download with all Revamp UI hidden
   */
  async takeScreenshot(fullPage: boolean): Promise<MessageResponse> {
    try {
      return await this.withCleanPage(async () => {
        const { blob, truncated } = await captureScreenshot(fullPage, this.requestFrame);

        const slug = (this.demo.getState().name || document.title || 'revamp-demo')
          .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        downloadBlob(blob, `${slug || 'revamp-demo'}-${fullPage ? 'full' : 'view'}.png`);

        return { success: true, data: { truncated } };
      });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Snapshot the page (markup + CSS) for a static export. With includeDemo off the original page is exported.
   */
  async exportSnapshot(options: ExportOptions): Promise<MessageResponse> {
    const switchOff = !options.includeDemo && this.demo.getState().enabled && changeManager.getUndoStackSize() > 0;
    if (switchOff) this.demo.setEnabled(false);

    try {
      if (switchOff) await new Promise(resolve => setTimeout(resolve, 200));
      const snapshot = await capturePageSnapshot({
        keepScripts: !!options.keepScripts,
        scrollFirst: !!options.scrollFirst,
        // With demo changes included, protect edited elements from lazy-loaders that run while scrolling
        editedElements: options.includeDemo ? changeManager.editedElements() : [],
      });
      return { success: true, data: snapshot };
    } catch (error) {
      console.error('[Revamp] Export snapshot failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (switchOff) this.demo.setEnabled(true);
    }
  }

  /**
   * Full-page screenshots for a handoff package: "after" shows the demo, "before" the original page
   */
  async captureHandoff(): Promise<MessageResponse> {
    const toDataUrl = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read screenshot'));
        reader.readAsDataURL(blob);
      });

    try {
      return await this.withCleanPage(async () => {
        const after = await captureScreenshot(true, this.requestFrame);
        let before: string | null = null;

        const hasChanges = this.demo.getState().enabled && changeManager.getUndoStackSize() > 0;
        if (hasChanges) {
          this.demo.setEnabled(false);
          try {
            await new Promise(resolve => setTimeout(resolve, 300));
            before = await toDataUrl((await captureScreenshot(true, this.requestFrame)).blob);
          } finally {
            this.demo.setEnabled(true);
          }
        }

        return {
          success: true,
          data: { after: await toDataUrl(after.blob), before, truncated: after.truncated },
        };
      });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Scroll to and outline one indexed element
   */
  locateElement(id: number, label: string): MessageResponse {
    const result = this.previewOverlay.show(
      [{ id: 'locate', selector: `revamp-id:${id}`, label: label.slice(0, 80) || `[${id}]` }],
      selector => this.resolvePreviewSelector(selector)
    );
    window.clearTimeout(this.locateTimer);
    this.locateTimer = window.setTimeout(() => this.previewOverlay.clear(), 2500);
    return { success: true, data: { matches: result.matches, errors: result.errors } };
  }

  /** Resolves "revamp-id:N" targets through the page index, anything else as CSS/XPath */
  private resolvePreviewSelector(selector: string): { elements: Element[]; error?: string } {
    const match = selector.match(/^revamp-id:(\d+)$/);
    if (match) {
      const el = pageIndex.resolve(Number(match[1]));
      return el ? { elements: [el] } : { elements: [], error: 'Element no longer exists on the page' };
    }
    return SelectorGenerator.query(selector);
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

      const result = this.previewOverlay.show(
        response.changes.map(change => ({
          id: change.id,
          selector: change.selector,
          label: `[${change.action}] ${change.explanation || change.selector}`.slice(0, 80),
        })),
        selector => SelectorGenerator.query(selector)
      );

      return {
        success: true,
        data: {
          message: `Previewing ${response.changes.length} changes`,
          matches: result.matches,
          errors: result.errors
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
    this.previewOverlay.clear();
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

    const isUnique = (sel: string) => {
      try {
        return document.querySelectorAll(sel).length === 1 && document.querySelector(sel) === el;
      } catch {
        return false;
      }
    };

    // Prefer data-* attributes for stability, but only when they identify exactly this element
    const dataAttrs = ['data-testid', 'data-test', 'data-id', 'data-qa', 'data-cy', 'data-component'];
    for (const attr of dataAttrs) {
      const value = el.getAttribute(attr);
      if (value) {
        const sel = `[${attr}="${CSS.escape(value)}"]`;
        if (isUnique(sel)) return sel;
      }
    }

    // Try ID
    if (el.id) {
      const sel = `#${CSS.escape(el.id)}`;
      if (isUnique(sel)) return sel;
    }

    // Try tag + classes (limit to 3), only if unique
    const classes = Array.from(el.classList).slice(0, 3);
    if (classes.length > 0) {
      const sel = `${el.tagName.toLowerCase()}${classes.map(c => `.${CSS.escape(c)}`).join('')}`;
      if (isUnique(sel)) return sel;
    }

    // Fallback: unique structural path (nth-of-type chain, anchored at nearest unique id)
    return SelectorGenerator.generate(el).selector;
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
