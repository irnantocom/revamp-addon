import React, { useState, useEffect, useRef } from 'react';
import ElementEditor from './components/ElementEditor';
import ExportPanel from './components/ExportPanel';
import AIChatBox from './components/AIChatBox';
import Settings from './components/Settings';
import DemoPanel from './components/DemoPanel';
import TokenUsagePanel from './components/TokenUsagePanel';
import NoteDictationBridge from './components/NoteDictationBridge';
import { InspectedElement } from '../types/inspector';
import { purgeOrphanAttachmentDatabases } from '../utils/attachment-store';
import { useInspector } from './use-inspector';

type Tab = 'editor' | 'ai' | 'demo' | 'export' | 'settings' | 'tokens';

const TABS: Array<[Tab, string]> = [
  ['editor', 'Editor'],
  ['ai', 'AI Chat'],
  ['demo', 'Demo'],
  ['export', 'Export'],
  ['settings', 'Settings'],
  ['tokens', 'Tokens'],
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('editor');
  const [selectedElement, setSelectedElement] = useState<InspectedElement | null>(null);
  // Prompt handed from another tab (e.g. notes) to the AI chat input
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const inspector = useInspector();

  // The chat holds an unsent draft and its attachments in component state, so once opened it is
  // hidden instead of unmounted when another tab is shown
  const aiOpened = useRef(false);
  if (activeTab === 'ai') aiOpened.current = true;

  useEffect(() => {
    // Files of tabs that were closed stay in IndexedDB until someone removes them
    chrome.tabs
      .query({})
      .then((tabs) => purgeOrphanAttachmentDatabases(tabs.flatMap((t) => (t.id === undefined ? [] : [t.id]))))
      .catch((error) => console.warn('[Revamp] Could not remove attachments of closed tabs:', error));
  }, []);

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
      <NoteDictationBridge />
      {/* Header */}
      <header className="bg-blue-600 text-white px-4 py-3">
        <h1 className="text-lg font-bold">Revamp</h1>
        <p className="text-xs text-blue-100">AI Page Editor</p>
      </header>

      {/* Tabs */}
      <nav className="flex border-b border-gray-200 bg-white overflow-x-auto">
        {TABS.map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 px-2 text-xs font-medium whitespace-nowrap ${
              activeTab === tab
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'editor' && (
          <ElementEditor
            element={selectedElement}
            onClear={() => setSelectedElement(null)}
            onElementUpdate={setSelectedElement}
            inspector={inspector}
          />
        )}
        {aiOpened.current && (
          <div className={activeTab === 'ai' ? 'h-full' : 'hidden'}>
            <AIChatBox
              inspector={inspector}
              selectedElement={selectedElement}
              onClear={() => setSelectedElement(null)}
              initialPrompt={pendingPrompt}
              onPromptConsumed={() => setPendingPrompt(null)}
            />
          </div>
        )}
        {activeTab === 'demo' && (
          <DemoPanel
            onAskAI={(prompt) => {
              setPendingPrompt(prompt);
              setActiveTab('ai');
            }}
          />
        )}
        {activeTab === 'export' && <ExportPanel />}
        {activeTab === 'settings' && <Settings />}
        {activeTab === 'tokens' && <TokenUsagePanel />}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-4 py-2 text-xs text-gray-500 text-center">
        v1.0.0
      </footer>
    </div>
  );
};

export default App;
