import React, { useState, useEffect, useRef } from 'react';

// Helper to ensure content script is ready
const ensureContentScript = async (tabId: number): Promise<boolean> => {
  const maxRetries = 10;
  const retryDelay = 200;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      console.log(`[AI Chat] Content script ready (attempt ${i + 1})`);
      return true;
    } catch (error) {
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  console.error('[AI Chat] Content script failed to load after retries');
  return false;
};

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  action?: {
    type: 'text' | 'css' | 'html' | 'attribute';
    value: any;
    attribute?: string;
  };
}

interface Props {
  selectedElement?: {
    selector: { selector: string; type: string };
    tagName: string;
    textContent: string;
  } | null;
  onClear?: () => void;
}

const AIChatBox: React.FC<Props> = ({ selectedElement, onClear }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [inspectorActive, setInspectorActive] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [apiKeysLoaded, setApiKeysLoaded] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Provider labels for display
  const providerLabels: Record<string, string> = {
    openai: 'OpenAI',
    claude: 'Claude',
    gemini: 'Gemini',
    perplexity: 'Perplexity',
    mistral: 'Mistral',
    cohere: 'Cohere',
    groq: 'Groq',
    openrouter: 'OpenRouter',
  };

  // Default model options (fallback if API fetch fails)
  const defaultModelOptions: Record<string, string[]> = {
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    claude: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    gemini: ['gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.0-flash-exp'],
    perplexity: ['llama-3.1-sonar-large-128k-online', 'llama-3.1-sonar-small-128k-online'],
    mistral: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo'],
    cohere: ['command-r-plus', 'command-r', 'command'],
    groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    openrouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-exp:free'],
  };

  // Load API keys and determine available providers
  useEffect(() => {
    const loadApiKeys = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        if (response.success && response.data.apiKeys) {
          const keys = response.data.apiKeys;
          setApiKeys(keys);
          
          // Filter providers that have API keys set
          const available = Object.entries(keys)
            .filter(([_, value]) => value && (value as string).trim() !== '')
            .map(([key, _]) => key);
          
          setAvailableProviders(available);
          
          // Set default provider to first available
          if (available.length > 0) {
            setProvider(available[0]);
          }
        }
        setApiKeysLoaded(true);
      } catch (error) {
        console.error('[AI Chat] Failed to load API keys:', error);
        setApiKeysLoaded(true);
      }
    };

    loadApiKeys();
  }, []);

  // Fetch models when provider changes
  useEffect(() => {
    const fetchModelsForProvider = async () => {
      if (!provider || !apiKeys[provider]) return;

      // Check if we already have models for this provider
      if (providerModels[provider] && providerModels[provider].length > 0) {
        setModel(providerModels[provider][0]);
        return;
      }

      setLoadingModels(true);
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'FETCH_MODELS',
          payload: { provider, apiKey: apiKeys[provider] }
        });

        if (response.success && response.data && response.data.length > 0) {
          setProviderModels(prev => ({
            ...prev,
            [provider]: response.data
          }));
          setModel(response.data[0]);
        } else {
          // Fallback to defaults
          const defaults = defaultModelOptions[provider] || [];
          setProviderModels(prev => ({
            ...prev,
            [provider]: defaults
          }));
          setModel(defaults[0] || '');
        }
      } catch (error) {
        console.error('[AI Chat] Failed to fetch models:', error);
        // Fallback to defaults
        const defaults = defaultModelOptions[provider] || [];
        setProviderModels(prev => ({
          ...prev,
          [provider]: defaults
        }));
        setModel(defaults[0] || '');
      } finally {
        setLoadingModels(false);
      }
    };

    fetchModelsForProvider();
  }, [provider, apiKeys]);

  // Listen for inspector state changes from content script
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'INSPECTOR_STATE_CHANGED') {
        setInspectorActive(message.isActive);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab');

      // Ensure content script is loaded
      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        throw new Error('Failed to initialize content script. Please refresh the page.');
      }

      // Get detailed element info if selected
      let elementContext = 'No element selected';
      if (selectedElement) {
        try {
          const elementInfoResponse = await chrome.tabs.sendMessage(tab.id, {
            type: 'GET_ELEMENT_INFO',
            payload: { selector: selectedElement.selector },
          });

        if (elementInfoResponse.success) {
          const info = elementInfoResponse.data;
          elementContext = `Selected element: <${info.tagName}>
Selector: ${selectedElement.selector.selector}
Current text: "${info.textContent}"
Current styles: ${JSON.stringify(info.computedStyles, null, 2)}
Attributes: ${JSON.stringify(info.attributes, null, 2)}`;
        } else {
          elementContext = `Selected element: <${selectedElement.tagName}> with selector "${selectedElement.selector.selector}"`;
        }
        } catch (elementError) {
          console.warn('[AI Chat] Could not get element info:', elementError);
          elementContext = `Selected element: <${selectedElement.tagName}> with selector "${selectedElement.selector.selector}"`;
        }
      }

      // Send to background worker with enhanced prompt
      const response = await chrome.runtime.sendMessage({
        type: 'AI_REQUEST',
        payload: {
          provider,
          model,
          messages: [
            {
              role: 'system',
              content: `You are an AI assistant helping with web page transformation and DOM manipulation.

${elementContext}

Your role:
1. Analyze the user's request about the selected element
2. Provide clear, actionable suggestions
3. When suggesting changes, format them as JSON in code blocks like this:

For TEXT changes:
\`\`\`json
{"action": "text", "value": "New text content here"}
\`\`\`

For CSS changes:
\`\`\`json
{"action": "css", "value": {"property-name": "value", "another-property": "value"}}
\`\`\`

For HTML changes:
\`\`\`json
{"action": "html", "value": "<div>New HTML content</div>"}
\`\`\`

For ATTRIBUTE changes:
\`\`\`json
{"action": "attribute", "attribute": "src", "value": "new-value"}
\`\`\`

Always explain what you're doing and why. Users can click "Apply" button to execute your suggestions.
use context7`,
            },
            ...messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            {
              role: 'user',
              content: input,
            },
          ],
        },
      });

      if (response.success) {
        // Parse AI response for actionable changes
        const aiContent = response.data.content;
        const actionMatch = aiContent.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        
        let action;
        if (actionMatch) {
          try {
            action = JSON.parse(actionMatch[1]);
          } catch (e) {
            console.error('[AI Chat] Failed to parse action:', e);
          }
        }

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: aiContent,
          timestamp: Date.now(),
          action,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        throw new Error(response.error || 'AI request failed');
      }
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error}. Please check your API key in Settings.`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    console.log('[AI Chat] Clear button clicked, messages count:', messages.length);
    if (messages.length === 0) {
      console.log('[AI Chat] No messages to clear');
      return;
    }
    if (confirm('Clear all chat messages?')) {
      console.log('[AI Chat] Clearing messages');
      setMessages([]);
    } else {
      console.log('[AI Chat] Clear cancelled by user');
    }
  };

  const toggleInspector = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      // Ensure content script is loaded
      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        alert('Failed to load inspector. Please refresh the page and try again.');
        return;
      }

      if (inspectorActive) {
        await chrome.tabs.sendMessage(tab.id, { type: 'STOP_INSPECTOR' });
        setInspectorActive(false);
      } else {
        await chrome.tabs.sendMessage(tab.id, { type: 'START_INSPECTOR' });
        setInspectorActive(true);
      }
    } catch (error) {
      console.error('[AI Chat] Failed to toggle inspector:', error);
      alert('Failed to start inspector: ' + error);
    }
  };

  const applyAction = async (message: Message) => {
    if (!message.action || !selectedElement) {
      alert('No action to apply or no element selected');
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab');

      // Ensure content script is loaded
      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        alert('Failed to apply changes. Please refresh the page.');
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_AI_CHANGE',
        payload: {
          ...message.action,
          selector: selectedElement.selector,
        },
      });

      if (response.success) {
        alert('✓ Changes applied successfully!');
      } else {
        alert(`Failed to apply: ${response.error}`);
      }
    } catch (error) {
      alert(`Error: ${error}`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900">AI Assistant</h3>
          <div className="flex gap-2">
            <button
              onClick={toggleInspector}
              className={`text-xs px-3 py-1 rounded ${
                inspectorActive
                  ? 'bg-red-100 text-red-700 border border-red-300'
                  : 'bg-blue-100 text-blue-700 border border-blue-300'
              }`}
              title="Toggle Inspector"
            >
              {inspectorActive ? '⊗ Stop' : '⊕ Inspector'}
            </button>
            <button
              onClick={clearChat}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                messages.length === 0
                  ? 'text-gray-400 cursor-not-allowed'
                  : 'text-gray-600 hover:text-red-600 hover:bg-red-50'
              }`}
              disabled={messages.length === 0}
              title={messages.length === 0 ? 'No messages to clear' : 'Clear all messages'}
            >
              Clear Chat
            </button>
          </div>
        </div>

        {/* Element context banner */}
        {selectedElement && (
          <div className="bg-green-50 border border-green-200 rounded p-2 text-xs mb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-green-800">Selected:</span>
                <code className="bg-green-100 px-1 py-0.5 rounded text-green-900">
                  {selectedElement.tagName}
                </code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-600 text-xs">✓ Ready</span>
                {onClear && (
                  <button
                    onClick={onClear}
                    className="text-xs text-green-700 hover:text-red-600 hover:underline transition-colors"
                    title="Clear selected element"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="mt-1 text-green-700 truncate" title={selectedElement.selector.selector}>
              {selectedElement.selector.selector}
            </div>
          </div>
        )}

        {/* Provider selection - Only show providers with API keys */}
        {!apiKeysLoaded ? (
          <div className="text-xs text-gray-500 text-center py-2">Loading providers...</div>
        ) : availableProviders.length === 0 ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-800">
            ⚠️ No API keys configured. Go to <strong>Settings</strong> tab to add your API keys.
          </div>
        ) : (
          <div className="flex gap-2">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
            >
              {availableProviders.map((p) => (
                <option key={p} value={p}>
                  {providerLabels[p] || p}
                </option>
              ))}
            </select>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
              disabled={loadingModels}
            >
              {loadingModels ? (
                <option value="">Loading models...</option>
              ) : (
                (providerModels[provider] || defaultModelOptions[provider] || []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))
              )}
            </select>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 text-xs mt-8">
            <p className="mb-2">👋 Hi! I can help you with:</p>
            <ul className="text-xs text-left max-w-xs mx-auto space-y-1">
              <li>• Rewriting text content</li>
              <li>• Generating CSS styles</li>
              <li>• Modifying HTML structure</li>
              <li>• Changing attributes (src, href, etc.)</li>
              <li>• Layout suggestions</li>
            </ul>
            <div className="mt-3 text-xs bg-blue-50 border border-blue-200 rounded p-2">
              <strong>Quick start:</strong><br/>
              1. Click "⊕ Inspector" to select element<br/>
              2. Ask me to modify it<br/>
              3. Click "✓ Apply" on my suggestions
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-900'
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
              
              {/* Apply button for AI suggestions with actions */}
              {message.role === 'assistant' && message.action && selectedElement && (
                <button
                  onClick={() => applyAction(message)}
                  className="mt-2 w-full bg-green-600 hover:bg-green-700 text-white text-xs font-medium py-1 px-3 rounded transition-colors"
                >
                  ✓ Apply This Change
                </button>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <div className="animate-spin h-3 w-3 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                <span className="text-gray-600">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-3 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder={
              selectedElement
                ? `Ask about ${selectedElement.tagName}...`
                : 'Select element first or ask general question...'
            }
            className="flex-1 text-sm border border-gray-300 rounded px-3 py-2"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatBox;
