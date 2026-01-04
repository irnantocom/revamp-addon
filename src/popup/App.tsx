import React, { useState, useEffect } from 'react';
import Inspector from './components/Inspector';
import ElementEditor from './components/ElementEditor';
import ExportPanel from './components/ExportPanel';
import AIChatBox from './components/AIChatBox';
import Settings from './components/Settings';

type Tab = 'inspector' | 'editor' | 'ai' | 'export' | 'settings';

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
        // Don't force tab switch - stay on current tab
        // User can manually switch to Editor if needed
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
      <nav className="flex border-b border-gray-200 bg-white overflow-x-auto">
        <button
          onClick={() => setActiveTab('inspector')}
          className={`flex-1 py-3 px-2 text-xs font-medium whitespace-nowrap ${
            activeTab === 'inspector'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Inspector
        </button>
        <button
          onClick={() => setActiveTab('editor')}
          className={`flex-1 py-3 px-2 text-xs font-medium whitespace-nowrap ${
            activeTab === 'editor'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
          disabled={!selectedElement}
        >
          Editor
        </button>
        <button
          onClick={() => setActiveTab('ai')}
          className={`flex-1 py-3 px-2 text-xs font-medium whitespace-nowrap ${
            activeTab === 'ai'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          AI Chat
        </button>
        <button
          onClick={() => setActiveTab('export')}
          className={`flex-1 py-3 px-2 text-xs font-medium whitespace-nowrap ${
            activeTab === 'export'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Export
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex-1 py-3 px-2 text-xs font-medium whitespace-nowrap ${
            activeTab === 'settings'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Settings
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
        {activeTab === 'ai' && (
          <AIChatBox
            selectedElement={selectedElement}
            onClear={() => setSelectedElement(null)}
          />
        )}
        {activeTab === 'export' && <ExportPanel />}
        {activeTab === 'settings' && <Settings />}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-4 py-2 text-xs text-gray-500 text-center">
        Phase 2: AI Integration • v1.0.0
      </footer>
    </div>
  );
};

export default App;
