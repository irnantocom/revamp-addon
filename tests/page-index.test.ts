import { beforeEach, describe, expect, it } from 'vitest';
import { PageIndex } from '../src/utils/page-index';

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
