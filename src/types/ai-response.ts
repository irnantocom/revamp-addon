/**
 * Structured AI Response Types untuk Revamp Site
 */

export interface AIChange {
  id: string;
  action: 'css' | 'html' | 'text' | 'attribute' | 'remove' | 'insert';
  selector: string;
  value: any;
  attribute?: string;
  position?: 'before' | 'after' | 'replace' | 'prepend' | 'append';
  explanation: string;
  preview?: {
    before: string;
    after: string;
  };
}

export interface AIRevampResponse {
  success: boolean;
  explanation: string;
  changes: AIChange[];
  warnings?: string[];
  estimatedImpact: 'low' | 'medium' | 'high';
}

export interface ChangeResult {
  changeId: string;
  success: boolean;
  elementsAffected: number;
  error?: string;
}
