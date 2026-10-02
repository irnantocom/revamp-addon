import { CssAssetKind, extractCssUrls, extractImports, mapCssUrls, pruneFontSources, removeImports, wrapMedia } from './css-bundle';
import { HtmlAssetKind, rewriteHtmlAssets } from './html-assets';
import { isTrackingUrl } from './tracking';
import { ExportOptions, ExportReport, Fetcher, PageSnapshot, SheetSource } from './types';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const MAX_ASSETS = 800;
const CONCURRENCY = 6;
const MAX_IMPORT_DEPTH = 5;

type AssetKind = HtmlAssetKind | CssAssetKind;

/** Keeps content that JavaScript normally reveals on scroll visible, since the export has no JavaScript. */
const STATIC_SAFETY_CSS = `
/* Added by Revamp: content that scripts normally reveal must stay visible in a static copy */
[data-aos] { opacity: 1 !important; transform: none !important; transition: none !important; }
.elementor-invisible { visibility: visible !important; }
`;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/bmp': 'bmp',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf',
  'application/font-woff2': 'woff2', 'application/font-woff': 'woff', 'application/x-font-ttf': 'ttf',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
};

const KNOWN_EXT = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|ogg)$/i;

/** 32-bit FNV-1a, enough to keep two different URLs with the same file name apart */
function hashUrl(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function splitHash(url: string): { clean: string; hash: string } {
  const i = url.indexOf('#');
  return i === -1 ? { clean: url, hash: '' } : { clean: url.slice(0, i), hash: url.slice(i) };
}

function localName(url: string, kind: AssetKind, contentType: string): string {
  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    // keep empty
  }
  const base = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || 'file').replace(/\?.*$/, '');
  const extMatch = base.match(KNOWN_EXT);
  const ext = extMatch ? extMatch[1].toLowerCase() : EXT_BY_TYPE[contentType.split(';')[0].trim().toLowerCase()] || (kind === 'font' ? 'woff2' : kind === 'media' ? 'mp4' : 'img');
  const stem = base.replace(KNOWN_EXT, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';
  const folder = kind === 'font' ? 'fonts' : kind === 'media' ? 'media' : 'images';
  return `assets/${folder}/${stem}-${hashUrl(url)}.${ext}`;
}

export interface BuildResult {
  files: Record<string, string | Uint8Array>;
  report: ExportReport;
}

/**
 * Turn a page snapshot into a static site: index.html, css/styles.css and downloaded assets with
 * every URL rewritten to the local copy. Assets that can't be downloaded keep their original absolute URL,
 * so the page still works online.
 */
