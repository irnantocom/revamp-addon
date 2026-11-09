import type { AIMessage } from '../ai/provider-interface';
import type { Operation, OperationsResponse } from '../types/operations';
import { parseOperationsResponse } from './operation-parser';

export interface ReplyInfo {
  truncated?: boolean;
  finishReason?: string;
  usage?: { completionTokens?: number; reasoningTokens?: number };
}

export interface AskResult {
  success: boolean;
  error?: string;
  data?: ReplyInfo & { content?: string };
}

export type Ask = (messages: AIMessage[], maxTokens: number) => Promise<AskResult>;

/** Calls after the first: one retry with a bigger budget, then up to this many continuations */
export const MAX_CONTINUATIONS = 2;
/** Ceiling for the bigger retry; a model with a lower limit answers with it and the provider adapts */
export const RETRY_TOKEN_CEILING = 32768;

const continuePrompt = (lastId: string, count: number): string =>
  `Your previous reply was cut off by the output limit after ${count} operations (the last complete one is "${lastId}"). Reply with ONLY the remaining operations, in the same JSON format: continue the numbering, do not repeat any operation already given, and cover the sections and elements you have not handled yet, including hiding the sections that have no matching content. Keep each "explanation" to 3 words or fewer.`;

const sameChange = (op: Operation): string => JSON.stringify({ ...op, id: '', explanation: '' });

/** `next` follows `first`: ids stay unique and an operation the model repeated is dropped */
export function mergeOperations(first: OperationsResponse, next: OperationsResponse, round: number): OperationsResponse {
  const ids = new Set(first.operations.map((op) => op.id));
  const given = new Set(first.operations.map(sameChange));
  const added: Operation[] = [];

  for (const op of next.operations) {
    if (given.has(sameChange(op))) continue;
    let id = op.id;
    while (ids.has(id)) id = `${id}-c${round}`;
    ids.add(id);
    added.push({ ...op, id });
  }

  return {
    explanation: first.explanation,
    operations: [...first.operations, ...added],
    warnings: [...first.warnings, ...next.warnings.filter((w) => !first.warnings.includes(w))],
  };
}

export const serializeOperations = (response: OperationsResponse): string =>
  `\`\`\`json\n${JSON.stringify({ explanation: response.explanation, operations: response.operations, warnings: response.warnings })}\n\`\`\``;

/**
 * Finish a reply that stopped at the output limit. A reasoning model can spend the whole budget before
 * it writes anything: that gets one retry with a bigger budget. A reply that stopped part-way keeps its
 * complete operations and asks the model for the rest. `truncated` stays true when it is still not whole.
 */
export async function completeReply(
  ask: Ask,
  messages: AIMessage[],
  maxTokens: number,
  first: { content: string; truncated: boolean; info?: ReplyInfo }
): Promise<{ content: string; truncated: boolean; extraRequests: number; last: ReplyInfo | undefined }> {
  let { content, truncated } = first;
  let last: ReplyInfo | undefined = first.info;
  let extraRequests = 0;
  let budget = maxTokens;

  if (truncated && !parseOperationsResponse(content)) {
    const bigger = Math.min(budget * 2, RETRY_TOKEN_CEILING);
    if (bigger > budget) {
      const again = await ask(messages, bigger);
      extraRequests++;
      if (again.success && again.data) {
        content = again.data.content ?? '';
        truncated = !!again.data.truncated;
        last = again.data;
        budget = bigger;
      }
    }
  }

  let merged = parseOperationsResponse(content);
  let merges = 0;
  while (truncated && merged && merges < MAX_CONTINUATIONS) {
    const lastOp = merged.operations[merged.operations.length - 1];
    const history: AIMessage[] = [
      ...messages,
      { role: 'assistant', content: merges === 0 ? content : serializeOperations(merged) },
      { role: 'user', content: continuePrompt(lastOp.id, merged.operations.length) },
    ];
    const next = await ask(history, budget);
    extraRequests++;
    if (!next.success || !next.data) break;

    const more = parseOperationsResponse(next.data.content ?? '');
    truncated = !!next.data.truncated;
    last = next.data;
    if (!more) break;
    merged = mergeOperations(merged, more, ++merges);
  }

  return { content: merges > 0 && merged ? serializeOperations(merged) : content, truncated, extraRequests, last };
}

const FILTERED = /content_filter|safety|recitation|blocked|prohibited/i;

/** Why a reply came back empty, in words that say what to do next */
export function describeEmptyReply(reply: ReplyInfo | undefined): string {
  const reasoning = reply?.usage?.reasoningTokens;
  const total = reply?.usage?.completionTokens;

  if (reply?.truncated) {
    const spent = reasoning && total ? ` (${reasoning} of ${total} output tokens went to reasoning)` : '';
    return `The AI used its whole output limit without writing a reply${spent}. This happens with reasoning models on long pages. Select one section and repeat, shorten the document, or pick a model that does not reason.`;
  }
  if (reply?.finishReason && FILTERED.test(reply.finishReason)) {
    return `The provider's content filter blocked the reply (${reply.finishReason}). Rephrase the request or change the document.`;
  }
  return `The AI returned an empty reply${reply?.finishReason ? ` (finish reason: ${reply.finishReason})` : ''}. Try again, or pick another model.`;
}
