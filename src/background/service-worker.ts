/**
 * Background Service Worker (Manifest V3)
 * Handles extension lifecycle, messaging, and AI requests routing
 */

import { OpenAIProvider } from '../ai/openai-provider';
import { ClaudeProvider } from '../ai/claude-provider';
import { GeminiProvider } from '../ai/gemini-provider';
import { AzureOpenAIProvider } from '../ai/azure-openai-provider';
import type { AIRequest } from '../ai/provider-interface';

interface Message {
  type: string;
  payload?: any;
}

interface MessageResponse {
  success: boolean;
  data?: any;
  error?: string;
}

// Handle extension icon click to toggle floating panel
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  
  try {
    // Send message to content script to toggle panel
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
  } catch (error) {
    console.error('[Background] Failed to toggle panel:', error);
    // If content script not loaded, inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/content-script.js'],
      });
      // Wait and try again
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tab.id!, { type: 'TOGGLE_PANEL' });
      }, 500);
    } catch (injectError) {
      console.error('[Background] Failed to inject content script:', injectError);
    }
  }
});

// Extension installation/update handler
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Revamp] Extension installed');
    // Initialize default settings
    chrome.storage.local.set({
      settings: {
        aiProvider: 'openai',
        apiKeys: {},
      },
    });
  } else if (details.reason === 'update') {
    console.log('[Revamp] Extension updated');
  }
});

// Message handler for content scripts and popup
chrome.runtime.onMessage.addListener(
  (
    message: Message,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ) => {
    console.log('[Background] Received message:', message.type);

    switch (message.type) {
      case 'PING':
        sendResponse({ success: true, data: 'pong' });
        break;

      case 'GET_SETTINGS':
        handleGetSettings(sendResponse);
        return true; // Keep channel open for async response

      case 'UPDATE_SETTINGS':
        handleUpdateSettings(message.payload, sendResponse);
        return true;

      case 'CAPTURE_VISIBLE_TAB':
        chrome.tabs
          .captureVisibleTab(sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT, { format: 'png' })
          .then((dataUrl) => sendResponse({ success: true, data: dataUrl }))
          .catch((error) => sendResponse({ success: false, error: String(error) }));
        return true;

      case 'AI_REQUEST':
        handleAIRequest(message.payload, sendResponse);
        return true;

      case 'FETCH_MODELS':
        handleFetchModels(message.payload, sendResponse);
        return true;

      case 'VALIDATE_API_KEY':
        handleValidateApiKey(message.payload, sendResponse);
        return true;

      case 'INJECT_CONTENT_SCRIPT':
        handleInjectContentScript(sender.tab?.id, sendResponse);
        return true;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }

    return false;
  }
);

// Get extension settings
async function handleGetSettings(sendResponse: (response: MessageResponse) => void) {
  try {
    const result = await chrome.storage.local.get('settings');
    sendResponse({ success: true, data: result.settings || {} });
  } catch (error) {
    sendResponse({ success: false, error: String(error) });
  }
}

// Update extension settings
async function handleUpdateSettings(
  settings: any,
  sendResponse: (response: MessageResponse) => void
) {
  try {
    await chrome.storage.local.set({ settings });
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: String(error) });
  }
}

// Handle AI requests (to be expanded in Phase 2)
async function handleAIRequest(
  payload: AIRequest,
  sendResponse: (response: MessageResponse) => void
) {
  try {
    // Get API keys from storage
    const result = await chrome.storage.local.get('settings');
    const apiKeys = result.settings?.apiKeys || {};
    const azure = result.settings?.azure || {};

    // Check if API key exists for the provider
    const apiKey = apiKeys[payload.provider];
    if (!apiKey) {
      sendResponse({
        success: false,
        error: `No API key configured for ${payload.provider}. Please add it in Settings.`,
      });
      return;
    }

    // Initialize provider
    let provider;
    switch (payload.provider) {
      case 'openai':
        provider = new OpenAIProvider({ apiKey });
        break;
      case 'azure':
        if (!azure.endpoint || !azure.apiVersion || !azure.deployment) {
          sendResponse({
            success: false,
            error: 'Azure OpenAI endpoint, API version and deployment must be set in Settings.',
          });
          return;
        }
        provider = new AzureOpenAIProvider({
          apiKey,
          endpoint: azure.endpoint,
          apiVersion: azure.apiVersion,
          deployment: azure.deployment,
        });
        break;
      case 'claude':
        provider = new ClaudeProvider({ apiKey });
        break;
      case 'gemini':
        provider = new GeminiProvider({ apiKey });
        break;
      default:
        sendResponse({
          success: false,
          error: `Provider ${payload.provider} not yet implemented`,
        });
        return;
    }

    // Make AI request
    const response = await provider.generateCompletion(
      payload.messages,
      payload.model,
      {
        // The chat sends these nested under `options`; accept both shapes
        temperature: payload.temperature ?? (payload as any).options?.temperature,
        maxTokens: payload.maxTokens ?? (payload as any).options?.maxTokens,
        stream: payload.stream,
      }
    );

    if (response.success) {
      sendResponse({
        success: true,
        data: response,
      });
    } else {
      console.error(`[Background] ${payload.provider} request failed:`, response.error);
      sendResponse({
        success: false,
        error: response.error || 'AI request failed',
      });
    }
  } catch (error) {
    console.error('[Background] AI request error:', error);
    sendResponse({ 
      success: false, 
      error: `Error: ${error instanceof Error ? error.message : String(error)}. Please check your API key in Settings.`
    });
  }
}

