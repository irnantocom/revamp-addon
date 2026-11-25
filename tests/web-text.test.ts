import { describe, expect, it } from 'vitest';
import { extractWebText, fetchWebText, wantsContent } from '../src/utils/web-text';

describe('wantsContent', () => {
  it('recognises a request to take a page\'s text, in English and Indonesian', () => {
    expect(wantsContent('ganti konten halaman ini dengan konten dari referensi page https://x.test')).toBe(true);
    expect(wantsContent('replace the content with the text of https://x.test')).toBe(true);
    expect(wantsContent('pakai isi dan judul dari situs itu')).toBe(true);
  });

  it('leaves out requests that only need the pictures or the look', () => {
    expect(wantsContent('use the pictures from https://x.test')).toBe(false);
    expect(wantsContent('apply the colours and font of https://x.test')).toBe(false);
  });
});

const HTML = `
<html><head><title>Cruise</title><style>.a{}</style><script>var x = "not text";</script></head>
<body>
  <nav><a href="/">Home</a><a href="/events">Events</a></nav>
  <main>
    <section>
      <h1>Christmas Cruise 2026</h1>
      <p>Sail the Singapore Strait <b>in style</b>.</p>
      <a class="btn" href="/book">Book now</a>
    </section>
    <section>
      <h2>Included</h2>
      <ul><li>Dinner buffet</li><li>Live band</li></ul>
      <table><tr><th>Date</th><th>Time</th></tr><tr><td>23 Dec</td><td>6pm</td></tr></table>
      <div>Plain text in a div</div>
      <p style="display:none">Hidden paragraph</p>
      <div class="cookie-banner"><p>We use cookies</p></div>
    </section>
  </main>
  <footer><p>Footer address</p></footer>
</body></html>`;

describe('extractWebText', () => {
  const { lines, truncated } = extractWebText(HTML);
  const text = lines.join('\n');

  it('lists headings, paragraphs, list items, buttons, table rows and loose text in page order', () => {
    expect(lines).toContain('h1: Christmas Cruise 2026');
    expect(lines).toContain('p: Sail the Singapore Strait in style.');
    expect(lines).toContain('button: Book now');
    expect(lines).toContain('h2: Included');
    expect(lines).toContain('li: Dinner buffet');
    expect(lines).toContain('li: Live band');
    expect(lines).toContain('row: Date | Time');
    expect(lines).toContain('row: 23 Dec | 6pm');
    expect(lines).toContain('Plain text in a div');
    expect(text.indexOf('Christmas Cruise')).toBeLessThan(text.indexOf('Included'));
    expect(truncated).toBe(false);
  });

  it('leaves out scripts, styles, navigation, footer, hidden elements and cookie banners', () => {
    expect(text).not.toMatch(/not text|Home|Events|Footer address|Hidden paragraph|cookies/);
  });

  it('separates the sections with a blank line', () => {
    expect(lines.indexOf('')).toBeGreaterThan(0);
  });

  it('cuts at the budget and says so', () => {
    const long = `<body>${Array.from({ length: 400 }, (_, i) => `<p>${`word${i} `.repeat(30)}</p>`).join('')}</body>`;
    const result = extractWebText(long);
    expect(result.truncated).toBe(true);
    expect(result.lines.join('\n').length).toBeLessThanOrEqual(25_000);
  });
});

const page = (body: string, init: ResponseInit = {}) =>
  (async () => new Response(body, { headers: { 'content-type': 'text/html' }, ...init })) as unknown as typeof fetch;

describe('fetchWebText', () => {
  it('returns the page text', async () => {
    const result = await fetchWebText('https://x.test/a', page(HTML));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source.page).toBe('https://x.test/a');
      expect(result.source.lines).toContain('h1: Christmas Cruise 2026');
    }
  });

  it('reports an HTTP error, a non-page and an unreachable site', async () => {
    expect(await fetchWebText('https://x.test', page('no', { status: 404 }))).toEqual({ ok: false, error: 'the site answered HTTP 404' });
    expect(await fetchWebText('https://x.test', page('{}', { headers: { 'content-type': 'application/json' } }))).toEqual({
      ok: false,
      error: 'the address is not a web page',
    });
    const down = (async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    expect(await fetchWebText('https://x.test', down)).toEqual({ ok: false, error: 'the site could not be reached' });
  });

  it('reports a page that builds its text with JavaScript', async () => {
    const result = await fetchWebText('https://x.test', page('<html><body><div id="root"></div><script>render()</script></body></html>'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JavaScript/);
  });
});
