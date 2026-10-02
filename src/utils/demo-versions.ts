import { DemoConfig, PersistedOperation } from '../types/demo';

export interface DemoVersion {
  id: string;
  label: string;
  savedAt: number;
  config: DemoConfig;
}

export interface VersionDiff {
  added: PersistedOperation[];
  removed: PersistedOperation[];
  changed: Array<{ before: PersistedOperation; after: PersistedOperation }>;
  unchanged: number;
}

const clip = (text: string, max = 40) => (text.length > max ? text.slice(0, max) + '…' : text);

/** Identity of the thing an operation acts on, independent of its new values */
const operationKey = (p: PersistedOperation): string =>
  [p.op, p.target.tag, p.target.selector, p.target.text, p.target.ord, p.ref?.selector ?? '', p.ref?.text ?? ''].join('|');

const valueKey = (p: PersistedOperation): string => JSON.stringify(p.args);

/** One-line, human-readable description of an operation */
export function describeOperation(p: PersistedOperation): string {
  const what = p.target.text ? `<${p.target.tag}> "${clip(p.target.text)}"` : `<${p.target.tag}>`;
  const a = p.args as Record<string, unknown>;

  switch (p.op) {
    case 'set_text': return `Text of ${what} → "${clip(String(a.text ?? ''))}"`;
    case 'set_html': return `Content of ${what} replaced`;
    case 'set_attr': return `${what}: ${String(a.name)} = "${clip(String(a.value ?? ''))}"`;
    case 'set_link': return `Link of ${what} → ${clip(String(a.href ?? ''))}`;
    case 'replace_image': return `Image ${what} → ${clip(String(a.src ?? ''))}`;
    case 'set_style': return `Style of ${what}: ${clip(Object.entries(a.styles as Record<string, string> ?? {}).map(([k, v]) => `${k}: ${v}`).join('; '), 60)}`;
    case 'set_visibility': return `${a.visible ? 'Show' : 'Hide'} ${what}`;
    case 'move': return `Move ${what} ${String(a.position)} "${clip(p.ref?.text || p.ref?.tag || '')}"`;
    case 'duplicate': return `Duplicate ${what}`;
    case 'remove': return `Remove ${what}`;
    default: return `${p.op} ${what}`;
  }
}

/**
 * Compare two demos. Operations are matched by what they act on; for each target
 * the last operation wins, mirroring what the page ends up showing.
 */
export function diffDemos(a: DemoConfig, b: DemoConfig): VersionDiff {
  const index = (config: DemoConfig) => {
    const map = new Map<string, PersistedOperation>();
    config.operations.forEach((p) => map.set(operationKey(p), p));
    return map;
  };
  const before = index(a);
  const after = index(b);

  const diff: VersionDiff = { added: [], removed: [], changed: [], unchanged: 0 };

  after.forEach((op, key) => {
    const previous = before.get(key);
    if (!previous) diff.added.push(op);
    else if (valueKey(previous) !== valueKey(op)) diff.changed.push({ before: previous, after: op });
    else diff.unchanged++;
  });
  before.forEach((op, key) => {
    if (!after.has(key)) diff.removed.push(op);
  });

  return diff;
}
