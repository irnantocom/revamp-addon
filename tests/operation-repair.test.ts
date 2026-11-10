import { beforeEach, describe, expect, it, vi } from 'vitest';
import { repairOperations } from '../src/utils/operation-repair';
import { parseOperationsResponse } from '../src/utils/operation-parser';

const html = { id: 'op-2', op: 'set_html', target: 30, html: '<p>x</p>', explanation: 'e' };
const text = (n: number) => ({ id: `op-${n}`, op: 'set_text', target: n, text: `T${n}`, explanation: 'e' });
const json = (ops: unknown[]) => '```json\n' + JSON.stringify({ explanation: 'x', operations: ops, warnings: [] }) + '\n```';
const msgs = [{ role: 'user' as const, content: 'go' }];
const problem = { operationId: 'op-2', error: 'would break the layout' };

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('repairOperations', () => {
  const original = json([text(1), html, text(3)]);
  const response = parseOperationsResponse(original)!;

  it('swaps the refused operations for the ones the model redoes', async () => {
    const ask = vi.fn().mockResolvedValue({ success: true, data: { content: json([text(40), text(41)]) } });

    const done = await repairOperations(ask, msgs, 8192, original, response, [problem]);

    expect(done.repaired).toBe(true);
    expect(done.response.operations.map((o) => o.id)).toEqual(['op-1', 'op-3', 'op-40', 'op-41']);
    expect(parseOperationsResponse(done.content)!.operations).toHaveLength(4);
    const [history] = ask.mock.calls[0];
    expect(history[history.length - 1].content).toContain('op-2 (set_html on [30]): would break the layout');
    expect(history[history.length - 1].content).toContain('Do not use set_html on an element that has children');
    expect(history[history.length - 1].content).toContain('"in":"<id of the duplicate operation>"');
    expect(history[history.length - 1].content).toContain('inline-styled HTML table');
  });

  it('keeps everything when the model cannot help', async () => {
    for (const reply of [{ success: false, error: 'boom' }, { success: true, data: { content: 'sorry' } }]) {
      const ask = vi.fn().mockResolvedValue(reply);

      const done = await repairOperations(ask, msgs, 8192, original, response, [problem]);

      expect(done).toEqual({ response, content: original, repaired: false });
    }
  });

  it('does not ask when no operation of the response was refused', async () => {
    const ask = vi.fn();

    const done = await repairOperations(ask, msgs, 8192, original, response, [{ operationId: 'zzz', error: 'e' }]);

    expect(done.repaired).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });
});
