import { Annotation } from '../types/demo';
import type { DictationState, NoteDictationEvent } from '../types/voice';

const Z = 2147483646;

/** The panel owns the microphone: the page only asks it to start/stop and shows what comes back */
export interface PopoverDictation {
  toggle: () => void;
  cancel: () => void;
}

interface ActiveDictation {
  textarea: HTMLTextAreaElement;
  mic: HTMLButtonElement;
  status: HTMLDivElement;
  api: PopoverDictation;
  state: DictationState;
  base: string;
}

interface PopoverHandlers {
  /** Present only when the panel is open to do the listening */
  dictation?: PopoverDictation;
  onSave: (text: string) => void;
  onCancel?: () => void;
  onDelete?: () => void;
  onToggleResolved?: () => void;
  resolved?: boolean;
}

/**
 * Numbered pins and note popovers drawn over the page.
 * Everything lives in one container marked data-revamp-ui so it is excluded
 * from the page index, exports and screenshots.
 */
export class AnnotationLayer {
  private container: HTMLDivElement | null = null;
  private popover: HTMLDivElement | null = null;
  private dictation: ActiveDictation | null = null;
  private visible = true;
  private suspended = false;
  private rafId = 0;
  private cleanupPicking: (() => void) | null = null;

  constructor(
    private getAnnotations: () => Annotation[],
    private resolve: (annotation: Annotation) => Element | null,
    private onPinClick: (annotation: Annotation) => void
  ) {
    window.addEventListener('resize', this.scheduleRender);
    window.addEventListener('load', this.scheduleRender);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.render();
  }

  /** Hide everything temporarily (presentation, screenshots) without changing the user's setting */
  suspend(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.closePopover();
    this.render();
  }

  scheduleRender = (): void => {
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(() => this.render());
  };

