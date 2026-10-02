// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildHandoffReport } from '../src/utils/handoff-report';
import { DemoConfig } from '../src/types/demo';

const config: DemoConfig = {
  kind: 'revamp-demo', version: 1, name: 'Client <A> & Co', pageKey: 'https://x.test/', url: 'https://x.test/',
  savedAt: 1, enabled: true,
  operations: [
    { id: '1', op: 'set_text', explanation: 'New <b>hero</b>', target: { selector: '#hero > h1', tag: 'h1', text: 'Welcome', ord: 0 }, args: { text: 'Sail' } },
  ],
};
const notes = [
  { id: 'a', number: 1, text: 'Swap <img> now', resolved: false, createdAt: 1, elementLabel: 'img', found: true },
  { id: 'b', number: 2, text: 'Done thing', resolved: true, createdAt: 1, elementLabel: 'p', found: true },
];

describe('buildHandoffReport', () => {
  const { markdown, html } = buildHandoffReport({ config, notes, beforeImage: 'before.png', afterImage: 'after.png', generatedAt: new Date('2026-10-02T00:00:00Z') });

  it('lists changes, element hints and notes in Markdown', () => {
    expect(markdown).toContain('# Client \\<A\\> & Co');
    expect(markdown).toContain('1. Text of <h1> "Welcome" → "Sail"'.replace(/[<>]/g, (c) => `\\${c}`));
    expect(markdown).toContain('`#hero > h1`');
    expect(markdown).toContain('- [ ] Swap \\<img\\> now');
    expect(markdown).toContain('- [x] Done thing');
    expect(markdown).toContain('![Before](before.png)');
    expect(markdown).toContain('**Open notes:** 1');
  });

  it('escapes user text in HTML', () => {
    expect(html).not.toContain('<A>');
    expect(html).not.toContain('<b>hero</b>');
    expect(html).toContain('Client &lt;A&gt; &amp; Co');
    expect(html).toContain('Swap &lt;img&gt; now');
    expect(html).toContain('src="before.png"');
  });

  it('omits the screenshot section without images and handles empty demos', () => {
    const empty = buildHandoffReport({ config: { ...config, operations: [], name: '' }, notes: [] });
    expect(empty.markdown).not.toContain('Before / after');
    expect(empty.markdown).toContain('_No changes._');
    expect(empty.html).toContain('<title>Revamp demo</title>');
  });
});
