import React, { useState } from 'react';
import JSZip from 'jszip';
import { buildStaticSite } from '../../export/build-package';
import { DEFAULT_EXPORT_OPTIONS, ExportOptions, ExportReport, Fetcher, PageSnapshot } from '../../export/types';
import { sendToTab } from '../tab-messaging';

const FETCH_TIMEOUT_MS = 25000;

/**
 * Downloads run from this extension page: with host permissions it can read cross-origin
 * stylesheets, images and fonts that the web page itself is not allowed to.
 */
const fetcher: Fetcher = {
  async text(url) {
    const response = await fetchWithTimeout(url);
    return response.text();
  },
  async binary(url) {
    const response = await fetchWithTimeout(url);
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || '',
    };
  },
};

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const formatBytes = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const ExportPanel: React.FC = () => {
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [report, setReport] = useState<ExportReport | null>(null);

  const toggle = (key: keyof ExportOptions) => setOptions((prev) => ({ ...prev, [key]: !prev[key] }));

  const runExport = async () => {
    setBusy(true);
    setError('');
    setReport(null);
    setStatus(options.scrollFirst ? 'Reading the page (scrolling to load lazy content)...' : 'Reading the page...');

    try {
      const response = await sendToTab<{ success: boolean; error?: string; data?: PageSnapshot }>({
        type: 'EXPORT_SNAPSHOT',
        options,
      });
      if (!response?.success || !response.data) {
        throw new Error(response?.error || 'Could not read the page. Reload it and try again.');
      }

      const { files, report: result } = await buildStaticSite(response.data, options, fetcher, setStatus);

      setStatus('Creating ZIP archive...');
      const zip = new JSZip();
      Object.entries(files).forEach(([path, content]) => zip.file(path, content));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

      let host = 'page';
      try {
        host = new URL(response.data.url).hostname.replace(/^www\./, '');
      } catch {
        // keep default
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${host}-static-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      setReport(result);
      setStatus(`Export complete (${formatBytes(blob.size)}).`);
    } catch (e) {
      console.error('[Export] failed:', e);
      setStatus('');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const Option: React.FC<{ id: keyof ExportOptions; label: string; hint: string }> = ({ id, label, hint }) => (
    <label className="flex items-start gap-2 text-sm cursor-pointer">
      <input type="checkbox" className="mt-1" checked={options[id]} onChange={() => toggle(id)} disabled={busy} />
      <span>
        <span className="text-gray-900">{label}</span>
        <span className="block text-[11px] text-gray-500">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Export static site</h2>
          <p className="text-sm text-gray-600">
            Saves the page you see as <code>index.html</code> + <code>css/styles.css</code> + <code>assets/</code>, ready to open
            offline. Layout only: analytics, ads, chat widgets and cookie banners are left out.
          </p>
        </div>

        <div className="space-y-2">
          <Option id="includeDemo" label="Include demo changes" hint="Off exports the original page, without your edits." />
          <Option id="scrollFirst" label="Scroll the page first" hint="Loads lazy images and scroll-reveal content before exporting." />
          <Option id="downloadAssets" label="Download images and fonts" hint="Off keeps links to the original website." />
          <Option id="downloadMedia" label="Also download video and audio" hint="Can make the package very large." />
          <Option id="keepScripts" label="Keep JavaScript" hint="Menus and sliders may work, but scripts can break offline. Tracking scripts are always removed." />
        </div>

        <button
          onClick={runExport}
          disabled={busy}
          className={`w-full font-medium py-2 px-4 rounded-lg transition-colors ${
            busy ? 'bg-gray-400 cursor-not-allowed text-white' : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {busy ? 'Exporting...' : 'Export ZIP'}
        </button>

        {status && (
          <div
            className={`p-3 rounded-lg text-sm border ${
              status.startsWith('Export complete')
                ? 'bg-green-50 text-green-800 border-green-200'
                : 'bg-blue-50 text-blue-800 border-blue-200'
            }`}
          >
            {status}
          </div>
        )}
        {error && <div className="p-3 rounded-lg text-sm bg-red-50 text-red-800 border border-red-200">Export failed: {error}</div>}
      </div>

      {report && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2 text-sm">
          <h3 className="font-semibold text-gray-900">What was exported</h3>
          <ul className="text-xs text-gray-700 space-y-1">
            <li>HTML {formatBytes(report.htmlBytes)} · CSS {formatBytes(report.cssBytes)}</li>
            <li>{report.assets.length} asset(s) downloaded ({formatBytes(report.assets.reduce((n, a) => n + a.bytes, 0))})</li>
            {report.skipped.length > 0 && <li>{report.skipped.length} asset(s) kept as online links</li>}
          </ul>

          {report.failed.length > 0 && (
            <details className="text-xs">
              <summary className="text-amber-700 cursor-pointer">
                {report.failed.length} asset(s) could not be downloaded (still linked to the original site)
              </summary>
              <ul className="mt-1 space-y-0.5 text-gray-600 break-all max-h-32 overflow-y-auto">
                {report.failed.slice(0, 30).map((f) => (
                  <li key={f.url}>
                    {f.url} <span className="text-gray-400">— {f.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {report.warnings.length > 0 && (
            <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 list-disc list-inside space-y-0.5">
              {report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-gray-500">The ZIP also contains README.txt and report.json with these details.</p>
        </div>
      )}

      <div className="bg-gray-100 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Good to know</h3>
        <ul className="text-xs text-gray-700 space-y-1 list-disc list-inside">
          <li>Responsive layouts are kept: the full CSS, including media queries, is exported.</li>
          <li>Content drawn by JavaScript after the export (sliders, menus) will not move or open.</li>
          <li>Links keep pointing to the original website.</li>
          <li>Content inside Shadow DOM or &lt;canvas&gt; is not exported.</li>
        </ul>
      </div>
    </div>
  );
};

export default ExportPanel;
