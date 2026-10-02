import { beforeEach, describe, expect, it } from 'vitest';
import { extractCssUrls, extractImports, mapCssUrls, pruneFontSources, removeImports, wrapMedia } from '../src/export/css-bundle';
import { parseSrcset, rewriteHtmlAssets, serializeSrcset } from '../src/export/html-assets';
import { isTrackingUrl } from '../src/export/tracking';
import { activateLazyContent, cleanClone, collectStyleSheets, pinAttributes, restorePinned } from '../src/export/snapshot';
import { buildStaticSite } from '../src/export/build-package';
import { DEFAULT_EXPORT_OPTIONS, Fetcher, PageSnapshot } from '../src/export/types';

const BASE = 'https://site.test/blog/page.html';

describe('tracking', () => {
  it('recognises trackers and their subdomains, but not first-party or CDN content', () => {
    expect(isTrackingUrl('https://www.googletagmanager.com/gtm.js?id=GTM-1')).toBe(true);
    expect(isTrackingUrl('https://stats.g.doubleclick.net/x')).toBe(true);
    expect(isTrackingUrl('https://www.facebook.com/tr?id=1&ev=PageView')).toBe(true);
    expect(isTrackingUrl('https://fonts.googleapis.com/css2?family=Inter')).toBe(false);
    expect(isTrackingUrl('https://www.facebook.com/photo.jpg')).toBe(false);
    expect(isTrackingUrl('https://site.test/wp-content/a.jpg')).toBe(false);
    expect(isTrackingUrl('notaurl')).toBe(false);
  });
});

describe('css-bundle', () => {
  it('makes url()s absolute against the stylesheet and keeps data URIs', () => {
    const css = `a{background:url(../img/a.png)} b{background:url("data:image/png;base64,AAA=")} c{background:url('/x.svg#id')}`;
    const out = mapCssUrls(css, 'https://cdn.test/css/site.css', () => null);
    expect(out).toContain('url("https://cdn.test/img/a.png")');
    expect(out).toContain('url("data:image/png;base64,AAA=")');
    expect(out).toContain('url("https://cdn.test/x.svg#id")');
  });

  it('treats urls inside @font-face as fonts and everything else as images', () => {
    const css = `@font-face{font-family:X;src:url(f.woff2) format("woff2")} .a{background:url(i.jpg)}`;
    const found = extractCssUrls(css, 'https://s.test/a.css');
    expect(found).toEqual(expect.arrayContaining([
      { url: 'https://s.test/f.woff2', kind: 'font' },
      { url: 'https://s.test/i.jpg', kind: 'image' },
    ]));
  });

  it('handles image-set strings', () => {
    const out = mapCssUrls('.a{background-image:image-set("a.png" 1x, "b.png" 2x)}', 'https://s.test/', (u) => `local/${u.split('/').pop()}`);
    expect(out).toContain('"local/a.png" 1x');
    expect(out).toContain('"local/b.png" 2x');
  });

  it('finds and removes @import rules in every syntax', () => {
    const css = `@import url("a.css") screen;\n@import 'b.css';\n@import url(c.css);\n.x{color:red}`;
    const imports = extractImports(css, 'https://s.test/base/x.css');
    expect(imports.map((i) => i.url)).toEqual(['https://s.test/base/a.css', 'https://s.test/base/b.css', 'https://s.test/base/c.css']);
    expect(imports[0].media).toBe('screen');
    expect(removeImports(css).trim()).toBe('.x{color:red}');
  });

  it('wraps media-specific sheets only', () => {
    expect(wrapMedia('a{}', 'print')).toBe('@media print {\na{}\n}');
    expect(wrapMedia('a{}', 'all')).toBe('a{}');
    expect(wrapMedia('a{}', '')).toBe('a{}');
  });

  it('keeps only the woff2 source of a font face', () => {
    const css = `@font-face{font-family:X;src:url(a.eot);src:url(a.woff2) format("woff2"),url(a.woff) format("woff"),url(a.ttf) format("truetype")}`;
    const out = pruneFontSources(css);
    expect(out).toContain('a.woff2');
    expect(out).not.toContain('a.woff)');
    expect(out).not.toContain('a.ttf');
  });
});

