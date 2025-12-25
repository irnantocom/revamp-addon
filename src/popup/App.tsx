import React, { useState, useEffect } from 'react';
import Inspector from './components/Inspector';
import ElementEditor from './components/ElementEditor';
import ExportPanel from './components/ExportPanel';

type Tab = 'inspector' | 'editor' | 'export';

interface InspectedElement {
  selector: {
    selector: string;
    type: string;
    confidence: string;
  };
  tagName: string;
  attributes: Record<string, string>;
  textContent: string;
  innerHTML: string;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('inspector');
  const [selectedElement, setSelectedElement] = useState<InspectedElement | null>(null);

  useEffect(() => {
    // Listen for element selection from content script
    const handleMessage = (message: any) => {
      if (message.type === 'ELEMENT_SELECTED') {
        setSelectedElement(message.payload);
        setActiveTab('editor');
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <header className="bg-blue-600 text-white px-4 py-3">
        <h1 className="text-lg font-bold">Revamp</h1>
        <p className="text-xs text-blue-100">AI Page Editor</p>
      </header>

      {/* Tabs */}
      <nav className="flex border-b border-gray-200 bg-white">
        <button
          onClick={() => setActiveTab('inspector')}
          className={`flex-1 py-3 text-sm font-medium ${
            activeTab === 'inspector'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Inspector
        </button>
        <button
          onClick={() => setActiveTab('editor')}
          className={`flex-1 py-3 text-sm font-medium ${
            activeTab === 'editor'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
          disabled={!selectedElement}
        >
          Editor
        </button>
        <button
          onClick={() => setActiveTab('export')}
          className={`flex-1 py-3 text-sm font-medium ${
            activeTab === 'export'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Export
        </button>
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'inspector' && <Inspector />}
        {activeTab === 'editor' && (
          <ElementEditor
            element={selectedElement}
            onClear={() => setSelectedElement(null)}
          />
        )}
        {activeTab === 'export' && <ExportPanel />}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-4 py-2 text-xs text-gray-500 text-center">
        Phase 1 MVP • v1.0.0
      </footer>
    </div>
  );
};

export default App;
