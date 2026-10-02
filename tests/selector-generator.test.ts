import { beforeEach, describe, expect, it } from 'vitest';
import { SelectorGenerator } from '../src/utils/selector-generator';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('SelectorGenerator', () => {
  it('generates a selector that resolves back to the same element when siblings have different tags', () => {
    document.body.innerHTML = `
      <div>
        <h2>Title</h2>
        <p>one</p>
        <span>x</span>
        <p id="target-holder">two</p>
        <p>three</p>
      </div>`;
    const target = document.querySelectorAll('p')[1];
    const { selector } = SelectorGenerator.generate(target);
    expect(SelectorGenerator.query(selector).elements).toEqual([target]);
  });

  it('does not use a non-unique data attribute', () => {
    document.body.innerHTML = `
      <ul><li data-id="a">1</li><li data-id="a">2</li></ul>`;
    const target = document.querySelectorAll('li')[1];
    const { selector } = SelectorGenerator.generate(target);
    expect(SelectorGenerator.query(selector).elements).toEqual([target]);
  });

  it('query never throws on invalid selectors', () => {
    expect(SelectorGenerator.query('div[').error).toBeTruthy();
    expect(SelectorGenerator.query('').error).toBeTruthy();
  });

  it('query supports XPath', () => {
    document.body.innerHTML = '<p>a</p><p>b</p>';
    expect(SelectorGenerator.query('//p').elements).toHaveLength(2);
  });
});

describe('SelectorGenerator paths', () => {
  const resolvesBack = (el: Element) => {
    const { selector } = SelectorGenerator.generate(el);
    expect(SelectorGenerator.query(selector).elements).toEqual([el]);
    return selector;
  };

  it('anchors on an element with a unique id without adding a bogus segment', () => {
    document.body.innerHTML = '<section id="hero"><h2>Hero</h2></section><section id="about"><h2>About</h2></section>';
    expect(resolvesBack(document.querySelector('#hero h2')!)).toBe('#hero > h2');
    expect(resolvesBack(document.querySelector('#about')!)).toBe('#about');
  });

  it('resolves repeated siblings and deep structures without ids', () => {
    document.body.innerHTML = '<main><div><ul><li>a</li><li>b</li></ul></div><div><ul><li>c</li><li>d</li></ul></div></main>';
    document.querySelectorAll('li').forEach(resolvesBack);
  });

  it('XPath fallback indexes every step', () => {
    document.body.innerHTML = '<section><h2>One</h2></section><section><h2>Two</h2></section>';
    const target = document.querySelectorAll('h2')[1];
    const xpath = (SelectorGenerator as any).getXPath(target);
    expect(SelectorGenerator.query(xpath).elements).toEqual([target]);
  });
});
