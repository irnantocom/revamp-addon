/**
 * Structured operations the AI may request.
 * The AI never writes selectors or code: it picks a Revamp ID from the page index
 * and one of a fixed set of operations.
 */

interface BaseOperation {
  /** Unique within one AI response */
  id: string;
  /** Revamp ID of the target element, as listed in the page index */
  target: number;
  /**
   * Id of an earlier `duplicate` operation in the same reply. `target` then names the ORIGINAL element and
   * the operation acts on its counterpart inside that copy, because the copy has no id of its own yet.
   */
  in?: string;
  /** Short human-readable reason shown in the UI */
  explanation: string;
}

export interface SetTextOperation extends BaseOperation {
  op: 'set_text';
  text: string;
}

export interface SetAttrOperation extends BaseOperation {
  op: 'set_attr';
  name: string;
  value: string;
}

export interface SetStyleOperation extends BaseOperation {
  op: 'set_style';
  styles: Record<string, string>;
}

export interface SetVisibilityOperation extends BaseOperation {
  op: 'set_visibility';
  visible: boolean;
}

export interface SetHtmlOperation extends BaseOperation {
  op: 'set_html';
  html: string;
}

export interface RemoveOperation extends BaseOperation {
  op: 'remove';
}

export interface MoveOperation extends BaseOperation {
  op: 'move';
  /** Revamp ID of the element to position relative to */
  ref: number;
  /** before/after: sibling of ref. first/last: first/last child of ref */
  position: 'before' | 'after' | 'first' | 'last';
}

export interface DuplicateOperation extends BaseOperation {
  op: 'duplicate';
}

export interface ReplaceImageOperation extends BaseOperation {
  op: 'replace_image';
  src: string;
  alt?: string;
}

export interface SetLinkOperation extends BaseOperation {
  op: 'set_link';
  href: string;
}

export type Operation =
  | SetTextOperation
  | SetAttrOperation
  | SetStyleOperation
  | SetVisibilityOperation
  | SetHtmlOperation
  | RemoveOperation
  | MoveOperation
  | DuplicateOperation
  | ReplaceImageOperation
  | SetLinkOperation;

export type OperationType = Operation['op'];

export interface OperationsResponse {
  explanation: string;
  operations: Operation[];
  warnings: string[];
}

export interface OperationResult {
  operationId: string;
  success: boolean;
  error?: string;
}
