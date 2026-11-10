import { AIResponseParser } from './ai-response-parser';
import { Operation, OperationsResponse } from '../types/operations';

const POSITIONS = ['before', 'after', 'first', 'last'];

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isStr = (v: unknown): v is string => typeof v === 'string';

/**
 * Validate one raw operation. Returns the typed operation or a reason it was rejected.
 */
export function validateOperation(raw: any, index: number): Operation | string {
  if (!raw || typeof raw !== 'object') return 'not an object';

  const target = typeof raw.target === 'string' ? Number(raw.target.replace(/\D/g, '')) : raw.target;
  if (!isId(target)) return 'missing or invalid "target" id';

  const base = {
    id: isStr(raw.id) && raw.id ? raw.id : `op-${index + 1}`,
    target,
    explanation: isStr(raw.explanation) && raw.explanation ? raw.explanation : '',
    ...(isStr(raw.in) && raw.in ? { in: raw.in } : {}),
  };

  switch (raw.op) {
    case 'set_text':
      return isStr(raw.text) ? { ...base, op: 'set_text', text: raw.text } : 'set_text needs "text"';
    case 'set_html':
      return isStr(raw.html) ? { ...base, op: 'set_html', html: raw.html } : 'set_html needs "html"';
    case 'set_attr':
      return isStr(raw.name) && isStr(raw.value)
        ? { ...base, op: 'set_attr', name: raw.name, value: raw.value }
        : 'set_attr needs "name" and "value"';
    case 'set_link':
      return isStr(raw.href) ? { ...base, op: 'set_link', href: raw.href } : 'set_link needs "href"';
    case 'replace_image':
      return isStr(raw.src)
        ? { ...base, op: 'replace_image', src: raw.src, alt: isStr(raw.alt) ? raw.alt : undefined }
        : 'replace_image needs "src"';
    case 'set_style': {
      if (!raw.styles || typeof raw.styles !== 'object' || Array.isArray(raw.styles)) return 'set_style needs "styles" object';
      const styles: Record<string, string> = {};
      Object.entries(raw.styles).forEach(([k, v]) => {
        if (isStr(v) || typeof v === 'number') styles[k] = String(v);
      });
      return Object.keys(styles).length ? { ...base, op: 'set_style', styles } : 'set_style has no valid styles';
    }
    case 'set_visibility':
      return typeof raw.visible === 'boolean'
        ? { ...base, op: 'set_visibility', visible: raw.visible }
        : 'set_visibility needs boolean "visible"';
    case 'remove':
      return { ...base, op: 'remove' };
    case 'duplicate':
      return { ...base, op: 'duplicate' };
    case 'move': {
      const ref = typeof raw.ref === 'string' ? Number(raw.ref.replace(/\D/g, '')) : raw.ref;
      if (!isId(ref)) return 'move needs "ref" id';
      if (!POSITIONS.includes(raw.position)) return 'move needs position before|after|first|last';
      return { ...base, op: 'move', ref, position: raw.position };
    }
    default:
      return `unknown op "${raw.op}"`;
  }
}

/**
 * Salvage complete operation objects from truncated or malformed JSON by
 * scanning the "operations" array for balanced top-level objects.
 */
function recoverOperations(jsonText: string): any | null {
  const key = jsonText.indexOf('"operations"');
  if (key === -1) return null;
  const arrayStart = jsonText.indexOf('[', key);
  if (arrayStart === -1) return null;

  const operations: any[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objStart = -1;

  for (let i = arrayStart + 1; i < jsonText.length; i++) {
    const c = jsonText[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          operations.push(JSON.parse(jsonText.slice(objStart, i + 1)));
        } catch {
          // skip unparseable object
        }
        objStart = -1;
      } else if (depth < 0) break;
    } else if (c === ']' && depth === 0) break;
  }

  const explanation = jsonText.match(/"explanation"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  return { explanation: explanation ? explanation[1] : undefined, operations };
}

/**
 * Parse an AI response in the operations format.
 * Returns null when no "operations" array is present at all.
 */
export function parseOperationsResponse(rawResponse: string): OperationsResponse | null {
  const jsonText = AIResponseParser.extractJsonText(rawResponse);
  if (!jsonText) return null;

  let parsed: any;
  try {
    parsed = AIResponseParser.parseLooseJson(jsonText).parsed;
    // The generic recovery can "succeed" while dropping operations; prefer the salvage in that case
    if (!parsed || !Array.isArray(parsed.operations)) parsed = recoverOperations(jsonText);
  } catch {
    parsed = recoverOperations(jsonText);
  }

  if (!parsed || !Array.isArray(parsed.operations)) return null;

  const warnings: string[] = Array.isArray(parsed.warnings) ? parsed.warnings.filter(isStr) : [];
  const operations: Operation[] = [];
  const seen = new Set<string>();

  parsed.operations.forEach((raw: any, i: number) => {
    const result = validateOperation(raw, i);
    if (typeof result === 'string') {
      warnings.push(`Operation ${i + 1} skipped: ${result}`);
      return;
    }
    // Keep ids unique so UI selection works
    while (seen.has(result.id)) result.id = `${result.id}-${i + 1}`;
    seen.add(result.id);
    operations.push(result);
  });

  if (operations.length === 0) return null;

  return {
    explanation: isStr(parsed.explanation) ? parsed.explanation : 'AI suggested the following changes',
    operations,
    warnings,
  };
}
