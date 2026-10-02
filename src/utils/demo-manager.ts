import { Annotation, AnnotationInfo, DemoConfig, HistoryItem, PersistedOperation } from '../types/demo';
import { Operation } from '../types/operations';
import { ChangeManager } from './change-manager';
import { PageIndex } from './page-index';
import { captureLocator, resolveLocator } from './locator';
import { validateOperation } from './operation-parser';

const RETRY_DELAYS_MS = [1000, 3000, 7000, 15000];
const SAVE_DEBOUNCE_MS = 300;

/**
 * Keep only well-formed annotations from storage or an imported file
 */
function sanitizeAnnotations(raw: unknown): Annotation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a: any) => a && typeof a.id === 'string' && typeof a.text === 'string' && a.target
      && typeof a.target.tag === 'string' && typeof a.target.selector === 'string')
    .map((a: any) => ({
      id: a.id,
      text: a.text,
      resolved: !!a.resolved,
      createdAt: typeof a.createdAt === 'number' ? a.createdAt : Date.now(),
      target: {
        selector: a.target.selector,
        tag: a.target.tag,
        text: typeof a.target.text === 'string' ? a.target.text : '',
        ord: typeof a.target.ord === 'number' ? a.target.ord : 0,
      },
    }));
}

/**
 * Owns the "demo" for the current page: saves the applied operations per URL,
 * re-applies them after a reload, and handles on/off, reset, export and import.
 */
export class DemoManager {
  private enabled = true;
  private name = '';
  /** Saved operations whose elements could not be located (yet) */
  private pending: PersistedOperation[] = [];
  /** Operations kept aside while demo mode is switched off */
  private parked: PersistedOperation[] = [];
  private annotations: Annotation[] = [];
  private annotationListeners = new Set<() => void>();
  private restoring = false;
  private saveTimer: number | undefined;
  private retryTimer: number | undefined;
  private retryRound = 0;

  constructor(private history: ChangeManager, private index: PageIndex) {
    this.history.onChange(() => this.scheduleSave());
  }

  get pageKey(): string {
    return `${location.origin}${location.pathname}`;
  }

  private get storageKey(): string {
    return `demo:${this.pageKey}`;
  }

