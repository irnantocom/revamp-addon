// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decodeShareCode, encodeShareCode } from '../src/utils/share-code';
import { describeOperation, diffDemos } from '../src/utils/demo-versions';
import { DemoConfig, PersistedOperation } from '../src/types/demo';

const loc = (tag: string, text: string, selector = tag, ord = 0) => ({ tag, text, selector, ord });

const textOp = (id: string, text: string, newText: string): PersistedOperation => ({
  id, op: 'set_text', explanation: '', target: loc('h1', text), args: { text: newText },
});

const config = (operations: PersistedOperation[]): DemoConfig => ({
  kind: 'revamp-demo', version: 1, name: 'Client A', pageKey: 'https://x.test/', url: 'https://x.test/',
  savedAt: 1, enabled: true, operations,
});

describe('share code', () => {
  it('round-trips a demo, including unicode', async () => {
    const original = config([textOp('a', 'Welcome', 'Selamat datang – 你好 🚢')]);
    const code = await encodeShareCode(original);
    expect(code.startsWith('revamp1:')).toBe(true);
    expect(code).not.toMatch(/[+/=\s]/);
    expect(await decodeShareCode(`  ${code}\n`)).toEqual(original);
  });

  it('rejects foreign or damaged codes', async () => {
    await expect(decodeShareCode('hello')).rejects.toThrow(/Not a Revamp share code/);
    await expect(decodeShareCode('revamp1:AAAA')).rejects.toThrow(/damaged/);
  });
});

describe('diffDemos', () => {
  it('reports added, removed, changed and unchanged operations', () => {
    const v1 = config([
      textOp('1', 'Welcome', 'Hello'),
      { id: '2', op: 'set_visibility', explanation: '', target: loc('section', 'About'), args: { visible: false } },
      textOp('3', 'Footer', 'Bye'),
    ]);
    const v2 = config([
      textOp('1', 'Welcome', 'Sail Beyond'), // changed
      { id: '2', op: 'set_visibility', explanation: '', target: loc('section', 'About'), args: { visible: false } }, // same
      { id: '4', op: 'remove', explanation: '', target: loc('div', 'Promo'), args: {} }, // added; footer text removed
    ]);

    const diff = diffDemos(v1, v2);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].after.args).toEqual({ text: 'Sail Beyond' });
    expect(diff.added.map((o) => o.op)).toEqual(['remove']);
    expect(diff.removed.map((o) => o.target.text)).toEqual(['Footer']);
    expect(diff.unchanged).toBe(1);
  });

  it('uses the last operation per target', () => {
    const a = config([textOp('1', 'Welcome', 'One'), textOp('2', 'Welcome', 'Two')]);
    const b = config([textOp('9', 'Welcome', 'Two')]);
    const diff = diffDemos(a, b);
    expect(diff.unchanged).toBe(1);
    expect(diff.changed).toHaveLength(0);
  });
});

describe('describeOperation', () => {
  it('produces readable text', () => {
    expect(describeOperation(textOp('1', 'Welcome', 'Hi'))).toBe('Text of <h1> "Welcome" → "Hi"');
    expect(describeOperation({ id: 'x', op: 'set_visibility', explanation: '', target: loc('section', 'About'), args: { visible: false } }))
      .toBe('Hide <section> "About"');
  });
});