describe('html-assets', () => {
  it('round-trips srcset', () => {
    const parsed = parseSrcset('a.jpg 1x, b.jpg 2x');
    expect(parsed).toEqual([{ url: 'a.jpg', descriptor: '1x' }, { url: 'b.jpg', descriptor: '2x' }]);
    expect(serializeSrcset(parsed)).toBe('a.jpg 1x, b.jpg 2x');
    expect(parseSrcset('https://cdn.test/i.jpg?w=300,h=200 300w, https://cdn.test/i.jpg?w=600 600w')).toHaveLength(2);
  });

  it('visits images, srcset, posters, icons, svg images and inline background urls', () => {
    document.body.innerHTML = `
      <img src="a.jpg" srcset="a.jpg 1x, a2.jpg 2x">
      <picture><source srcset="p.webp" type="image/webp"><source src="x.png"><img src="p.jpg"></picture>
      <video poster="poster.jpg"><source src="v.mp4"></video>
      <div style="background:url('bg.jpg') center"></div>
      <svg><image href="s.svg"/></svg><img src="data:image/gif;base64,R0lG">`;
    const seen: string[] = [];
    rewriteHtmlAssets(document.body, (url, kind) => { seen.push(`${kind}:${url}`); return `L/${url}`; });
    expect(seen).toEqual(expect.arrayContaining([
      'image:a.jpg', 'image:a2.jpg', 'image:p.webp', 'image:x.png', 'image:p.jpg', 'image:poster.jpg', 'media:v.mp4', 'image:bg.jpg', 'image:s.svg',
    ]));
    expect(seen.some((s) => s.includes('data:'))).toBe(false);
    expect(document.querySelector('img')!.getAttribute('srcset')).toBe('L/a.jpg 1x, L/a2.jpg 2x');
    expect(document.querySelector('div')!.getAttribute('style')).toContain('url("L/bg.jpg")');
  });
});

