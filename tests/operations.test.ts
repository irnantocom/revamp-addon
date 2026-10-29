import { beforeEach, describe, expect, it } from 'vitest';
import { PageIndex } from '../src/utils/page-index';
import { ChangeManager } from '../src/utils/change-manager';
import { parseOperationsResponse } from '../src/utils/operation-parser';
import { Operation } from '../src/types/operations';

let index: PageIndex;
let manager: ChangeManager;

const idOf = (selector: string) => index.idOf(document.querySelector(selector)!);

beforeEach(() => {
  document.body.innerHTML = `
    <header><h1>Welcome</h1></header>
    <section id="hero"><h2>Hero</h2><p>Hero text</p><img src="/a.jpg" srcset="/a2.jpg 2x" alt="a"><a href="/x">Go</a></section>
    <section id="about"><h2>About</h2><p>About text</p></section>
    <footer><p>Bye</p></footer>`;
  index = new PageIndex();
  manager = new ChangeManager();
});

describe('PageIndex', () => {
  it('lists elements with stable ids', () => {
    const first = index.build(document.body);
    expect(first.text).toContain('h1 "Welcome"');
    expect(first.text).toContain('img alt="a" src="/a.jpg"');
    const heroId = idOf('#hero');
    const second = index.build(document.body);
    expect(second.text).toContain(`[${heroId}] section`);
    expect(first.text).toBe(second.text);
  });

  it('skips hidden elements unless Revamp hid them', () => {
    document.querySelector<HTMLElement>('#about')!.style.display = 'none';
    expect(index.build(document.body).text).not.toContain('About text');

    document.querySelector<HTMLElement>('#about')!.style.display = '';
    const aboutId = idOf('#about');
    manager.applyOperations([{ id: 'h', op: 'set_visibility', target: aboutId, visible: false, explanation: '' }], index);
    const text = index.build(document.body).text;
    expect(text).toContain(`[${aboutId}] section`);
    expect(text).toContain('(HIDDEN)');
    expect(text).not.toContain('About text');
  });

  it('resolve returns null for removed elements', () => {
    const id = idOf('h1');
    document.querySelector('h1')!.remove();
    expect(index.resolve(id)).toBeNull();
  });
});

