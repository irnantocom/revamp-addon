/** One stylesheet's worth of CSS, in document order */
export interface SheetSource {
  /** URL that relative url()s inside this CSS resolve against */
  baseUrl: string;
  /** CSS text, or null when the page could not read it (cross-origin) and it must be fetched */
  css: string | null;
  fetchUrl?: string;
  /** Media condition of the <link>/@import, e.g. "print" */
  media?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** Cleaned document with absolute asset URLs and no stylesheets (they are in `sheets`) */
  html: string;
  sheets: SheetSource[];
  warnings: string[];
}

export interface ExportOptions {
  /** Include the changes made in demo mode (off = export the original page) */
  includeDemo: boolean;
  /** Scroll through the page first so lazy-loaded images and reveal-on-scroll content are present */
  scrollFirst: boolean;
  /** Download images and fonts into the package */
  downloadAssets: boolean;
  /** Also download <video>/<audio> files (can be very large) */
  downloadMedia: boolean;
  /** Keep non-tracking scripts (the layout is exported without JavaScript by default) */
  keepScripts: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeDemo: true,
  scrollFirst: true,
  downloadAssets: true,
  downloadMedia: false,
  keepScripts: false,
};

export interface ExportReport {
  pageUrl: string;
  title: string;
  generatedAt: string;
  htmlBytes: number;
  cssBytes: number;
  assets: Array<{ url: string; path: string; bytes: number }>;
  failed: Array<{ url: string; reason: string }>;
  skipped: Array<{ url: string; reason: string }>;
  warnings: string[];
}

export interface Fetcher {
  text(url: string): Promise<string>;
  binary(url: string): Promise<{ data: Uint8Array; contentType: string }>;
}
