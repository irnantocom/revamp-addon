import { beforeEach, describe, expect, it } from 'vitest';
import { PageIndex } from '../src/utils/page-index';
import { ChangeManager } from '../src/utils/change-manager';
import { Operation } from '../src/types/operations';

let index: PageIndex;
let manager: ChangeManager;

const idOf = (selector: string) => index.idOf(document.querySelector(selector)!);
const run = (op: Operation) => manager.applyOperations([op], index)[0];
const base = { id: '1', explanation: '' };

beforeEach(() => {
  document.body.innerHTML = `
    <h1 id="title" class="big">Welcome</h1>
    <section id="about"><p>About</p></section>
    <a id="link" href="/x">Go</a>`;
  index = new PageIndex();
  manager = new ChangeManager();
});

describe('URL safety', () => {
  const bypasses = [
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '\u0001javascript:alert(1)',
    ' \n javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
  ];

  it.each(bypasses)('set_link rejects %j', (href) => {
    const result = run({ ...base, op: 'set_link', target: idOf('#link'), href });
    expect(result.success).toBe(false);
    expect(document.querySelector('#link')!.getAttribute('href')).toBe('/x');
  });

  it('set_html strips a javascript: URL hidden behind a tab character', () => {
    run({ ...base, op: 'set_html', target: idOf('#about'), html: '<a href="java&#9;script:alert(1)">x</a>' });
    expect(document.querySelector('#about a')!.hasAttribute('href')).toBe(false);
  });

  it('still allows normal links, anchors, mailto and relative paths', () => {
    for (const href of ['https://ok.test/a?b=1#c', '/relative', '#top', 'mailto:a@b.test', 'tel:+62123']) {
      expect(run({ ...base, op: 'set_link', target: idOf('#link'), href }).success).toBe(true);
    }
  });
});

describe('attribute names', () => {
  it.each(['my attr', 'a<b', '1abc', '', 'x=y', '"quote', 'a"b', "it's"])('set_attr rejects the name %j', (name) => {
    const el = document.querySelector('#title')!;
    const before = el.outerHTML;
    const result = run({ ...base, op: 'set_attr', target: idOf('#title'), name, value: 'v' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/attribute name/i);
    expect(el.outerHTML).toBe(before);
  });

  it.each(['srcdoc', 'data-revamp-hidden', 'data-revamp-ui', 'onload'])('set_attr refuses %s', (name) => {
    expect(run({ ...base, op: 'set_attr', target: idOf('#title'), name, value: 'v' }).success).toBe(false);
  });

  it.each(['aria-label', 'data-x', 'class', 'xlink:href', 'title'])('set_attr accepts %s', (name) => {
    expect(run({ ...base, op: 'set_attr', target: idOf('#title'), name, value: 'v' }).success).toBe(true);
  });

  it('keeps quotes, angle brackets and newlines in values as plain data', () => {
    const value = '"><script>alert(1)</script>\n<b>x</b> & \'y\'';
    expect(run({ ...base, op: 'set_attr', target: idOf('#title'), name: 'title', value }).success).toBe(true);
    const el = document.querySelector('#title')!;
    expect(el.getAttribute('title')).toBe(value);
    expect(document.querySelector('script')).toBeNull();
    expect(el.children.length).toBe(0);
  });
});

describe('style values', () => {
  const h1 = () => document.querySelector<HTMLElement>('#title')!;

  it.each([
    ['color', 'red; } body { display:none'],
    ['color', 'notacolor'],
    ['font-size', '24'],
    ['not-a-property', '1'],
  ])('set_style rejects %s: %j and leaves the element untouched', (prop, value) => {
    h1().style.color = 'green';
    const before = h1().getAttribute('style');
    const result = run({ ...base, op: 'set_style', target: idOf('#title'), styles: { [prop]: value } });
    expect(result.success).toBe(false);
    expect(result.error).toContain(prop);
    expect(h1().getAttribute('style')).toBe(before);
  });

  it('is all-or-nothing: one bad value stops the valid ones too', () => {
    const result = run({ ...base, op: 'set_style', target: idOf('#title'), styles: { color: 'blue', 'font-size': 'bogus' } });
    expect(result.success).toBe(false);
    expect(h1().style.color).toBe('');
  });

  it('accepts a trailing !important and keeps it as priority', () => {
    expect(run({ ...base, op: 'set_style', target: idOf('#title'), styles: { display: 'none !important' } }).success).toBe(true);
    expect(h1().style.getPropertyValue('display')).toBe('none');
    expect(h1().style.getPropertyPriority('display')).toBe('important');
    manager.undo();
    expect(h1().style.getPropertyValue('display')).toBe('');
  });

  it('accepts normal values, camelCase names and custom properties', () => {
    const styles = { fontSize: '24px', padding: '16px 24px', '--brand': '#123456', 'background-image': 'url("https://x/a.png")' };
    expect(run({ ...base, op: 'set_style', target: idOf('#title'), styles }).success).toBe(true);
    expect(h1().style.fontSize).toBe('24px');
    expect(h1().style.getPropertyValue('--brand')).toBe('#123456');
  });
});

describe('legacy selector changes use the same protections', () => {
  it('insert sanitizes the HTML', async () => {
    const result = await manager.applyChange({
      id: 'c', action: 'insert', selector: '#about', position: 'append', explanation: '',
      value: '<img src="x" onerror="alert(1)"><script>alert(1)</script><a href="java&#9;script:1">l</a><p>ok</p>',
    });
    expect(result.success).toBe(true);
    const about = document.querySelector('#about')!;
    expect(about.querySelector('script')).toBeNull();
    expect(about.querySelector('img')!.hasAttribute('onerror')).toBe(false);
    expect(about.querySelector('a')!.hasAttribute('href')).toBe(false);
    expect(about.lastElementChild!.textContent).toBe('ok');
  });

  it('html sanitizes the HTML', async () => {
    await manager.applyChange({ id: 'c', action: 'html', selector: '#about', explanation: '', value: '<b onclick="x()">hi</b><iframe src="/x"></iframe>' });
    const about = document.querySelector('#about')!;
    expect(about.querySelector('iframe')).toBeNull();
    expect(about.querySelector('b')!.hasAttribute('onclick')).toBe(false);
  });

  it('attribute rejects invalid names', async () => {
    const result = await manager.applyChange({ id: 'c', action: 'attribute', selector: '#title', attribute: 'my attr', value: 'v', explanation: '' });
    expect(result.success).toBe(false);
  });
});
