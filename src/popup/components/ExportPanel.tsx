import React, { useState } from 'react';
import JSZip from 'jszip';

const ExportPanel: React.FC = () => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');

  const exportHTML = async () => {
    setIsExporting(true);
    setExportStatus('Fetching page HTML...');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) {
        throw new Error('No active tab found');
      }

      // Get page HTML from content script
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_HTML' });

      if (!response.success) {
        throw new Error('Failed to fetch page HTML');
      }

      setExportStatus('Generating export package...');

      // Create ZIP
      const zip = new JSZip();

      // Add HTML
      zip.file('index.html', response.data);

      // Add README
      const readme = `# Exported Page

This page was exported using Revamp - AI Page Editor

## Files
- index.html: The main HTML file

## Notes
- This is a basic export (Phase 1 MVP)
- CSS and assets are not yet extracted (coming in Phase 2)
- Some interactive features may not work without the original server

## Next Steps
Phase 2 will include:
- CSS extraction and bundling
- Asset downloading (images, videos, fonts)
- JavaScript bundling
- Full static site generation
`;

      zip.file('README.md', readme);

      setExportStatus('Creating ZIP archive...');

      // Generate ZIP
      const blob = await zip.generateAsync({ type: 'blob' });

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `revamp-export-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      setExportStatus('Export complete!');
      setTimeout(() => {
        setExportStatus('');
      }, 3000);
    } catch (error) {
      console.error('[Popup] Export failed:', error);
      setExportStatus(`Export failed: ${error}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Export HTML */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Export as HTML</h2>
        <p className="text-sm text-gray-600 mb-4">
          Export the current page as a static HTML file. This will download a ZIP file
          containing the HTML.
        </p>

        <button
          onClick={exportHTML}
          disabled={isExporting}
          className={`w-full font-medium py-2 px-4 rounded-lg transition-colors ${
            isExporting
              ? 'bg-gray-400 cursor-not-allowed text-white'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {isExporting ? 'Exporting...' : 'Export HTML'}
        </button>

        {exportStatus && (
          <div
            className={`mt-3 p-3 rounded-lg text-sm ${
              exportStatus.includes('failed')
                ? 'bg-red-50 text-red-800 border border-red-200'
                : exportStatus.includes('complete')
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-blue-50 text-blue-800 border border-blue-200'
            }`}
          >
            {exportStatus}
          </div>
        )}
      </div>

      {/* Phase 1 Limitations */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-yellow-900 mb-2">Phase 1 Limitations</h3>
        <ul className="text-xs text-yellow-800 space-y-1 list-disc list-inside">
          <li>Only exports raw HTML (no CSS extraction yet)</li>
          <li>Assets (images, fonts) are not downloaded</li>
          <li>External stylesheets remain as external references</li>
          <li>JavaScript may not function properly</li>
        </ul>
      </div>

      {/* Coming Soon */}
      <div className="bg-gray-100 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Coming in Phase 2:</h3>
        <ul className="text-xs text-gray-700 space-y-1 list-disc list-inside">
          <li>CSS extraction and bundling</li>
          <li>Asset downloading (images, videos, fonts)</li>
          <li>Computed styles capture</li>
          <li>URL rewriting for local paths</li>
          <li>Complete offline static site generation</li>
        </ul>
      </div>
    </div>
  );
};

export default ExportPanel;
