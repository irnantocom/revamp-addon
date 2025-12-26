import React, { useState } from 'react';

// Helper to ensure content script is ready
const ensureContentScript = async (tabId: number): Promise<boolean> => {
  const maxRetries = 10;
  const retryDelay = 200;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      console.log(`[Inspector] Content script ready (attempt ${i + 1})`);
      return true;
    } catch (error) {
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  console.error('[Inspector] Content script failed to load after retries');
  return false;
};

const Inspector: React.FC = () => {
  const [isInspecting, setIsInspecting] = useState(false);

  const startInspector = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      // Ensure content script is loaded
      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        alert('Failed to load inspector. Please refresh the page and try again.');
        return;
      }

      await chrome.tabs.sendMessage(tab.id, { type: 'START_INSPECTOR' });
      setIsInspecting(true);
    } catch (error) {
      console.error('[Popup] Failed to start inspector:', error);
      alert('Failed to start inspector: ' + error);
    }
  };

  const stopInspector = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      await ensureContentScript(tab.id);

      await chrome.tabs.sendMessage(tab.id, { type: 'STOP_INSPECTOR' });
      setIsInspecting(false);
    } catch (error) {
      console.error('[Popup] Failed to stop inspector:', error);
    }
  };

  return (
    <div className="p-4">
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Element Inspector</h2>
        <p className="text-sm text-gray-600 mb-3">
          Click the button below to start inspecting elements on the page. Hover over elements
          to highlight them, then click to select.
        </p>
        
        <div className="bg-amber-50 border border-amber-200 rounded p-2 mb-4 text-xs text-amber-800">
          💡 <strong>Tip:</strong> Keep this popup open while inspecting. Click elements on the page, then use the Editor or AI Chat tabs.
        </div>

        {!isInspecting ? (
          <button
            onClick={startInspector}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Start Inspector
          </button>
        ) : (
          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              <p className="font-medium">Inspector Active</p>
              <p className="text-xs mt-1">
                Hover over elements to highlight them, then click to select.
              </p>
            </div>
            <button
              onClick={stopInspector}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Stop Inspector
            </button>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="mt-4 bg-gray-100 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">How to use:</h3>
        <ol className="text-xs text-gray-700 space-y-1 list-decimal list-inside">
          <li>Click "Start Inspector" to begin</li>
          <li>Hover over page elements to highlight them</li>
          <li>Click an element to select it</li>
          <li>Switch to the "Editor" tab to modify the element</li>
        </ol>
      </div>
    </div>
  );
};

export default Inspector;
