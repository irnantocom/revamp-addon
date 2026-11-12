import { beforeEach, describe, expect, it } from 'vitest';
import { collectThemeVariables } from '../src/utils/theme-variables';
import { buildSystemPrompt, type PageIndexData } from '../src/utils/prompt-builder';

const css = (text: string) => {
  const style = document.createElement('style');
  style.textContent = text;
  document.head.appendChild(style);
};

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<p>x</p>';
  document.body.removeAttribute('style');
});

describe('collectThemeVariables', () => {
  it('lists custom properties declared on :root, html and body, with their values', () => {
    css(`:root { --accent: #8a3a6b; --accent-dark: #5a2444; } body { --gap: 12px; }`);

    const names = collectThemeVariables().map((v) => v.name);

    expect(names).toEqual(expect.arrayContaining(['--accent', '--accent-dark', '--gap']));
    expect(collectThemeVariables().find((v) => v.name === '--accent')?.value).toBe('#8a3a6b');
  });

  it('ignores variables declared only on other selectors, and ordinary properties', () => {
    css(`.card { --card-bg: red; } :root { color: blue; --accent: #111; }`);

    expect(collectThemeVariables().map((v) => v.name)).toEqual(['--accent']);
  });

  it('reads rules inside @media and @supports', () => {
    css(`@media (min-width: 1px) { :root { --wide: 1px; } } @supports (display: grid) { :root { --grid: 2px; } }`);

    expect(collectThemeVariables().map((v) => v.name)).toEqual(expect.arrayContaining(['--wide', '--grid']));
  });

  it('shows colours first and WordPress presets after the theme\'s own variables', () => {
    css(`:root { --wp--preset--color--vivid: #f00; --gap: 4px; --accent: #123456; --wp--preset--font-size--m: 16px; }`);

    expect(collectThemeVariables().map((v) => v.name)).toEqual([
      '--accent',
      '--wp--preset--color--vivid',
      '--gap',
      '--wp--preset--font-size--m',
    ]);
  });

  it('keeps at most the requested number and shortens long values', () => {
    css(`:root { ${Array.from({ length: 10 }, (_, i) => `--c${i}: #00000${i};`).join(' ')} --long: ${'a'.repeat(200)}; }`);

    expect(collectThemeVariables(document, 3)).toHaveLength(3);
    expect(collectThemeVariables().find((v) => v.name === '--long')!.value.length).toBeLessThanOrEqual(81);
  });

  it('survives a stylesheet it cannot read', () => {
    css(`:root { --accent: #111; }`);
    const sheet = document.styleSheets[0];
    Object.defineProperty(sheet, 'cssRules', { get: () => { throw new DOMException('blocked', 'SecurityError'); } });
    css(`:root { --other: #222; }`);

    expect(collectThemeVariables().map((v) => v.name)).toEqual(['--other']);
  });

  it('reports nothing for a page without variables', () => {
    css(`p { color: red; }`);
    expect(collectThemeVariables()).toEqual([]);
  });
});

describe('theme variables in the system prompt', () => {
  const base: PageIndexData = { mode: 'page', rootId: 7, rootTag: 'body', index: '[8] h1 "x"', count: 1, truncated: false, url: 'https://x.test', title: 'T' };

  it('lists the variables and names the root element that carries them', () => {
    const prompt = buildSystemPrompt({ ...base, theme: [{ name: '--accent', value: '#8a3a6b' }, { name: '--accent-dark', value: '#5a2444' }] });

    expect(prompt).toContain('THEME VARIABLES');
    expect(prompt).toContain('root element is [7]');
    expect(prompt).toContain('--accent: #8a3a6b');
    expect(prompt).toContain('--accent-dark: #5a2444');
  });

  it('says so when no variable could be read, so the model does not invent names', () => {
    const prompt = buildSystemPrompt({ ...base, theme: [] });

    expect(prompt).toContain('THEME VARIABLES');
    expect(prompt).toContain('None could be read');
  });

  it('leaves the block out for a selected element or when the page sent no theme data', () => {
    expect(buildSystemPrompt(base)).not.toContain('THEME VARIABLES (');
    expect(buildSystemPrompt({ ...base, mode: 'element', theme: [{ name: '--a', value: '1' }] })).not.toContain('THEME VARIABLES (');
  });

  it('tells the model to change variables first, with the root as the target', () => {
    const prompt = buildSystemPrompt(base);

    expect(prompt).toMatch(/THEME\. To change colours/);
    expect(prompt).toContain('set_style on the root element');
    expect(prompt).toContain('"--accent"');
  });
});
