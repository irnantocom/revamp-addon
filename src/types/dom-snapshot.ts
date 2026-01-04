/**
 * DOM Snapshot types for capturing element subtree context
 */

export interface ElementAttribute {
  name: string;
  value: string;
}

export interface ChildSummary {
  tag: string;
  selector: string;
  id?: string;
  classes: string[];
  attributes: ElementAttribute[];
  textContent?: string;
  src?: string;
  href?: string;
  isVisible: boolean;
}

export interface SubtreeSnapshot {
  mode: 'element' | 'page';
  rootSelector: string;
  rootTag: string;
  attributes: ElementAttribute[];
  outerHTML: string;
  innerHTML: string;
  textContent: string;
  children: ChildSummary[];
  totalChildCount: number;
  timestamp: number;
  allImages?: ChildSummary[]; // All img tags found recursively
}
