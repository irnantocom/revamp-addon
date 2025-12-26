import React, { useState, useEffect } from 'react';

interface APIKeys {
  openai?: string;
  claude?: string;
  gemini?: string;
  perplexity?: string;
  mistral?: string;
  cohere?: string;
  groq?: string;
  openrouter?: string;
}

const Settings: React.FC = () => {
  const [apiKeys, setApiKeys] = useState<APIKeys>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (response.success && response.data.apiKeys) {
        setApiKeys(response.data.apiKeys);
      }
    } catch (error) {
      console.error('[Settings] Failed to load:', error);
    }
  };

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: {
          apiKeys,
        },
      });

      if (response.success) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      console.error('[Settings] Failed to save:', error);
      alert('Failed to save settings');
      setSaveStatus('idle');
    }
  };

  const handleKeyChange = (provider: keyof APIKeys, value: string) => {
    setApiKeys((prev) => ({
      ...prev,
      [provider]: value,
    }));
  };

  const toggleShowKey = (provider: string) => {
    setShowKeys((prev) => ({
      ...prev,
      [provider]: !prev[provider],
    }));
  };

  const providers: { key: keyof APIKeys; label: string; placeholder: string }[] = [
    { key: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
    { key: 'claude', label: 'Anthropic Claude', placeholder: 'sk-ant-...' },
    { key: 'gemini', label: 'Google Gemini', placeholder: 'AIza...' },
    { key: 'perplexity', label: 'Perplexity', placeholder: 'pplx-...' },
    { key: 'mistral', label: 'Mistral AI', placeholder: 'mistral-...' },
    { key: 'cohere', label: 'Cohere', placeholder: 'cohere-...' },
    { key: 'groq', label: 'Groq', placeholder: 'gsk_...' },
    { key: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-...' },
  ];

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">API Keys</h2>
        <p className="text-xs text-gray-600">
          Configure API keys for AI providers. Keys are stored locally and never shared.
        </p>
      </div>

      {/* API Keys */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        {providers.map((provider) => (
          <div key={provider.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {provider.label}
            </label>
            <div className="flex gap-2">
              <input
                type={showKeys[provider.key] ? 'text' : 'password'}
                value={apiKeys[provider.key] || ''}
                onChange={(e) => handleKeyChange(provider.key, e.target.value)}
                placeholder={provider.placeholder}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={() => toggleShowKey(provider.key)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                title={showKeys[provider.key] ? 'Hide' : 'Show'}
              >
                {showKeys[provider.key] ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saveStatus === 'saving'}
        className={`w-full font-medium py-2 px-4 rounded-lg transition-colors ${
          saveStatus === 'saved'
            ? 'bg-green-600 text-white'
            : saveStatus === 'saving'
            ? 'bg-gray-400 text-white cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
      >
        {saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'saving' ? 'Saving...' : 'Save Settings'}
      </button>

      {/* Security Notice */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
        <p className="text-xs text-yellow-800">
          <strong>Security:</strong> API keys are stored in Chrome's local storage (encrypted by Chrome).
          Never share your keys or use them on untrusted extensions.
        </p>
      </div>

      {/* Documentation */}
      <div className="bg-gray-100 rounded-lg p-3">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Getting API Keys:</h3>
        <ul className="text-xs text-gray-700 space-y-1">
          <li>• <strong>OpenAI:</strong> platform.openai.com/api-keys</li>
          <li>• <strong>Claude:</strong> console.anthropic.com/settings/keys</li>
          <li>• <strong>Gemini:</strong> makersuite.google.com/app/apikey</li>
          <li>• <strong>OpenRouter:</strong> openrouter.ai/keys</li>
        </ul>
      </div>
    </div>
  );
};

export default Settings;