  render(): void {
    this.container?.remove();
    this.container = null;
    if (!this.visible || this.suspended) return;

    const annotations = this.getAnnotations();
    if (annotations.length === 0) return;

    const container = document.createElement('div');
    container.setAttribute('data-revamp-ui', 'true');
    container.id = 'revamp-annotations';
    container.style.cssText = `position:absolute;top:0;left:0;width:0;height:0;z-index:${Z};`;

    annotations.forEach((annotation, i) => {
      const el = this.resolve(annotation);
      if (!el) return;

      const rect = el.getBoundingClientRect();
      // Skip elements that are not rendered (e.g. hidden sections)
      if (rect.width === 0 && rect.height === 0) return;

      const pin = document.createElement('button');
      pin.type = 'button';
      pin.textContent = annotation.resolved ? '✓' : String(i + 1);
      pin.title = annotation.text;
      pin.setAttribute('aria-label', `Note ${i + 1}: ${annotation.text}`);
      pin.style.cssText = `
        all: unset; box-sizing: border-box; cursor: pointer;
        position: absolute;
        top: ${Math.max(0, rect.top + window.scrollY - 10)}px;
        left: ${Math.max(0, rect.left + window.scrollX - 10)}px;
        width: 24px; height: 24px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        background: ${annotation.resolved ? '#16a34a' : '#f59e0b'}; color: #fff;
        font: 700 12px/1 system-ui, sans-serif;
        box-shadow: 0 1px 4px rgba(0,0,0,.4); border: 2px solid #fff;
      `;
      pin.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onPinClick(annotation);
      });
      container.appendChild(pin);
    });

    document.documentElement.appendChild(container);
    this.container = container;
  }

  /**
   * Let the user click any element on the page. Resolves with the element, or null if cancelled (Esc).
   */
  pickElement(highlight: (el: Element | null) => void): Promise<Element | null> {
    this.cancelPicking();

    return new Promise((resolve) => {
      const isUi = (target: EventTarget | null) =>
        !(target instanceof Element) || !!target.closest('[data-revamp-ui]');

      const move = (event: MouseEvent) => {
        highlight(isUi(event.target) ? null : (event.target as Element));
      };
      const click = (event: MouseEvent) => {
        if (isUi(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        finish(event.target as Element);
      };
      const key = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      };
      const teardown = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('click', click, true);
        document.removeEventListener('keydown', key, true);
        document.documentElement.style.cursor = '';
        this.cleanupPicking = null;
        highlight(null);
      };
      const finish = (el: Element | null) => {
        teardown();
        resolve(el);
      };

      document.addEventListener('mousemove', move, true);
      document.addEventListener('click', click, true);
      document.addEventListener('keydown', key, true);
      document.documentElement.style.cursor = 'crosshair';

      // Replaced or cancelled from outside: settle as "no element"
      this.cleanupPicking = () => {
        teardown();
        resolve(null);
      };
    });
  }

  cancelPicking(): void {
    this.cleanupPicking?.();
  }

  /** Small editor next to an element: used to write a new note or edit an existing one */
  openPopover(el: Element, initialText: string, handlers: PopoverHandlers): void {
    this.closePopover();

    const rect = el.getBoundingClientRect();
    // Wide enough for the whole button row (mic, Save, Cancel, Resolve, Delete) on one line
    const viewportWidth = document.documentElement.clientWidth;
    const width = Math.min(380, viewportWidth - 16);
    const popover = document.createElement('div');
    popover.setAttribute('data-revamp-ui', 'true');
    popover.style.cssText = `
      position: absolute; z-index: ${Z + 1};
      top: ${rect.top + window.scrollY + 18}px;
      left: ${Math.max(8, Math.min(rect.left + window.scrollX, window.scrollX + viewportWidth - width - 8))}px;
      box-sizing: border-box; width: ${width}px; padding: 12px; border-radius: 8px;
      background: #fff; color: #111827; box-shadow: 0 6px 24px rgba(0,0,0,.3);
      font: 13px/1.4 system-ui, sans-serif; border: 1px solid #e5e7eb;
    `;

    // Keep clicks and keys inside the popover from reaching the page
    ['mousedown', 'click', 'keydown', 'keyup'].forEach((type) =>
      popover.addEventListener(type, (event) => event.stopPropagation())
    );

    const textarea = document.createElement('textarea');
    textarea.value = initialText;
    textarea.rows = 3;
    textarea.placeholder = 'e.g. Replace this image with the new campaign image';
    textarea.style.cssText =
      'width:100%;box-sizing:border-box;resize:vertical;padding:6px;border:1px solid #d1d5db;border-radius:6px;font:inherit;color:inherit;background:#fff;';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center;';

    const button = (label: string, style: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = `cursor:pointer;border-radius:6px;padding:4px 10px;font:inherit;border:1px solid #d1d5db;background:#fff;color:#111827;${style}`;
      b.addEventListener('click', onClick);
      return b;
    };

    const save = button('Save', 'background:#2563eb;color:#fff;border-color:#2563eb;', () => {
      const text = textarea.value.trim();
      if (!text) {
        textarea.focus();
        return;
      }
      this.closePopover();
      handlers.onSave(text);
    });
    row.appendChild(save);
    row.appendChild(button('Cancel', '', () => {
      this.closePopover();
      handlers.onCancel?.();
    }));

    if (handlers.onToggleResolved) {
      row.appendChild(button(handlers.resolved ? 'Reopen' : 'Resolve', 'margin-left:auto;', () => {
        this.closePopover();
        handlers.onToggleResolved!();
      }));
    }
    if (handlers.onDelete) {
      row.appendChild(button('Delete', 'color:#dc2626;', () => {
        this.closePopover();
        handlers.onDelete!();
      }));
    }

    if (handlers.dictation) {
      const status = document.createElement('div');
      status.style.cssText = 'margin-top:6px;font-size:12px;color:#6b7280;display:none;';
      status.setAttribute('role', 'status');

      const mic = button('🎤', 'padding:4px 8px;', () => {
        const active = this.dictation;
        if (!active) return;
        if (active.state === 'idle' || active.state === 'error') active.base = textarea.value;
        active.api.toggle();
      });
      mic.title = 'Dictate with your voice';
      mic.setAttribute('aria-label', 'Dictate with your voice');
      row.insertBefore(mic, row.firstChild);
      popover.append(textarea, status, row);
      this.dictation = { textarea, mic, status, api: handlers.dictation, state: 'idle', base: '' };
    } else {
      popover.append(textarea, row);
    }

    document.documentElement.appendChild(popover);
    this.popover = popover;
    textarea.focus();
  }

  /** Result of the panel's microphone for the open popover (ignored when there is none) */
  applyDictation(event: NoteDictationEvent): void {
    const d = this.dictation;
    if (!d) return;

    if (event.kind === 'text') {
      d.textarea.value = !event.text ? d.base : !d.base ? event.text : /\s$/.test(d.base) ? d.base + event.text : `${d.base} ${event.text}`;
      return;
    }

    d.state = event.state;
    const busy = event.state === 'listening' || event.state === 'transcribing';
    // Typing while text arrives would be overwritten, so the field waits
    d.textarea.readOnly = busy;
    d.mic.disabled = event.state === 'transcribing';
    d.mic.style.background = event.state === 'listening' ? '#fef2f2' : '#fff';
    d.mic.style.borderColor = event.state === 'listening' ? '#f87171' : '#d1d5db';
    d.mic.textContent = event.state === 'transcribing' ? '…' : '🎤';

    const message =
      event.state === 'listening' ? 'Listening… press the microphone again to stop.'
      : event.state === 'transcribing' ? 'Transcribing…'
      : event.state === 'error' ? event.error || 'Dictation failed.'
      : '';
    d.status.textContent = message;
    d.status.style.display = message ? 'block' : 'none';
    d.status.style.color = event.state === 'error' ? '#dc2626' : '#6b7280';
  }

  closePopover(): void {
    const d = this.dictation;
    this.dictation = null;
    if (d && (d.state === 'listening' || d.state === 'transcribing')) d.api.cancel();
    this.popover?.remove();
    this.popover = null;
  }

  destroy(): void {
    this.cancelPicking();
    this.closePopover();
    this.container?.remove();
    window.removeEventListener('resize', this.scheduleRender);
    window.removeEventListener('load', this.scheduleRender);
  }
}