describe('cleanClone', () => {
  const clean = (html: string, keepScripts = false) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    const warnings = cleanClone(root, BASE, { keepScripts });
    return { root, warnings };
  };

  it('drops tracking, consent widgets, scripts, handlers and revamp UI', () => {
    const { root, warnings } = clean(`
      <script src="https://www.googletagmanager.com/gtm.js"></script><script>var a=1</script>
      <img src="https://www.facebook.com/tr?id=1" width="1" height="1">
      <div id="CybotCookiebotDialog">cookies</div>
      <div data-revamp-ui="true">panel</div>
      <button onclick="x()" integrity="z" data-revamp-hidden="true">Buy</button>
      <a href="javascript:void(0)">x</a><noscript><img src="t.gif"></noscript>
      <!-- comment --><p>Keep me</p>`);
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('#CybotCookiebotDialog')).toBeNull();
    expect(root.querySelector('[data-revamp-ui]')).toBeNull();
    expect(root.querySelector('noscript')).toBeNull();
    const button = root.querySelector('button')!;
    expect(button.hasAttribute('onclick')).toBe(false);
    expect(button.hasAttribute('integrity')).toBe(false);
    expect(button.hasAttribute('data-revamp-hidden')).toBe(false);
    expect(root.querySelector('a')!.getAttribute('href')).toBe('#');
    expect(root.innerHTML).not.toContain('comment');
    expect(root.textContent).toContain('Keep me');
    expect(warnings.join(' ')).toMatch(/tracking/);
    expect(warnings.join(' ')).toMatch(/script/);
  });

  it('keeps first-party scripts and handlers when asked, but never tracking', () => {
    const { root } = clean(`<script src="/app.js"></script><script src="https://connect.facebook.net/x.js"></script><button onclick="go()">Go</button>`, true);
    const scripts = Array.from(root.querySelectorAll('script'));
    expect(scripts).toHaveLength(1);
    expect(scripts[0].getAttribute('src')).toBe('https://site.test/app.js');
    expect(root.querySelector('button')!.getAttribute('onclick')).toBe('go()');
  });

  it('makes asset and link URLs absolute, leaving anchors and mailto alone', () => {
    const { root } = clean(`<img src="../img/a.jpg"><a href="next.html">n</a><a href="#top">t</a><a href="mailto:a@b.c">m</a><form action="/send"></form>`);
    expect(root.querySelector('img')!.getAttribute('src')).toBe('https://site.test/img/a.jpg');
    const links = Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['https://site.test/blog/next.html', '#top', 'mailto:a@b.c']);
    expect(root.querySelector('form')!.getAttribute('action')).toBe('https://site.test/send');
  });

  it('activates lazy images and backgrounds', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="real.jpg" data-srcset="real.jpg 1x, real2.jpg 2x" loading="lazy">
      <img src="already.jpg" data-src="other.jpg">
      <div data-bg="hero.jpg"></div><div data-bg="#fff"></div>`;
    activateLazyContent(root);
    const [lazy, fixed] = Array.from(root.querySelectorAll('img'));
    expect(lazy.getAttribute('src')).toBe('real.jpg');
    expect(lazy.getAttribute('srcset')).toBe('real.jpg 1x, real2.jpg 2x');
    expect(lazy.hasAttribute('loading')).toBe(false);
    expect(fixed.getAttribute('src')).toBe('already.jpg');
    const [hero, color] = Array.from(root.querySelectorAll('div'));
    expect(hero.getAttribute('style')).toContain('url("hero.jpg")');
    expect(color.hasAttribute('style')).toBe(false);
  });
});

describe('lazy images that the user replaced', () => {
  // Markup as left by LiteSpeed's lazy-loader after it ran, then edited by the user in demo mode
  const loaded = `<img data-lazyloaded="1" src="https://cdn.test/NEW.jpg" data-src="https://cdn.test/old.png"
    data-srcset="https://cdn.test/old.png 1402w, https://cdn.test/old-300.png 300w" data-sizes="100vw" data-ll-status="loaded" sizes="100vw">`;

  it('keeps the new src and does not bring the old image back through data-srcset', () => {
    const root = document.createElement('div');
    root.innerHTML = loaded;
    activateLazyContent(root);
    const img = root.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://cdn.test/NEW.jpg');
    expect(img.hasAttribute('srcset')).toBe(false);
    ['data-src', 'data-srcset', 'data-sizes', 'data-lazyloaded', 'data-ll-status'].forEach((a) => expect(img.hasAttribute(a)).toBe(false));
  });

  it('keeps the page\'s own loaded srcset, and strips the stale data-* copies', () => {
    const root = document.createElement('div');
    root.innerHTML = `<img src="a.png" srcset="a.png 1x, a2.png 2x" data-src="a.png" data-srcset="a.png 1x, a2.png 2x">`;
    activateLazyContent(root);
    const img = root.querySelector('img')!;
    expect(img.getAttribute('srcset')).toBe('a.png 1x, a2.png 2x');
    expect(img.hasAttribute('data-srcset')).toBe(false);
  });

  it('does not restore a <picture> source the user cleared', () => {
    const root = document.createElement('div');
    root.innerHTML = `<picture><source data-srcset="old.webp" type="image/webp"><img src="NEW.jpg"></picture>`;
    activateLazyContent(root);
    expect(root.querySelector('source')!.hasAttribute('srcset')).toBe(false);
  });

  it('still activates images that are genuinely not loaded yet, in pictures too', () => {
    const root = document.createElement('div');
    root.innerHTML = `<picture><source data-srcset="real.webp"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="real.jpg"></picture>`;
    activateLazyContent(root);
    expect(root.querySelector('source')!.getAttribute('srcset')).toBe('real.webp');
    expect(root.querySelector('img')!.getAttribute('src')).toBe('real.jpg');
  });

  it('pinned attributes are restored if a script overwrote them', () => {
    document.body.innerHTML = '<img id="i" src="NEW.jpg" style="width:10px"><a id="a" href="/x">x</a>';
    const img = document.getElementById('i')!;
    const pins = pinAttributes([img]);
    img.setAttribute('src', 'old.png'); // lazy-loader runs while scrolling
    img.setAttribute('srcset', 'old.png 1x');
    img.removeAttribute('style');
    restorePinned(pins);
    expect(img.getAttribute('src')).toBe('NEW.jpg');
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(img.getAttribute('style')).toBe('width:10px');
  });
});

describe('collectStyleSheets', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('returns inline styles in document order and skips Revamp styles', () => {
    document.head.innerHTML = `
      <style>.a{color:red}</style>
      <style id="revamp-inspector-styles">.x{color:blue}</style>
      <style media="print">.b{color:green}</style>`;
    const { sheets } = collectStyleSheets(document);
    expect(sheets).toHaveLength(2);
    expect(sheets[0].css).toContain('.a');
    expect(sheets[1].media).toBe('print');
    expect(sheets.some((s) => s.css?.includes('.x'))).toBe(false);
  });
});

describe('buildStaticSite', () => {
  const snapshot = (over: Partial<PageSnapshot> = {}): PageSnapshot => ({
    url: 'https://site.test/',
    title: 'Home',
    html: `<html><head><title>Home</title></head><body>
      <img src="https://cdn.test/hero.jpg" srcset="https://cdn.test/hero.jpg 1x, https://cdn.test/hero@2x.jpg 2x">
      <div style="background:url(&quot;https://cdn.test/bg.png&quot;)">x</div>
      <video src="https://cdn.test/movie.mp4"></video>
      <img src="https://cdn.test/missing.jpg">
      <img src="https://www.googletagmanager.com/pixel.gif">
      </body></html>`,
    sheets: [
      { baseUrl: 'https://cdn.test/css/main.css', css: `@import url("theme.css");\n@font-face{font-family:F;src:url(../f/f.woff2) format("woff2"),url(../f/f.woff) format("woff")}\n.hero{background:url(../img/h.png)}` },
      { baseUrl: 'https://other.test/ext.css', css: null, fetchUrl: 'https://other.test/ext.css' },
    ],
    warnings: ['Removed 1 script(s).'],
    ...over,
  });

  const files: Record<string, string> = {
    'https://cdn.test/css/theme.css': '.theme{background:url(t.png)}',
    'https://other.test/ext.css': '.ext{background:url("//other.test/e.gif")}',
  };
  const binaries = new Set([
    'https://cdn.test/hero.jpg', 'https://cdn.test/hero@2x.jpg', 'https://cdn.test/bg.png', 'https://cdn.test/f/f.woff2',
    'https://cdn.test/img/h.png', 'https://cdn.test/css/t.png', 'https://other.test/e.gif',
  ]);

  const fetcher = (calls: string[] = []): Fetcher => ({
    async text(url) {
      calls.push(url);
      if (!(url in files)) throw new Error('HTTP 404');
      return files[url];
    },
    async binary(url) {
      calls.push(url);
      if (!binaries.has(url)) throw new Error('HTTP 404');
      const type = url.endsWith('.woff2') ? 'font/woff2' : url.endsWith('.png') ? 'image/png' : url.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
      return { data: new Uint8Array([1, 2, 3]), contentType: type };
    },
  });

  it('bundles CSS, downloads assets and rewrites every reference', async () => {
    const calls: string[] = [];
    const { files: out, report } = await buildStaticSite(snapshot(), DEFAULT_EXPORT_OPTIONS, fetcher(calls));

    const html = out['index.html'] as string;
    const css = out['css/styles.css'] as string;

    // CSS: imports inlined, in order, all urls local
    expect(css.indexOf('.theme')).toBeLessThan(css.indexOf('.hero'));
    expect(css).not.toContain('@import');
    expect(css).not.toMatch(/url\("https?:/);
    expect(css).toContain('url("../assets/fonts/f-');
    expect(css).toContain('url("../assets/images/h-');
    expect(css).toContain('.ext');
    // only the woff2 font was downloaded
    expect(calls.some((u) => u.endsWith('f.woff'))).toBe(false);
    expect(css).toContain('[data-aos]');

    // HTML: local paths, link to the stylesheet, charset
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<link rel="stylesheet" href="css/styles.css">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toMatch(/src="assets\/images\/hero-[0-9a-f]{8}\.jpg"/);
    expect(html).toMatch(/srcset="assets\/images\/hero-[0-9a-f]{8}\.jpg 1x, assets\/images\/hero-2x-[0-9a-f]{8}\.jpg 2x"/);
    expect(html).toMatch(/background:\s*url\(&quot;assets\/images\/bg-/);

    // files really exist in the package
    const referenced = Array.from(html.matchAll(/assets\/[^"\s,&]+/g)).map((m) => m[0]);
    referenced.forEach((p) => expect(out[p]).toBeInstanceOf(Uint8Array));

    // failures keep the online URL; tracking pixel and video are not fetched
    expect(html).toContain('https://cdn.test/missing.jpg');
    expect(html).toContain('https://cdn.test/movie.mp4');
    expect(report.failed.map((f) => f.url)).toContain('https://cdn.test/missing.jpg');
    expect(calls.some((u) => u.includes('googletagmanager'))).toBe(false);
    expect(calls).not.toContain('https://cdn.test/movie.mp4');
    expect(report.skipped.some((s) => s.url.endsWith('movie.mp4'))).toBe(true);

    expect(out['README.txt']).toContain('Assets downloaded');
    expect(JSON.parse(out['report.json'] as string).assets.length).toBe(report.assets.length);
  });

  it('keeps remote URLs when asset download is off', async () => {
    const { files: out, report } = await buildStaticSite(snapshot(), { ...DEFAULT_EXPORT_OPTIONS, downloadAssets: false }, fetcher());
    expect(report.assets).toHaveLength(0);
    expect(out['index.html'] as string).toContain('https://cdn.test/hero.jpg');
    expect(out['css/styles.css'] as string).toContain('url("https://cdn.test/img/h.png")');
  });

  it('survives an unreadable stylesheet and says so', async () => {
    const snap = snapshot({ sheets: [{ baseUrl: 'https://gone.test/a.css', css: null, fetchUrl: 'https://gone.test/a.css' }] });
    const { report } = await buildStaticSite(snap, DEFAULT_EXPORT_OPTIONS, fetcher());
    expect(report.warnings.join(' ')).toMatch(/gone\.test\/a\.css/);
  });

  it('keeps svg sprite fragments on rewritten URLs', async () => {
    const snap = snapshot({ html: '<html><head></head><body><svg><image href="https://cdn.test/img/h.png#frag"/></svg></body></html>', sheets: [] });
    const { files: out } = await buildStaticSite(snap, DEFAULT_EXPORT_OPTIONS, fetcher());
    expect(out['index.html'] as string).toMatch(/href="assets\/images\/h-[0-9a-f]{8}\.png#frag"/);
  });

  it('refuses a web page served in place of an image', async () => {
    const f: Fetcher = { text: async () => '', binary: async () => ({ data: new Uint8Array([1]), contentType: 'text/html; charset=utf-8' }) };
    const { report } = await buildStaticSite(snapshot({ sheets: [] }), DEFAULT_EXPORT_OPTIONS, f);
    expect(report.assets).toHaveLength(0);
    expect(report.failed[0].reason).toMatch(/web page/);
  });
});
