// jsdom has no layout engine: give every element a size so visibility checks
// (offsetWidth/offsetHeight/getClientRects) behave like a rendered page.
// Elements with display:none are still reported as not rendered.
if (typeof HTMLElement !== 'undefined') {
const rendered = (el: HTMLElement) => getComputedStyle(el).display !== 'none';

Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() { return rendered(this) ? 100 : 0; },
});
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() { return rendered(this) ? 100 : 0; },
});
Object.defineProperty(Element.prototype, 'getClientRects', {
  configurable: true,
  value(this: HTMLElement) { return rendered(this) ? [{}] : []; },
});
}

// jsdom lacks CSS.escape
if (typeof document !== 'undefined') {
if (!(globalThis as any).CSS) (globalThis as any).CSS = {};
if (!(globalThis as any).CSS.escape) {
  (globalThis as any).CSS.escape = (value: string) =>
    String(value).replace(/[^a-zA-Z0-9_ -￿-]/g, (c) => `\\${c}`).replace(/^(\d)/, '\\3$1 ');
}
}
