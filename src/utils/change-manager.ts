import { AIChange, ChangeResult } from '../types/ai-response';
import { Operation, OperationResult } from '../types/operations';
import { HistoryItem, PersistedOperation } from '../types/demo';
import { SelectorGenerator } from './selector-generator';
import { applyOperation } from './operation-executor';
import { PageIndex } from './page-index';
import { captureLocator } from './locator';

/**
 * One applied change (possibly touching several elements) and how to undo it.
 * Reverts hold references to the real nodes, so they still work after
 * elements were removed or replaced and a selector would no longer match.
 */
interface HistoryEntry {
  key: string;
  changeId: string;
  action: string;
  label: string;
  explanation: string;
  revert: () => void;
  /** Present for operations; lets the change be saved and replayed after a reload */
  persisted?: PersistedOperation;
  /** Elements the change acted on */
  touched: Element[];
  /** Elements only used as a position reference (e.g. "move before X"); they do not create a dependency */
  references: Element[];
  /** Elements the change created, e.g. a duplicated section */
  created: Element[];
}

let keyCounter = 0;
const nextKey = () => `h${Date.now().toString(36)}${(keyCounter++).toString(36)}`;

/** Split an operation into its element references and the remaining arguments */
function splitOperation(op: Operation): { args: Record<string, unknown> } {
  const { id: _id, op: _op, target: _target, explanation: _explanation, ...rest } = op as Operation & {
    ref?: number;
  };
  const { ref: _ref, ...args } = rest as Record<string, unknown>;
  return { args };
}

/**
 * Applies changes to the page and keeps the history that powers undo,
 * per-change revert and saving a demo.
 */