export async function buildStaticSite(
  snapshot: PageSnapshot,
  options: ExportOptions,
  fetcher: Fetcher,
  onProgress: (message: string) => void = () => undefined
): Promise<BuildResult> {
  const warnings = [...snapshot.warnings];
  const report: ExportReport = {
    pageUrl: snapshot.url,
    title: snapshot.title,
    generatedAt: new Date().toISOString(),
    htmlBytes: 0,
    cssBytes: 0,
    assets: [],
    failed: [],
    skipped: [],
    warnings,
  };

  // ---- 1. one stylesheet, imports inlined, every url() absolute ----
  onProgress('Collecting CSS...');
  const visited = new Set<string>();

  const resolveSheet = async (source: SheetSource, depth: number): Promise<string> => {
    let css = source.css;
    let base = source.baseUrl;

    if (css === null) {
      const url = source.fetchUrl;
      if (!url || visited.has(url)) return '';
      visited.add(url);
      try {
        css = await fetcher.text(url);
        base = url;
      } catch (error) {
        warnings.push(`Stylesheet could not be downloaded and was left out: ${url} (${error instanceof Error ? error.message : error})`);
        return '';
      }
    }

    let imported = '';
    if (depth < MAX_IMPORT_DEPTH) {
      for (const imp of extractImports(css, base)) {
        if (isTrackingUrl(imp.url)) continue;
        imported += await resolveSheet({ baseUrl: imp.url, css: null, fetchUrl: imp.url, media: imp.media }, depth + 1);
      }
    }
    css = removeImports(css);

    // fn returns null, so mapCssUrls leaves each url() absolute
    css = mapCssUrls(css, base, () => null);
    return wrapMedia(`${imported}\n${css}`, source.media);
  };

  let css = '';
  for (const sheet of snapshot.sheets) css += (await resolveSheet(sheet, 0)) + '\n';
  css = pruneFontSources(css) + STATIC_SAFETY_CSS;

  // ---- 2. every asset the page and the CSS point at ----
  const wanted = new Map<string, AssetKind>();
  const want = (url: string, kind: AssetKind) => {
    const { clean } = splitHash(url);
    if (!/^https?:/i.test(clean)) return;
    if (isTrackingUrl(clean)) return;
    // a font reference wins if the same URL is used both ways
    if (!wanted.has(clean) || kind === 'font') wanted.set(clean, kind);
  };

  const doc = new DOMParser().parseFromString(snapshot.html, 'text/html');
  rewriteHtmlAssets(doc, (url, kind) => {
    want(url, kind);
    return null;
  });
  extractCssUrls(css, 'about:blank').forEach(({ url, kind }) => want(url, kind));

  // ---- 3. download ----
  const localByUrl = new Map<string, string>();
  const queue = Array.from(wanted).slice(0, MAX_ASSETS);
  if (wanted.size > MAX_ASSETS) {
    warnings.push(`The page references ${wanted.size} assets; only the first ${MAX_ASSETS} were downloaded.`);
    Array.from(wanted).slice(MAX_ASSETS).forEach(([url]) => report.skipped.push({ url, reason: 'asset limit reached' }));
  }

  const files: Record<string, string | Uint8Array> = {};
  let total = 0;
  let done = 0;

  if (!options.downloadAssets) {
    queue.forEach(([url]) => report.skipped.push({ url, reason: 'asset download turned off' }));
  } else {
    const work = queue.filter(([url, kind]) => {
      if (kind === 'media' && !options.downloadMedia) {
        report.skipped.push({ url, reason: 'video/audio not downloaded (kept as online link)' });
        return false;
      }
      return true;
    });

    let next = 0;
    const worker = async () => {
      while (next < work.length) {
        const [url, kind] = work[next++];
        try {
          const { data, contentType } = await fetcher.binary(url);
          if (data.byteLength > MAX_FILE_BYTES) throw new Error(`file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
          if (total + data.byteLength > MAX_TOTAL_BYTES) throw new Error('package size limit reached');
          if (kind !== 'media' && /text\/html/i.test(contentType)) throw new Error('server returned a web page instead of a file');

          const path = localName(url, kind, contentType);
          files[path] = data;
          localByUrl.set(url, path);
          total += data.byteLength;
          report.assets.push({ url, path, bytes: data.byteLength });
        } catch (error) {
          report.failed.push({ url, reason: error instanceof Error ? error.message : String(error) });
        }
        done++;
        onProgress(`Downloading assets ${done}/${work.length}...`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, worker));
  }

  // ---- 4. point everything at the local copies ----
  onProgress('Rewriting URLs...');
  const remap = (prefix: string) => (url: string): string | null => {
    const { clean, hash } = splitHash(url);
    const local = localByUrl.get(clean);
    return local ? `${prefix}${local}${hash}` : null;
  };

  css = mapCssUrls(css, 'about:blank', (url) => remap('../')(url));
  rewriteHtmlAssets(doc, (url) => remap('')(url));

  // Link the stylesheet, and make sure the encoding is declared
  const head = doc.head;
  if (!head.querySelector('meta[charset]')) {
    const meta = doc.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    head.insertBefore(meta, head.firstChild);
  }
  const link = doc.createElement('link');
  link.setAttribute('rel', 'stylesheet');
  link.setAttribute('href', 'css/styles.css');
  head.appendChild(link);

  const html = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}\n`;
  files['index.html'] = html;
  files['css/styles.css'] = css;
  report.htmlBytes = new TextEncoder().encode(html).length;
  report.cssBytes = new TextEncoder().encode(css).length;

  files['README.txt'] = buildReadme(report, options);
  files['report.json'] = JSON.stringify(report, null, 2);

  return { files, report };
}

function buildReadme(report: ExportReport, options: ExportOptions): string {
  const lines = [
    `Static copy of: ${report.pageUrl}`,
    `Title: ${report.title}`,
    `Created: ${report.generatedAt}`,
    '',
    'Open index.html in a browser. Files:',
    '  index.html      page markup (layout only)',
    '  css/styles.css  all CSS of the page in one file',
    '  assets/         images and fonts used by the page',
    '',
    `Assets downloaded: ${report.assets.length}`,
    `Assets that could not be downloaded: ${report.failed.length} (they still point to the original website)`,
    `Assets skipped: ${report.skipped.length}`,
    '',
    options.keepScripts ? 'JavaScript was kept (tracking scripts removed).' : 'JavaScript was removed: menus, sliders, forms and other interactive features do not run.',
    'Analytics, ads, chat widgets and cookie banners were removed.',
    'Links point to the original website.',
  ];
  if (report.warnings.length) lines.push('', 'Notes:', ...report.warnings.map((w) => `  - ${w}`));
  if (report.failed.length) lines.push('', 'Failed downloads:', ...report.failed.slice(0, 50).map((f) => `  - ${f.url}: ${f.reason}`));
  return lines.join('\n') + '\n';
}