describe('operations', () => {
  const run = (op: Operation) => manager.applyOperations([op], index)[0];

  it('set_text and undo', () => {
    const id = idOf('h1');
    expect(run({ id: '1', op: 'set_text', target: id, text: 'Sail', explanation: '' }).success).toBe(true);
    expect(document.querySelector('h1')!.textContent).toBe('Sail');
    manager.undo();
    expect(document.querySelector('h1')!.textContent).toBe('Welcome');
  });

  it('hide and show restore original inline display', () => {
    const el = document.querySelector<HTMLElement>('#hero')!;
    el.style.display = 'flex';
    const id = idOf('#hero');
    run({ id: '1', op: 'set_visibility', target: id, visible: false, explanation: '' });
    expect(el.style.display).toBe('none');
    run({ id: '2', op: 'set_visibility', target: id, visible: true, explanation: '' });
    expect(el.style.display).toBe('flex');
    expect(el.hasAttribute('data-revamp-hidden')).toBe(false);
  });

  it('move reorders sections and undo restores order', () => {
    const hero = idOf('#hero');
    const about = idOf('#about');
    run({ id: '1', op: 'move', target: about, ref: hero, position: 'before', explanation: '' });
    const order = () => Array.from(document.querySelectorAll('section')).map((s) => s.id);
    expect(order()).toEqual(['about', 'hero']);
    manager.undo();
    expect(order()).toEqual(['hero', 'about']);
  });

  it('rejects moving an element into itself', () => {
    const hero = idOf('#hero');
    const h2 = index.idOf(document.querySelector('#hero h2')!);
    const result = run({ id: '1', op: 'move', target: hero, ref: h2, position: 'after', explanation: '' });
    expect(result.success).toBe(false);
  });

  it('duplicate strips ids and undo removes the copy', () => {
    run({ id: '1', op: 'duplicate', target: idOf('#hero'), explanation: '' });
    expect(document.querySelectorAll('section')).toHaveLength(3);
    expect(document.querySelectorAll('#hero')).toHaveLength(1);
    manager.undo();
    expect(document.querySelectorAll('section')).toHaveLength(2);
  });

  it('remove and undo put the element back in place', () => {
    run({ id: '1', op: 'remove', target: idOf('#about'), explanation: '' });
    expect(document.querySelector('#about')).toBeNull();
    manager.undo();
    expect(document.querySelector('footer')!.previousElementSibling!.id).toBe('about');
  });

  it('replace_image swaps src, clears srcset, and reverts both', () => {
    const img = document.querySelector('img')!;
    run({ id: '1', op: 'replace_image', target: idOf('img'), src: 'https://x/new.jpg', explanation: '' });
    expect(img.getAttribute('src')).toBe('https://x/new.jpg');
    expect(img.hasAttribute('srcset')).toBe(false);
    manager.undo();
    expect(img.getAttribute('src')).toBe('/a.jpg');
    expect(img.getAttribute('srcset')).toBe('/a2.jpg 2x');
  });

  it('replace_image accepts an uploaded image as a data URL and reverts it', () => {
    const img = document.querySelector('img')!;
    const src = 'data:image/png;base64,QUJD';
    expect(run({ id: '1', op: 'replace_image', target: idOf('img'), src, explanation: '' }).success).toBe(true);
    expect(img.getAttribute('src')).toBe(src);
    manager.undo();
    expect(img.getAttribute('src')).toBe('/a.jpg');
  });

  it('set_style can swap a background image for a data URL and revert it', () => {
    const el = document.querySelector('h1') as HTMLElement;
    el.style.backgroundImage = 'url("https://x/old.jpg")';
    const value = 'linear-gradient(red, blue), url("data:image/png;base64,QUJD")';
    expect(run({ id: '1', op: 'set_style', target: idOf('h1'), styles: { 'background-image': `${value} !important` }, explanation: '' }).success).toBe(true);
    expect(el.style.getPropertyValue('background-image')).toContain('data:image/png;base64,QUJD');
    expect(el.style.getPropertyPriority('background-image')).toBe('important');
    manager.undo();
    expect(el.style.getPropertyValue('background-image')).toContain('old.jpg');
  });

  it('replace_image refuses non-images', () => {
    expect(run({ id: '1', op: 'replace_image', target: idOf('h1'), src: 'x', explanation: '' }).success).toBe(false);
  });

  it('blocks event handlers and javascript: URLs', () => {
    const a = idOf('a');
    expect(run({ id: '1', op: 'set_attr', target: a, name: 'onclick', value: 'alert(1)', explanation: '' }).success).toBe(false);
    expect(run({ id: '2', op: 'set_link', target: a, href: 'javascript:alert(1)', explanation: '' }).success).toBe(false);
    expect(run({ id: '3', op: 'set_link', target: a, href: 'https://ok.test', explanation: '' }).success).toBe(true);
  });

  it('set_html strips scripts and handlers', () => {
    const id = idOf('#about');
    run({ id: '1', op: 'set_html', target: id, html: '<p onclick="x()">hi</p><script>alert(1)</script>', explanation: '' });
    const about = document.querySelector('#about')!;
    expect(about.querySelector('script')).toBeNull();
    expect(about.querySelector('p')!.hasAttribute('onclick')).toBe(false);
  });

  it('fails clearly for unknown or stale ids without affecting other operations', () => {
    const results = manager.applyOperations(
      [
        { id: 'bad', op: 'set_text', target: 9999, text: 'x', explanation: '' },
        { id: 'good', op: 'set_text', target: idOf('h1'), text: 'ok', explanation: '' },
      ],
      index
    );
    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/no longer exists/);
    expect(results[1].success).toBe(true);
  });

  it('set_style reverts only the touched properties', () => {
    const h1 = document.querySelector<HTMLElement>('h1')!;
    h1.style.color = 'red';
    run({ id: '1', op: 'set_style', target: idOf('h1'), styles: { color: 'blue', fontSize: '40px' }, explanation: '' });
    expect(h1.style.color).toBe('blue');
    expect(h1.style.fontSize).toBe('40px');
    manager.undo();
    expect(h1.style.color).toBe('red');
    expect(h1.style.fontSize).toBe('');
  });
});

