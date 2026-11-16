import { beforeEach, describe, expect, it } from 'vitest';
import { PageIndex } from '../src/utils/page-index';
import { ChangeManager } from '../src/utils/change-manager';
import { parseOperationsResponse } from '../src/utils/operation-parser';
import { Operation } from '../src/types/operations';
import { layoutRisk } from '../src/utils/operation-executor';

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

  describe('replace_image on lazy-loaded images', () => {
    const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    const lazy = (attrs: string) => {
      document.body.innerHTML = `<section><img id="l" src="${PLACEHOLDER}" ${attrs}></section>`;
      index = new PageIndex();
      return document.getElementById('l') as HTMLImageElement;
    };
    const replace = () => run({ id: 'r', op: 'replace_image', target: idOf('#l'), src: 'https://x/new.jpg', explanation: '' });

    it('points the loader\'s own attributes at the new picture, so scrolling does not bring the old one back', () => {
      const img = lazy('data-src="/o.jpg" data-lazy-src="/o.jpg" data-original="/o.jpg" data-srcset="/o.jpg 1x" data-lazy-srcset="/o.jpg 1x"');

      expect(replace().success).toBe(true);

      expect(img.getAttribute('src')).toBe('https://x/new.jpg');
      for (const attr of ['data-src', 'data-lazy-src', 'data-original']) expect(img.getAttribute(attr)).toBe('https://x/new.jpg');
      expect(img.hasAttribute('data-srcset')).toBe(false);
      expect(img.hasAttribute('data-lazy-srcset')).toBe(false);
    });

    it('leaves a loader attribute alone that the image does not have', () => {
      const img = lazy('data-src="/o.jpg"');
      replace();

      expect(img.hasAttribute('data-lazy-src')).toBe(false);
      expect(img.hasAttribute('data-original')).toBe(false);
    });

    it('puts every attribute back on undo', () => {
      const img = lazy('data-src="/o.jpg" data-srcset="/o.jpg 1x"');
      const before = Array.from(img.attributes).map((a) => `${a.name}=${a.value}`).sort();
      replace();
      manager.undo();

      // the placeholder is swapped for the picture the page itself would show, see the next test
      expect(img.getAttribute('data-src')).toBe('/o.jpg');
      expect(img.getAttribute('data-srcset')).toBe('/o.jpg 1x');
      expect(Array.from(img.attributes).map((a) => a.name).sort()).toEqual(before.map((entry) => entry.split('=')[0]));
    });

    it('shows the page\'s own picture on undo instead of a blank placeholder, since its loader will not run again', () => {
      const img = lazy('data-src="/o.jpg" class="lazyload"');
      replace();
      // the page's loader ran when the image scrolled into view, and is now finished with it
      img.classList.replace('lazyload', 'lazyloaded');
      manager.undo();

      expect(img.getAttribute('src')).toBe('/o.jpg');
    });

    it('restores a picture that was already loaded exactly as it was', () => {
      const img = lazy('data-src="/o.jpg"');
      img.setAttribute('src', '/o.jpg');
      replace();
      manager.undo();

      expect(img.getAttribute('src')).toBe('/o.jpg');
      expect(img.getAttribute('data-src')).toBe('/o.jpg');
    });

    it('clears the lazy srcset of the <source> elements of a <picture>', () => {
      document.body.innerHTML = `<picture><source id="s" srcset="/a.webp" data-srcset="/o.webp" data-lazy-srcset="/o.webp"><img id="l" src="${PLACEHOLDER}" data-src="/o.jpg"></picture>`;
      index = new PageIndex();
      const source = document.getElementById('s')!;

      replace();
      expect(['srcset', 'data-srcset', 'data-lazy-srcset'].some((attr) => source.hasAttribute(attr))).toBe(false);
      manager.undo();
      expect(source.getAttribute('data-srcset')).toBe('/o.webp');
      expect(source.getAttribute('srcset')).toBe('/a.webp');
    });
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

  describe('operations on a copy ("in")', () => {
    const dup = (): Operation => ({ id: 'dup', op: 'duplicate', target: idOf('#hero'), explanation: '' });
    const inCopy = (op: Partial<Operation> & { op: string }): Operation => ({ id: 'x', explanation: '', in: 'dup', ...op }) as Operation;

    it('changes the copy of an element and leaves the original alone', () => {
      const results = manager.applyOperations(
        [dup(), inCopy({ op: 'set_text', target: idOf('#hero h2'), text: 'Copy heading' } as any)],
        index
      );

      expect(results.map((r) => r.success)).toEqual([true, true]);
      const [original, copy] = Array.from(document.querySelectorAll('section'));
      expect(original.querySelector('h2')!.textContent).toBe('Hero');
      expect(copy.querySelector('h2')!.textContent).toBe('Copy heading');
      expect(copy.nextElementSibling?.id).toBe('about');
    });

    it('moves the copy itself', () => {
      const results = manager.applyOperations(
        [dup(), inCopy({ id: 'mv', op: 'move', target: idOf('#hero'), ref: idOf('footer'), position: 'before' } as any)],
        index
      );

      expect(results.every((r) => r.success)).toBe(true);
      const sections = Array.from(document.querySelectorAll('section'));
      expect(sections.map((s) => s.id)).toEqual(['hero', 'about', '']);
      expect(document.querySelector('footer')!.previousElementSibling).toBe(sections[2]);
    });

    it('fails clearly when "in" names no earlier duplicate or the element is outside the copy', () => {
      const [unknown] = manager.applyOperations([inCopy({ op: 'set_text', target: idOf('h1'), text: 'x', in: 'nope' } as any)], index);
      const [, outside] = manager.applyOperations([dup(), inCopy({ id: 'o', op: 'set_text', target: idOf('#about h2'), text: 'x' } as any)], index);

      expect(unknown.error).toContain('must be the id of a duplicate operation');
      expect(outside.error).toContain('is not part of the copy made by dup');
      expect(document.querySelector('#about h2')!.textContent).toBe('About');
    });

    it('does not save "in", and undoing the duplicate also undoes the edits in the copy', () => {
      manager.applyOperations([dup(), inCopy({ op: 'set_text', target: idOf('#hero h2'), text: 'Copy heading' } as any)], index);

      expect(JSON.stringify(manager.persistedOperations().map((p) => p.args))).not.toContain('"in"');
      expect(manager.revertByKey(manager.list()[0].key)).toBe(2);
      expect(document.querySelectorAll('section')).toHaveLength(2);
    });

    it('is kept by the parser', () => {
      const parsed = parseOperationsResponse(JSON.stringify({
        operations: [{ id: 'dup', op: 'duplicate', target: 3 }, { id: 'a', op: 'set_text', target: 4, in: 'dup', text: 'x' }],
      }))!;

      expect(parsed.operations.map((o) => o.in)).toEqual([undefined, 'dup']);
    });
  });

  describe('tables with set_html', () => {
    it('shows an inline-styled table in a paragraph', () => {
      const html = '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="padding:8px">Date</th></tr></thead><tbody><tr><td style="padding:8px">23 Dec</td></tr></tbody></table>';

      const result = run({ id: '1', op: 'set_html', target: idOf('#hero > p'), html, explanation: '' });

      expect(result.success).toBe(true);
      const table = document.querySelector('#hero > p table') as HTMLElement;
      expect(table.style.borderCollapse).toBe('collapse');
      expect(table.querySelectorAll('td, th')).toHaveLength(2);
      manager.undo();
      expect(document.querySelector('#hero > p')!.textContent).toBe('Hero text');
    });
  });

  describe('set_html layout guard', () => {
    const card = `<div class="grid"><div class="card"><h3 class="title">A</h3><p class="body">a</p></div><div class="card"><h3 class="title">B</h3></div></div>`;

    beforeEach(() => {
      document.querySelector('#about')!.innerHTML = card;
    });

    it('refuses to rebuild a styled section, and leaves it untouched', () => {
      const before = document.querySelector('#about')!.innerHTML;
      const result = run({ id: '1', op: 'set_html', target: idOf('#about'), html: '<h2>New</h2><p>Text</p>', explanation: '' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('would remove the styling of 6 elements');
      expect(document.querySelector('#about')!.innerHTML).toBe(before);
    });

    it('allows a small element without styled children', () => {
      const result = run({ id: '1', op: 'set_html', target: idOf('#hero > p'), html: 'Line one<br>Line <strong>two</strong>', explanation: '' });

      expect(result.success).toBe(true);
      expect(document.querySelector('#hero > p')!.innerHTML).toBe('Line one<br>Line <strong>two</strong>');
    });

    it('allows html that keeps at least as many styled elements', () => {
      const html = '<div class="grid"><div class="card"><h3 class="title">X</h3><p class="body">x</p></div><div class="card"><h3 class="title">Y</h3></div></div>';

      expect(run({ id: '1', op: 'set_html', target: idOf('#about'), html, explanation: '' }).success).toBe(true);
    });

    it('layoutRisk reports the problem without touching the page', () => {
      const op: Operation = { id: '1', op: 'set_html', target: idOf('#about'), html: '<p>x</p>', explanation: '' };

      expect(layoutRisk(op, index)).toContain('break the layout');
      expect(layoutRisk({ ...op, op: 'set_text', text: 'x' } as Operation, index)).toBeNull();
      expect(layoutRisk({ ...op, target: 99999 }, index)).toBeNull();
    });
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
