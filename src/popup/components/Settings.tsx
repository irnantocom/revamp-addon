import React, { useState, useEffect } from 'react';
import {
  DEFAULT_VOICE_MODELS,
  VOICE_LANGUAGES,
  VOICE_PROVIDERS,
  defaultVoiceSettings,
  normalizeVoiceSettings,
  type VoiceProvider,
  type VoiceSettings,
} from '../../utils/voice-settings';
import { providerLabel } from '../../ai/capabilities';
import { openMicPermissionPage } from '../dictation';

interface AzureConfig {
  endpoint: string;
  apiVersion: string;
  deployment: string;
}

interface APIKeys {
  openai?: string;
  azure?: string;
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
  const [azure, setAzure] = useState<AzureConfig>({
    endpoint: '',
    apiVersion: '2024-12-01-preview',
    deployment: '',
  });
  const [voice, setVoice] = useState<VoiceSettings>(defaultVoiceSettings);
  const [azureTest, setAzureTest] = useState<{ busy: boolean; ok?: boolean; message?: string }>({ busy: false });
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
      if (response.success) {
        setVoice(normalizeVoiceSettings(response.data.voice));
      }
      if (response.success && response.data.azure) {
        setAzure((prev) => ({ ...prev, ...response.data.azure }));
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
          azure,
          voice,
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

  // Save, then make a real request so endpoint/deployment/key problems show up here, not in chat
  const testAzure = async () => {
    setAzureTest({ busy: true });
    try {
      await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', payload: { apiKeys, azure, voice } });
      const response = await chrome.runtime.sendMessage({
        type: 'VALIDATE_API_KEY',
        payload: { provider: 'azure', apiKey: apiKeys.azure || '' },
      });
      setAzureTest({
        busy: false,
        ok: !!response?.data?.isValid,
        message: response?.data?.message || response?.error,
      });
    } catch (error) {
      setAzureTest({ busy: false, ok: false, message: String(error) });
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
    { key: 'azure', label: 'Azure OpenAI', placeholder: 'Azure API key' },
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
            {provider.key === 'azure' && (
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  value={azure.endpoint}
                  onChange={(e) => setAzure((prev) => ({ ...prev, endpoint: e.target.value }))}
                  placeholder="Endpoint: https://your-resource.openai.azure.com/"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                  type="text"
                  value={azure.deployment}
                  onChange={(e) => setAzure((prev) => ({ ...prev, deployment: e.target.value }))}
                  placeholder="Deployment names, comma-separated (e.g. gpt-4o, gpt-5-mini)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500">
                  Each deployment appears as a model in AI Chat. Test Azure connection checks the first one.
                </p>
                <input
                  type="text"
                  value={azure.apiVersion}
                  onChange={(e) => setAzure((prev) => ({ ...prev, apiVersion: e.target.value }))}
                  placeholder="API version: 2024-12-01-preview"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  onClick={testAzure}
                  disabled={azureTest.busy}
                  className="w-full border border-gray-300 rounded-lg py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  {azureTest.busy ? 'Testing...' : 'Test Azure connection'}
                </button>
                {azureTest.message && (
                  <p className={`text-xs break-words ${azureTest.ok ? 'text-green-700' : 'text-red-600'}`}>
                    {azureTest.message}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Voice */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Voice dictation</h2>
          <p className="text-xs text-gray-600">
            The microphone button in AI Chat and in notes types what you say. Nothing is sent until you send or save.
          </p>
        </div>
        <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
          <input
            type="radio"
            name="voice-engine"
            className="mt-1"
            checked={voice.engine === 'browser'}
            onChange={() => setVoice((prev) => ({ ...prev, engine: 'browser' }))}
          />
          <span>
            Chrome speech recognition
            <span className="block text-xs text-gray-500">
              Free, no key needed. Chrome sends the audio to Google's speech service.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
          <input
            type="radio"
            name="voice-engine"
            className="mt-1"
            checked={voice.engine === 'provider'}
            onChange={() => setVoice((prev) => ({ ...prev, engine: 'provider' }))}
          />
          <span>
            AI provider
            <span className="block text-xs text-gray-500">
              Records a clip and sends it to the provider below with your API key. Claude cannot transcribe audio.
            </span>
          </span>
        </label>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
          <select
            value={voice.language}
            onChange={(e) => setVoice((prev) => ({ ...prev, language: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            {VOICE_LANGUAGES.map((l) => (
              <option key={l.tag} value={l.tag}>{l.label}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={openMicPermissionPage}
          className="w-full border border-gray-300 rounded-lg py-2 text-sm hover:bg-gray-50"
        >
          Allow microphone
        </button>
        <p className="text-xs text-gray-500">
          Use this once if the microphone button says access is blocked. Chrome shows its permission prompt in a new tab.
        </p>
        {voice.engine === 'provider' && (
          <div className="space-y-2">
            <select
              value={voice.provider}
              onChange={(e) => {
                const provider = e.target.value as VoiceProvider;
                setVoice((prev) => ({ ...prev, provider, model: DEFAULT_VOICE_MODELS[provider] }));
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              aria-label="Transcription provider"
            >
              {VOICE_PROVIDERS.map((p) => (
                <option key={p} value={p}>{providerLabel(p)}</option>
              ))}
            </select>
            <input
              type="text"
              value={voice.model}
              onChange={(e) => setVoice((prev) => ({ ...prev, model: e.target.value }))}
              placeholder={voice.provider === 'azure' ? 'Transcription deployment name (a Whisper deployment)' : 'Transcription model'}
              aria-label={voice.provider === 'azure' ? 'Transcription deployment' : 'Transcription model'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500">
              Uses the API key above{voice.provider === 'azure' ? ', plus the Azure endpoint and API version' : ''}.
              Recordings stop after 2 minutes and are not stored.
            </p>
          </div>
        )}
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
