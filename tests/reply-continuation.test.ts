import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeReply, describeEmptyReply, mergeOperations, MAX_CONTINUATIONS, RETRY_TOKEN_CEILING, type Ask } from '../src/utils/reply-continuation';
import { parseOperationsResponse } from '../src/utils/operation-parser';

const op = (n: number, text = `T${n}`) => ({ id: `op-${n}`, op: 'set_text', target: n, text, explanation: 'e' });
const json = (ops: unknown[]) => '```json\n' + JSON.stringify({ explanation: 'x', operations: ops, warnings: [] }) + '\n```';
/** What a reply cut off in the middle of its third operation looks like */
const cut = (ops: unknown[]) => json(ops).replace(/\n```$/, '').replace(/\}\]/, '}, {"id":"op-9","op":"set_te');
const reply = (content: string, truncated = false) => ({ success: true, data: { content, truncated } });
const msgs = [{ role: 'user' as const, content: 'go' }];

// The parser logs every cut-off reply it has to repair
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('completeReply', () => {
  it('returns a whole reply untouched', async () => {
    const ask = vi.fn();

    const done = await completeReply(ask, msgs, 8192, { content: json([op(1)]), truncated: false });

    expect(done).toEqual({ content: json([op(1)]), truncated: false, extraRequests: 0 });
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks again with a bigger budget when the model wrote nothing usable', async () => {
    const ask = vi.fn<Parameters<Ask>, ReturnType<Ask>>().mockResolvedValue(reply(json([op(1), op(2)])));

    const done = await completeReply(ask, msgs, 8192, { content: '', truncated: true });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]).toEqual([msgs, 16384]);
    expect(done).toMatchObject({ content: json([op(1), op(2)]), truncated: false, extraRequests: 1 });
  });

  it('never asks for more than the ceiling', async () => {
    const ask = vi.fn().mockResolvedValue(reply(''));

    await completeReply(ask, msgs, RETRY_TOKEN_CEILING, { content: '', truncated: true });

    expect(ask).not.toHaveBeenCalled();
  });

  it('keeps the complete operations of a cut reply and asks for the rest', async () => {
    const ask = vi.fn<Parameters<Ask>, ReturnType<Ask>>().mockResolvedValue(reply(json([op(3), op(4)])));

    const done = await completeReply(ask, msgs, 8192, { content: cut([op(1), op(2)]), truncated: true });

    const [history] = ask.mock.calls[0];
    expect(history.slice(0, 1)).toEqual(msgs);
    expect(history[1].role).toBe('assistant');
    expect(history[2]).toMatchObject({ role: 'user', content: expect.stringContaining('after 2 operations (the last complete one is "op-2")') });
    expect(done.truncated).toBe(false);
    expect(done.extraRequests).toBe(1);
    expect(parseOperationsResponse(done.content)!.operations.map((o) => o.id)).toEqual(['op-1', 'op-2', 'op-3', 'op-4']);
  });

  it('stops after the allowed continuations and reports the reply as still cut off', async () => {
    let n = 2;
    const ask = vi.fn(async () => reply(cut([op(++n), op(++n)]), true));

    const done = await completeReply(ask, msgs, 8192, { content: cut([op(1), op(2)]), truncated: true });

    expect(ask).toHaveBeenCalledTimes(MAX_CONTINUATIONS);
    expect(done.truncated).toBe(true);
    expect(parseOperationsResponse(done.content)!.operations).toHaveLength(2 + 2 * MAX_CONTINUATIONS);
  });

  it('keeps what it has when a follow-up request fails', async () => {
    const ask = vi.fn().mockResolvedValue({ success: false, error: 'boom' });
    const first = cut([op(1), op(2)]);

    const done = await completeReply(ask, msgs, 8192, { content: first, truncated: true });

    expect(done).toEqual({ content: first, truncated: true, extraRequests: 1 });
  });
});

describe('mergeOperations', () => {
  const response = (...ops: ReturnType<typeof op>[]) => parseOperationsResponse(json(ops))!;

  it('renames an id the follow-up reused and drops a repeated change', () => {
    const merged = mergeOperations(response(op(1), op(2)), response(op(2), { ...op(1, 'other'), id: 'op-1' }, op(5)), 1);

    expect(merged.operations.map((o) => o.id)).toEqual(['op-1', 'op-2', 'op-1-c1', 'op-5']);
    expect((merged.operations[2] as any).text).toBe('other');
  });
});

describe('describeEmptyReply', () => {
  it('blames the output limit, and the reasoning tokens when the provider reports them', () => {
    const text = describeEmptyReply({ truncated: true, usage: { completionTokens: 8192, reasoningTokens: 8192 } });

    expect(text).toContain('whole output limit');
    expect(text).toContain('8192 of 8192 output tokens went to reasoning');
    expect(text).toContain('Select one section');
  });

  it('does not invent reasoning numbers the provider did not give', () => {
    expect(describeEmptyReply({ truncated: true })).not.toContain('went to reasoning');
  });

  it('names a content filter', () => {
    expect(describeEmptyReply({ finishReason: 'content_filter' })).toContain('content filter blocked the reply (content_filter)');
  });

  it('otherwise reports an empty reply with the finish reason when there is one', () => {
    expect(describeEmptyReply({ finishReason: 'stop' })).toBe('The AI returned an empty reply (finish reason: stop). Try again, or pick another model.');
    expect(describeEmptyReply(undefined)).toBe('The AI returned an empty reply. Try again, or pick another model.');
  });

  it('is what completeReply hands back for a reply that stays empty', async () => {
    const info = { truncated: true, finishReason: 'length', usage: { completionTokens: 16384, reasoningTokens: 16384 } };
    const ask = vi.fn().mockResolvedValue({ success: true, data: { content: '', ...info } });

    const done = await completeReply(ask, msgs, 8192, { content: '', truncated: true });

    expect(done.last).toMatchObject(info);
    expect(describeEmptyReply({ ...done.last, truncated: done.truncated })).toContain('16384 of 16384');
  });
});