  /** Load the saved demo for this page and re-apply it */
  async init(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(this.storageKey);
      const config = stored[this.storageKey] as DemoConfig | undefined;
      if (!config || config.kind !== 'revamp-demo') return;

      this.name = config.name || '';
      this.annotations = sanitizeAnnotations(config.annotations);
      this.notifyAnnotations();
      this.enabled = config.enabled !== false;
      if (this.enabled) this.startRestore(config.operations || []);
      else this.parked = config.operations || [];
    } catch (error) {
      console.error('[Demo] Failed to load saved demo:', error);
    }
  }

  getState() {
    const items: HistoryItem[] = [
      ...this.history.list(),
      ...this.pending.map((p): HistoryItem => ({
        key: `pending:${p.id}`,
        op: p.op,
        label: p.op,
        explanation: p.explanation,
        status: 'pending',
      })),
    ];
    return {
      enabled: this.enabled,
      name: this.name,
      pageKey: this.pageKey,
      items,
      parkedCount: this.parked.length,
      annotations: this.listAnnotations(),
    };
  }

  // ---- annotations ----

  onAnnotationsChange(listener: () => void): void {
    this.annotationListeners.add(listener);
  }

  private notifyAnnotations(): void {
    this.annotationListeners.forEach((l) => l());
  }

  /** The element an annotation currently points at, or null if it can't be found */
  resolveAnnotation(annotation: Annotation): Element | null {
    return resolveLocator(annotation.target);
  }

  getAnnotations(): Annotation[] {
    return this.annotations;
  }

  listAnnotations(): AnnotationInfo[] {
    return this.annotations.map((a, i) => {
      const el = this.resolveAnnotation(a);
      return {
        id: a.id,
        number: i + 1,
        text: a.text,
        resolved: a.resolved,
        createdAt: a.createdAt,
        elementId: el ? this.index.idOf(el) : undefined,
        elementLabel: a.target.text ? `${a.target.tag} "${a.target.text.slice(0, 40)}"` : a.target.tag,
        found: !!el,
      };
    });
  }

  /**
   * Open notes together with the full content of the element each one is attached to,
   * indexed with element ids, so an AI request can act on the real text (not a short label).
   */
  openNotesWithContext(): Array<AnnotationInfo & { tag: string; context: string }> {
    const MAX_CONTEXT = 6000;
    return this.listAnnotations()
      .filter((n) => !n.resolved && n.found && n.elementId !== undefined)
      .map((n) => {
        const el = this.index.resolve(n.elementId!)!;
        const tag = el.tagName.toLowerCase();
        const { text } = this.index.build(el);
        // Containers without a line of their own still need their id in the context
        const body = text.includes(`[${n.elementId}]`) ? text : `[${n.elementId}] ${tag}\n${text}`;
        return {
          ...n,
          tag,
          context: body.length > MAX_CONTEXT ? `${body.slice(0, MAX_CONTEXT)}\n…[context truncated]` : body,
        };
      });
  }

  addAnnotation(el: Element, text: string): Annotation {
    const annotation: Annotation = {
      id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      target: captureLocator(el),
      text: text.trim(),
      resolved: false,
      createdAt: Date.now(),
    };
    this.annotations.push(annotation);
    this.annotationsChanged();
    return annotation;
  }

  updateAnnotation(id: string, patch: { text?: string; resolved?: boolean }): boolean {
    const annotation = this.annotations.find((a) => a.id === id);
    if (!annotation) return false;
    if (patch.text !== undefined) annotation.text = patch.text.trim();
    if (patch.resolved !== undefined) annotation.resolved = patch.resolved;
    this.annotationsChanged();
    return true;
  }

  deleteAnnotation(id: string): boolean {
    const before = this.annotations.length;
    this.annotations = this.annotations.filter((a) => a.id !== id);
    if (this.annotations.length === before) return false;
    this.annotationsChanged();
    return true;
  }

  private annotationsChanged(): void {
    this.notifyAnnotations();
    this.scheduleSave();
  }

  setName(name: string): void {
    this.name = name.trim();
    this.scheduleSave();
  }

  /** Switch the demo on or off. Off reverts the page but keeps the saved changes. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;

    if (!enabled) {
      this.parked = [...this.history.persistedOperations(), ...this.pending];
      this.pending = [];
      this.clearRetry();
      this.enabled = false;
      this.suspendSave(() => this.history.undoAll());
      this.saveNow();
    } else {
      this.enabled = true;
      const toApply = this.parked;
      this.parked = [];
      this.startRestore(toApply);
    }
  }

  /** Revert one change (and later changes built on it). Pending changes are just dropped. */
  revert(key: string): number {
    if (key.startsWith('pending:')) {
      const id = key.slice('pending:'.length);
      const before = this.pending.length;
      this.pending = this.pending.filter((p) => p.id !== id);
      this.scheduleSave();
      return before - this.pending.length;
    }
    return this.history.revertByKey(key);
  }

  /** Remove every change and forget the saved demo */
  async reset(): Promise<void> {
    this.clearRetry();
    this.pending = [];
    this.parked = [];
    this.annotations = [];
    this.notifyAnnotations();
    this.suspendSave(() => this.history.undoAll());
    window.clearTimeout(this.saveTimer);
    try {
      await chrome.storage.local.remove(this.storageKey);
    } catch (error) {
      console.error('[Demo] Failed to clear saved demo:', error);
    }
  }

  toConfig(): DemoConfig {
    return {
      kind: 'revamp-demo',
      version: 1,
      name: this.name,
      pageKey: this.pageKey,
      url: location.href,
      savedAt: Date.now(),
      enabled: this.enabled,
      operations: this.enabled
        ? [...this.history.persistedOperations(), ...this.pending]
        : this.parked,
      annotations: this.annotations,
    };
  }

  /** Replace the current demo with an imported one */
  importConfig(config: unknown): { applied: number; pending: number } {
    const cfg = config as Partial<DemoConfig> | null;
    if (!cfg || cfg.kind !== 'revamp-demo' || !Array.isArray(cfg.operations)) {
      throw new Error('Not a Revamp demo file');
    }
    if (cfg.version !== 1) throw new Error(`Unsupported demo version: ${cfg.version}`);

    this.clearRetry();
    this.suspendSave(() => this.history.undoAll());
    this.pending = [];
    this.parked = [];
    this.name = cfg.name || '';
    this.annotations = sanitizeAnnotations(cfg.annotations);
    this.notifyAnnotations();
    this.enabled = true;

    this.startRestore(cfg.operations);
    return { applied: this.history.getUndoStackSize(), pending: this.pending.length };
  }

  // ---- internals ----

  /** Apply saved operations, then keep retrying the ones whose elements have not rendered yet */
  private startRestore(operations: PersistedOperation[]): void {
    this.clearRetry();
    this.restore(operations);
    if (this.pending.length > 0) this.scheduleRetry();
  }

  /** One pass: apply what can be located, leave the rest in `pending` */
  private restore(operations: PersistedOperation[]): void {
    this.restoring = true;
    const stillPending: PersistedOperation[] = [];

    for (const persisted of operations) {
      if (!this.tryApply(persisted)) stillPending.push(persisted);
    }

    this.pending = stillPending;
    this.restoring = false;
    this.saveNow();
  }

  /** true = handled (applied, or permanently invalid); false = element not found yet */
  private tryApply(persisted: PersistedOperation): boolean {
    const target = resolveLocator(persisted.target);
    const ref = persisted.ref ? resolveLocator(persisted.ref) : null;
    if (!target || (persisted.ref && !ref)) return false;

    // Saved files can be edited or come from elsewhere, so validate like AI output
    const checked = validateOperation(
      {
        ...persisted.args,
        id: persisted.id,
        op: persisted.op,
        explanation: persisted.explanation,
        target: this.index.idOf(target),
        ...(ref ? { ref: this.index.idOf(ref) } : {}),
      },
      0
    );
    if (typeof checked === 'string') {
      console.warn('[Demo] Skipping invalid saved change:', checked);
      return true;
    }
    const operation: Operation = checked;

    const [result] = this.history.applyOperations([operation], this.index);
    if (!result.success) console.warn('[Demo] Saved change could not be applied:', persisted.op, result.error);
    // A change that fails validation will never succeed later; don't retry it forever
    return true;
  }

  private scheduleRetry(): void {
    if (this.retryRound >= RETRY_DELAYS_MS.length) return;
    this.retryTimer = window.setTimeout(() => {
      if (!this.enabled || this.pending.length === 0) return;
      this.restore(this.pending);
      this.retryRound++;
      if (this.pending.length > 0) this.scheduleRetry();
    }, RETRY_DELAYS_MS[this.retryRound]);
  }

  private clearRetry(): void {
    window.clearTimeout(this.retryTimer);
    this.retryRound = 0;
  }

  private suspendSave(fn: () => void): void {
    const previous = this.restoring;
    this.restoring = true;
    try {
      fn();
    } finally {
      this.restoring = previous;
    }
  }

  private scheduleSave(): void {
    if (this.restoring) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), SAVE_DEBOUNCE_MS);
  }

  private async saveNow(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    const config = this.toConfig();
    try {
      if (config.operations.length === 0 && this.enabled && !this.name && this.annotations.length === 0) {
        await chrome.storage.local.remove(this.storageKey);
      } else {
        await chrome.storage.local.set({ [this.storageKey]: config });
      }
    } catch (error) {
      console.error('[Demo] Failed to save demo:', error);
    }
  }
}
