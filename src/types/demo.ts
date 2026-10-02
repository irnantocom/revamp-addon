import { Locator } from '../utils/locator';
import { Operation, OperationType } from './operations';

/** An operation in storable form: element ids replaced by locators */
export interface PersistedOperation {
  id: string;
  op: OperationType;
  explanation: string;
  target: Locator;
  /** Only for "move" */
  ref?: Locator;
  /** Remaining operation fields (text, styles, src, ...) */
  args: Record<string, unknown>;
}

/** A note pinned to an element, e.g. "Replace this image with the campaign image" */
export interface Annotation {
  id: string;
  target: Locator;
  text: string;
  resolved: boolean;
  createdAt: number;
}

/** Annotation as shown in the UI, with its current element (if it can be found) */
export interface AnnotationInfo {
  id: string;
  number: number;
  text: string;
  resolved: boolean;
  createdAt: number;
  /** Revamp id of the element, so the note can be turned into an AI request */
  elementId?: number;
  /** Short description such as: h1 "Welcome" */
  elementLabel: string;
  found: boolean;
}

export interface DemoConfig {
  kind: 'revamp-demo';
  version: 1;
  name: string;
  /** origin + pathname the demo was made for */
  pageKey: string;
  url: string;
  savedAt: number;
  /** Whether the demo is switched on for this page */
  enabled: boolean;
  operations: PersistedOperation[];
  /** Notes pinned to elements (optional so older files still import) */
  annotations?: Annotation[];
}

export interface HistoryItem {
  key: string;
  op: OperationType | 'custom';
  label: string;
  explanation: string;
  /** applied = live on the page; pending = could not be located yet */
  status: 'applied' | 'pending';
}

export interface SectionInfo {
  id: number;
  label: string;
  tag: string;
  hidden: boolean;
  /** True if another section shares this parent, so it can be moved up/down */
  canMoveUp: boolean;
  canMoveDown: boolean;
  previousId?: number;
  nextId?: number;
}

export type { Operation };
