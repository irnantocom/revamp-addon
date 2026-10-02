import { AIChange } from '../types/ai-response';
import { Operation } from '../types/operations';
import { PageIndex } from './page-index';
import { SelectorGenerator } from './selector-generator';

/**
 * Convert a selector-based change into per-element operations.
 * Returns null for actions with no operation equivalent ("insert"), or an error.
 */
export function legacyChangeToOperations(
  change: AIChange,
  index: PageIndex
): { operations: Operation[] } | { error: string } | null {
  if (change.action === 'insert') return null;

  const { elements, error } = SelectorGenerator.query(change.selector);
  if (error) return { error };
  if (elements.length === 0) return { error: `No elements found for selector: ${change.selector}` };

  const operations: Operation[] = [];
  const base = { explanation: change.explanation || '' };

  elements.forEach((el, i) => {
    const id = elements.length === 1 ? change.id : `${change.id}.${i + 1}`;
    const target = index.idOf(el);

    switch (change.action) {
      case 'text':
        operations.push({ ...base, id, op: 'set_text', target, text: String(change.value ?? '') });
        break;
      case 'html':
        operations.push({ ...base, id, op: 'set_html', target, html: String(change.value ?? '') });
        break;
      case 'css':
        if (change.value && typeof change.value === 'object') {
          const styles: Record<string, string> = {};
          Object.entries(change.value).forEach(([k, v]) => (styles[k] = String(v)));
          operations.push({ ...base, id, op: 'set_style', target, styles });
        }
        break;
      case 'attribute':
        if (change.attribute) {
          operations.push({ ...base, id, op: 'set_attr', target, name: change.attribute, value: String(change.value ?? '') });
        }
        break;
      case 'remove':
        operations.push({ ...base, id, op: 'remove', target });
        break;
    }
  });

  if (operations.length === 0) {
    return { error: `${change.action} change is missing required fields (value/attribute)` };
  }
  return { operations };
}