describe('legacy selector changes', () => {
  it('undo works for remove', async () => {
    await manager.applyChange({ id: 'c', action: 'remove', selector: '#about', value: '', explanation: '' });
    expect(document.querySelector('#about')).toBeNull();
    manager.undo();
    expect(document.querySelector('#about')).not.toBeNull();
  });

  it('reports invalid selectors instead of throwing', async () => {
    const result = await manager.applyChange({ id: 'c', action: 'text', selector: 'div[', value: 'x', explanation: '' });
    expect(result.success).toBe(false);
  });
});

describe('parseOperationsResponse', () => {
  it('parses a fenced response', () => {
    const raw = 'Sure!\n```json\n{"explanation":"e","operations":[{"id":"a","op":"set_text","target":3,"text":"hi","explanation":"x"}]}\n```';
    const parsed = parseOperationsResponse(raw)!;
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0]).toMatchObject({ op: 'set_text', target: 3, text: 'hi' });
  });

  it('skips invalid operations with a warning and keeps valid ones', () => {
    const raw = '```json\n{"operations":[{"op":"explode","target":1},{"op":"set_text","target":2,"text":"ok"},{"op":"set_text","text":"no target"}]}\n```';
    const parsed = parseOperationsResponse(raw)!;
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(2);
  });

  it('accepts "[12]" style string targets and trailing commas', () => {
    const raw = '```json\n{"operations":[{"op":"remove","target":"[12]",},]}\n```';
    expect(parseOperationsResponse(raw)!.operations[0].target).toBe(12);
  });

  it('recovers from truncated output', () => {
    const raw = '```json\n{"explanation":"e","operations":[{"id":"a","op":"set_text","target":3,"text":"hi","explanation":"x"},{"id":"b","op":"set_text","target":4,"text":"cut o';
    const parsed = parseOperationsResponse(raw);
    expect(parsed?.operations.length).toBeGreaterThanOrEqual(1);
  });

  it('returns null when there are no operations', () => {
    expect(parseOperationsResponse('just text')).toBeNull();
    expect(parseOperationsResponse('```json\n{"operations":[]}\n```')).toBeNull();
  });
});

describe('PageIndex text for AI', () => {
  it('shows long paragraphs in full so rewrites are not cut off', () => {
    const long = 'Diakui sebagai ibu kota furnitur China, Foshan adalah rumah bagi ribuan pabrik. '.repeat(6).trim();
    document.body.innerHTML = `<h1>Title</h1><p id="p">${long}</p>`;
    const text = new PageIndex().build(document.body).text;
    expect(text).toContain(long);
    expect(text).not.toContain('…');
  });

  it('marks text it had to cut instead of silently shortening it', () => {
    const huge = 'word '.repeat(400).trim();
    document.body.innerHTML = `<p>${huge}</p>`;
    const text = new PageIndex().build(document.body).text;
    expect(text).toContain('TRUNCATED');
    expect(text).toContain(`${huge.length} chars total`);
  });

  it('falls back to short previews after the text budget is used', () => {
    const para = 'x'.repeat(700);
    document.body.innerHTML = Array.from({ length: 80 }, () => `<p>${para}</p>`).join('');
    const { text } = new PageIndex().build(document.body);
    expect(text.length).toBeLessThan(80 * 700);
    expect(text).toContain('TRUNCATED');
  });
});