export class ChangeManager {
  private entries: HistoryEntry[] = [];
  private maxEntries = 200;
  private listeners = new Set<() => void>();

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (error) {
        console.error('[ChangeManager] Listener failed:', error);
      }
    });
  }

  /**
   * Apply single selector-based change to the DOM (fallback path)
   */
  async applyChange(change: AIChange): Promise<ChangeResult> {
    const { elements, error } = SelectorGenerator.query(change.selector);

    if (error) {
      return { changeId: change.id, success: false, elementsAffected: 0, error };
    }

    if (elements.length === 0) {
      return {
        changeId: change.id,
        success: false,
        elementsAffected: 0,
        error: `No elements found for selector: ${change.selector}`,
      };
    }

    const reverts: Array<() => void> = [];

    try {
      for (const element of elements) {
        reverts.push(this.applyToElement(element as HTMLElement, change));
      }
    } catch (err) {
      // Roll back whatever was applied before the failure
      reverts.reverse().forEach((revert) => this.safeRevert(revert));
      console.error('[ChangeManager] Error applying change:', err);
      return {
        changeId: change.id,
        success: false,
        elementsAffected: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    this.push({
      key: nextKey(),
      changeId: change.id,
      action: change.action,
      label: `${change.action} ${change.selector}`,
      explanation: change.explanation || '',
      revert: () => reverts.slice().reverse().forEach((revert) => this.safeRevert(revert)),
      touched: elements,
      references: [],
      created: [],
    });

    return {
      changeId: change.id,
      success: true,
      elementsAffected: elements.length,
    };
  }

  /**
   * Apply multiple selector-based changes
   */
  async applyChanges(changes: AIChange[]): Promise<ChangeResult[]> {
    const results: ChangeResult[] = [];

    for (const change of changes) {
      results.push(await this.applyChange(change));
    }

    return results;
  }

  /**
   * Apply structured operations. Each operation is its own history entry, so a
   * failing operation never blocks or rolls back the others.
   */
  applyOperations(operations: Operation[], index: PageIndex): OperationResult[] {
    return operations.map((op) => this.applyOne(op, index));
  }

  private applyOne(op: Operation, index: PageIndex): OperationResult {
    try {
      // Capture locators before applying: afterwards the element's text/position may differ
      const targetEl = index.resolve(op.target);
      const refEl = op.op === 'move' ? index.resolve(op.ref) : null;
      const persisted: PersistedOperation | undefined = targetEl
        ? {
            id: op.id,
            op: op.op,
            explanation: op.explanation,
            target: captureLocator(targetEl),
            ref: refEl ? captureLocator(refEl) : undefined,
            args: splitOperation(op).args,
          }
        : undefined;

      const { revert, created } = applyOperation(op, index);

      this.push({
        key: nextKey(),
        changeId: op.id,
        action: op.op,
        label: op.op,
        explanation: op.explanation,
        revert,
        persisted,
        touched: targetEl ? [targetEl] : [],
        references: refEl ? [refEl] : [],
        created: created || [],
      });
      return { operationId: op.id, success: true };
    } catch (error) {
      return {
        operationId: op.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** What the history looks like to the UI */
  list(): HistoryItem[] {
    return this.entries.map((e) => ({
      key: e.key,
      op: (e.persisted?.op ?? 'custom') as HistoryItem['op'],
      label: e.label,
      explanation: e.explanation,
      status: 'applied' as const,
    }));
  }

  /** Operations that can be saved, in the order they were applied */
  persistedOperations(): PersistedOperation[] {
    return this.entries.map((e) => e.persisted).filter((p): p is PersistedOperation => !!p);
  }

  /**
   * Undo last change
   */
  undo(): boolean {
    const entry = this.entries.pop();
    if (!entry) return false;

    this.safeRevert(entry.revert);
    this.notify();
    return true;
  }

  /**
   * Revert one change. Later changes that act on the same element (or inside
   * something it created) are reverted first, since they build on it.
   * Returns how many entries were reverted.
   */
  revertByKey(key: string): number {
    const start = this.entries.findIndex((e) => e.key === key);
    if (start === -1) return 0;

    // Cascade: anything after `start` that builds on something already being reverted
    const doomed = new Set<HistoryEntry>([this.entries[start]]);
    for (let i = start + 1; i < this.entries.length; i++) {
      const later = this.entries[i];
      if ([...doomed].some((d) => this.entryDependsOn(later, d))) doomed.add(later);
    }

    const ordered = this.entries.filter((e) => doomed.has(e));
    ordered.slice().reverse().forEach((e) => this.safeRevert(e.revert));
    this.entries = this.entries.filter((e) => !doomed.has(e));
    this.notify();
    return ordered.length;
  }

  /**
   * True if `later` builds on `earlier`: it acts on the same element, or on/near something
   * `earlier` created. Merely using an element as a position reference is not a dependency.
   */
  private entryDependsOn(later: HistoryEntry, earlier: HistoryEntry): boolean {
    return (
      later.touched.some((el) => earlier.touched.includes(el)) ||
      [...later.touched, ...later.references].some((el) =>
        earlier.created.some((c) => c === el || c.contains(el))
      )
    );
  }

  /**
   * Undo all changes
   */
  undoAll(): number {
    let count = 0;
    while (this.entries.length > 0) {
      const entry = this.entries.pop()!;
      this.safeRevert(entry.revert);
      count++;
    }
    if (count > 0) this.notify();
    return count;
  }

  /**
   * Get undo stack size
   */
  getUndoStackSize(): number {
    return this.entries.length;
  }

  /**
   * Apply a change to one element and return the function that reverts it
   */
  private applyToElement(el: HTMLElement, change: AIChange): () => void {
    switch (change.action) {
      case 'css': {
        if (typeof change.value !== 'object' || change.value === null) {
          throw new Error('css change requires an object value');
        }
        const previous = new Map<string, { value: string; priority: string }>();
        Object.entries(change.value).forEach(([prop, val]) => {
          const cssProp = prop.startsWith('--') ? prop : prop.replace(/([A-Z])/g, '-$1').toLowerCase();
          if (!previous.has(cssProp)) {
            previous.set(cssProp, {
              value: el.style.getPropertyValue(cssProp),
              priority: el.style.getPropertyPriority(cssProp),
            });
          }
          el.style.setProperty(cssProp, String(val));
        });
        return () => {
          previous.forEach((old, prop) => {
            if (old.value) el.style.setProperty(prop, old.value, old.priority);
            else el.style.removeProperty(prop);
          });
        };
      }

      case 'html':
      case 'text': {
        const previousNodes = Array.from(el.childNodes);
        if (change.action === 'html') el.innerHTML = change.value;
        else el.textContent = change.value;
        return () => el.replaceChildren(...previousNodes);
      }

      case 'attribute': {
        const name = change.attribute;
        if (!name) throw new Error('attribute change requires an attribute name');
        if (/^on/i.test(name)) throw new Error(`Refusing to set event handler attribute: ${name}`);
        const previous = el.getAttribute(name);
        el.setAttribute(name, change.value);
        return () => {
          if (previous === null) el.removeAttribute(name);
          else el.setAttribute(name, previous);
        };
      }

      case 'remove': {
        const parent = el.parentNode;
        const next = el.nextSibling;
        el.remove();
        return () => {
          if (parent) parent.insertBefore(el, next);
        };
      }

      case 'insert': {
        const template = document.createElement('template');
        template.innerHTML = String(change.value).trim();
        const inserted = Array.from(template.content.childNodes);
        if (inserted.length === 0) throw new Error('insert change has no content');

        const parent = el.parentNode;
        const next = el.nextSibling;
        let replaced = false;

        switch (change.position) {
          case 'before':
            parent?.insertBefore(template.content, el);
            break;
          case 'after':
            parent?.insertBefore(template.content, next);
            break;
          case 'replace':
            parent?.insertBefore(template.content, el);
            el.remove();
            replaced = true;
            break;
          case 'prepend':
            el.insertBefore(template.content, el.firstChild);
            break;
          case 'append':
          default:
            el.appendChild(template.content);
            break;
        }

        return () => {
          inserted.forEach((node) => node.parentNode?.removeChild(node));
          if (replaced && parent) parent.insertBefore(el, next);
        };
      }

      default:
        throw new Error(`Unknown action: ${change.action}`);
    }
  }

  private safeRevert(revert: () => void): void {
    try {
      revert();
    } catch (error) {
      console.error('[ChangeManager] Revert step failed:', error);
    }
  }

  private push(entry: HistoryEntry): void {
    this.entries.push(entry);
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    this.notify();
  }
}

// Singleton instance
export const changeManager = new ChangeManager();
