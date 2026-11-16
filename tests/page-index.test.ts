import { beforeEach, describe, expect, it } from 'vitest';
import { PageIndex } from '../src/utils/page-index';
import { countImageSlots } from '../src/utils/web-images';

let index: PageIndex;
const build = () => index.build(document.body).text;

beforeEach(() => {
  index = new PageIndex();
  document.body.innerHTML = '';
});

describe('PageIndex background images', () => {
  it('lists a div that shows a CSS background image, with the whole value', () => {
    document.body.innerHTML = `<div id="hero" style="background-image: linear-gradient(red, blue), url('https://x.test/hero.jpg')"><span>Hi</span></div>`;

    const text = build();

    expect(text).toMatch(/^\[\d+\] div \(block\) #hero bg-image="linear-gradient\(red, blue\), url\(.*hero\.jpg.*\)"/m);
    expect(text).toContain('span "Hi"');
  });

  it('adds the flag to an element that is already described', () => {
    document.body.innerHTML = `<section style="background-image: url(https://x.test/a.png)"><h1>Title</h1></section>`;

    expect(build()).toMatch(/^\[\d+\] section "Title" bg-image="url\(.*a\.png.*\)"/m);
  });

  it('ignores backgrounds without a url(), gradients alone and <img> elements', () => {
    document.body.innerHTML = `
      <div style="background-image: linear-gradient(red, blue)"><p>One</p></div>
      <div style="background-color: red"><p>Two</p></div>
      <img src="/a.jpg" alt="a" style="background-image: url(https://x.test/b.png)">`;

    expect(build()).not.toContain('bg-image');
  });

  it('lists a nested container that is not a section candidate', () => {
    document.body.innerHTML = `<main><div><div id="inner" style="background-image: url(https://x.test/n.jpg)"><span>Hi</span></div></div></main>`;

    expect(build()).toMatch(/^\s*\[\d+\] div \(block\) bg-image="url\(.*n\.jpg.*\)"/m);
  });

  it('ignores small boxes such as icons', () => {
    document.body.innerHTML = `<div id="icon" style="background-image: url(https://x.test/i.svg)"></div>`;
    Object.defineProperty(document.getElementById('icon'), 'offsetWidth', { value: 24 });
    Object.defineProperty(document.getElementById('icon'), 'offsetHeight', { value: 24 });

    expect(build()).not.toContain('bg-image');
  });
});

describe('PageIndex.untouchedSections', () => {
  const sections = () => Array.from(document.querySelectorAll('section'));

  beforeEach(() => {
    document.body.innerHTML = `
      <header><h1>Logo</h1></header>
      <section id="a"><h2>A</h2><p id="a-p">one</p></section>
      <section id="b"><h2>B</h2><p>two</p></section>
      <section id="c"><h2>C</h2><p>three</p></section>
      <footer><p>Legal</p></footer>`;
  });

  it('reports sections that hold none of the targets', () => {
    const target = index.idOf(document.getElementById('a-p')!);

    expect(index.untouchedSections([target]).map((s) => s.label)).toEqual(['B', 'C']);
  });

  it('counts a target that is the section itself', () => {
    const [a, b] = sections().map((s) => index.idOf(s));

    expect(index.untouchedSections([a, b]).map((s) => s.label)).toEqual(['C']);
  });

  it('never offers the header, navigation or footer', () => {
    const all = sections().map((s) => index.idOf(s));

    expect(index.untouchedSections(all)).toEqual([]);
    expect(index.untouchedSections([]).map((s) => s.tag)).toEqual(['section', 'section', 'section']);
  });

  it('skips sections that are already hidden and ignores unknown ids', () => {
    const [a] = sections().map((s) => index.idOf(s));
    index.markHidden(document.getElementById('b')!, true);
    (document.getElementById('b') as HTMLElement).style.display = 'none';

    expect(index.untouchedSections([a, 9999]).map((s) => s.label)).toEqual(['C']);
  });
});

describe('PageIndex pictures', () => {
  it('lists the <img> inside a <picture>, so it can be replaced, and not the picture itself', () => {
    document.body.innerHTML = '<section><picture><source srcset="a.webp"><img alt="Hero" src="/a.jpg"></picture></section>';
    const index = new PageIndex();

    const { text } = index.build(document.body);

    expect(text).toMatch(/\[\d+\] img alt="Hero" src="\/a.jpg"/);
    expect(text).not.toMatch(/\] picture/);
    expect(countImageSlots(text)).toBe(1);
  });
});