// Inject content script dynamically
async function handleInjectContentScript(
  tabId: number | undefined,
  sendResponse: (response: MessageResponse) => void
) {
  if (!tabId) {
    sendResponse({ success: false, error: 'No tab ID provided' });
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content-script.js'],
    });
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: String(error) });
  }
}

// Fetch available models for a provider
async function handleFetchModels(
  payload: { provider: string; apiKey: string },
  sendResponse: (response: MessageResponse) => void
) {
  try {
    let models: string[] = [];

    switch (payload.provider) {
      case 'azure': {
        const stored = await chrome.storage.local.get('settings');
        const deployment = stored.settings?.azure?.deployment;
        models = deployment ? [deployment] : [];
        break;
      }
      case 'openai':
        models = await fetchOpenAIModels(payload.apiKey);
        break;
      case 'gemini':
        models = await fetchGeminiModels(payload.apiKey);
        break;
      case 'claude':
        models = await fetchClaudeModels(payload.apiKey);
        break;
      case 'groq':
        models = await fetchGroqModels(payload.apiKey);
        break;
      default:
        // Return default models for other providers
        models = getDefaultModels(payload.provider);
    }

    sendResponse({ success: true, data: models });
  } catch (error) {
    sendResponse({ success: false, error: String(error) });
  }
}

// Validate API key for a provider
async function handleValidateApiKey(
  payload: { provider: string; apiKey: string },
  sendResponse: (response: MessageResponse) => void
) {
  try {
    let isValid = false;

    switch (payload.provider) {
      case 'openai':
        isValid = await validateOpenAIKey(payload.apiKey);
        break;
      case 'gemini':
        isValid = await validateGeminiKey(payload.apiKey);
        break;
      case 'claude':
        isValid = await validateClaudeKey(payload.apiKey);
        break;
      default:
        // Assume valid for other providers (can't easily validate)
        isValid = payload.apiKey.length > 10;
    }

    sendResponse({ success: true, data: { isValid } });
  } catch (error) {
    sendResponse({ success: false, error: String(error) });
  }
}

// ============ API-specific model fetchers ============

async function fetchOpenAIModels(apiKey: string): Promise<string[]> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) return getDefaultModels('openai');

    const data = await response.json();
    // Filter for GPT models only and sort by relevance
    const gptModels = data.data
      .filter((m: any) => m.id.includes('gpt') && !m.id.includes('instruct'))
      .map((m: any) => m.id)
      .sort((a: string, b: string) => {
        // Prioritize gpt-4o, gpt-4, gpt-3.5
        if (a.includes('gpt-4o')) return -1;
        if (b.includes('gpt-4o')) return 1;
        if (a.includes('gpt-4')) return -1;
        if (b.includes('gpt-4')) return 1;
        return a.localeCompare(b);
      });

    return gptModels.length > 0 ? gptModels : getDefaultModels('openai');
  } catch {
    return getDefaultModels('openai');
  }
}

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );

    if (!response.ok) return getDefaultModels('gemini');

    const data = await response.json();
    // Filter for generateContent-supported models
    const geminiModels = data.models
      .filter((m: any) => 
        m.name.includes('gemini') && 
        m.supportedGenerationMethods?.includes('generateContent')
      )
      .map((m: any) => m.name.replace('models/', ''))
      .sort((a: string, b: string) => {
        // Prioritize newer/flash models
        if (a.includes('flash')) return -1;
        if (b.includes('flash')) return 1;
        if (a.includes('2.0')) return -1;
        if (b.includes('2.0')) return 1;
        return a.localeCompare(b);
      });

    return geminiModels.length > 0 ? geminiModels : getDefaultModels('gemini');
  } catch {
    return getDefaultModels('gemini');
  }
}

async function fetchClaudeModels(_apiKey: string): Promise<string[]> {
  // Claude doesn't have a public model list API
  // Return known models
  return getDefaultModels('claude');
}

async function fetchGroqModels(apiKey: string): Promise<string[]> {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) return getDefaultModels('groq');

    const data = await response.json();
    const models = data.data
      .filter((m: any) => m.active)
      .map((m: any) => m.id);

    return models.length > 0 ? models : getDefaultModels('groq');
  } catch {
    return getDefaultModels('groq');
  }
}

// ============ API key validators ============

async function validateOpenAIKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function validateGeminiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function validateClaudeKey(apiKey: string): Promise<boolean> {
  // Simple validation - Claude key format check
  return apiKey.startsWith('sk-ant-') && apiKey.length > 20;
}

// ============ Default models fallback ============

function getDefaultModels(provider: string): string[] {
  const defaults: Record<string, string[]> = {
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    azure: [],
    claude: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    gemini: ['gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.0-flash-exp'],
    perplexity: ['llama-3.1-sonar-large-128k-online', 'llama-3.1-sonar-small-128k-online'],
    mistral: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo'],
    cohere: ['command-r-plus', 'command-r', 'command'],
    groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    openrouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-exp:free'],
  };
  return defaults[provider] || [];
}

export {};
