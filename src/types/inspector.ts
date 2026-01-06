/**
 * Inspector & Element Editor Shared Types
 * Centralized type definitions to avoid duplication
 */

import { SelectorInfo } from '../utils/selector-generator';

/**
 * Inspected element information
 * Used across content script, App, and ElementEditor
 */
export interface InspectedElement {
  selector: SelectorInfo;
  tagName: string;
  attributes: Record<string, string>;
  textContent: string;
  innerHTML: string;
  rect: DOMRect;
}

/**
 * Edit operation for history tracking
 */
export interface EditOperation {
  selector: SelectorInfo;
  type: 'text' | 'html' | 'attribute' | 'style';
  value: any;
  originalValue?: any;
}

/**
 * Apply change payload for AI-generated changes
 */
export interface ApplyChangePayload {
  action: 'text' | 'css' | 'html' | 'attribute' | 'script';
  selector: SelectorInfo;
  value: any;
  attribute?: string;
}

/**
 * Message response structure
 */
export interface MessageResponse {
  success: boolean;
  data?: any;
  error?: string;
}
