import type { AIMessage } from '../ai/provider-interface';
import type { OperationsResponse } from '../types/operations';
import { parseOperationsResponse } from './operation-parser';
import { mergeOperations, serializeOperations, type Ask } from './reply-continuation';

export interface OperationProblem {
  operationId: string;
  error: string;
}

const repairPrompt = (blocked: Array<{ id: string; op: string; target: number; error: string }>): string =>
  `These operations were refused because they would break the page's layout:\n${blocked
    .map((b) => `- ${b.id} (${b.op} on [${b.target}]): ${b.error}`)
    .join('\n')}\n\nRedo only these, in a way that keeps the template: set_text on each existing heading, paragraph, label and button listed under that element in the PAGE INDEX (use an empty string to clear one you do not need), replace_image for images, set_visibility to hide items with no content. For a layout that is missing, duplicate an element or section that has it and change the copy: operations on a copy carry "in":"<id of the duplicate operation>" and the original element's number as "target", and move places the copy. A table goes into an element with no children as an inline-styled HTML table with set_html. Do not use set_html on an element that has children. Reply with ONLY the replacement operations, in the same JSON format, keeping each "explanation" to 3 words or fewer.`;

/**
 * Ask the model once to redo the operations the page refused, then swap them for its answer. An
 * operation that is refused again stays in the list: applying it fails with the reason and the page is
 * left as it was. `repaired` is false when nothing changed.
 */
export async function repairOperations(
  ask: Ask,
  messages: AIMessage[],
  maxTokens: number,
  content: string,
  response: OperationsResponse,
  problems: OperationProblem[]
): Promise<{ response: OperationsResponse; content: string; repaired: boolean }> {
  const refused = new Set(problems.map((p) => p.operationId));
  const blocked = response.operations
    .filter((op) => refused.has(op.id))
    .map((op) => ({ id: op.id, op: op.op, target: op.target, error: problems.find((p) => p.operationId === op.id)!.error }));
  if (blocked.length === 0) return { response, content, repaired: false };

  const reply = await ask(
    [...messages, { role: 'assistant', content }, { role: 'user', content: repairPrompt(blocked) }],
    maxTokens
  );
  const redone = reply.success && reply.data ? parseOperationsResponse(reply.data.content ?? '') : null;
  if (!redone) return { response, content, repaired: false };

  const kept: OperationsResponse = { ...response, operations: response.operations.filter((op) => !refused.has(op.id)) };
  const merged = mergeOperations(kept, redone, 1);
  return { response: merged, content: serializeOperations(merged), repaired: true };
}
