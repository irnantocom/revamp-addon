/**
 * Background Service Worker (Manifest V3)
 * Handles extension lifecycle, messaging, and AI requests routing
 */

import { OpenAIProvider } from '../ai/openai-provider';
import { ClaudeProvider } from '../ai/claude-provider';
import { GeminiProvider } from '../ai/gemini-provider';
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

      case 'AI_REQUEST':
        handleAIRequest(message.payload, sendResponse);
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
        temperature: payload.temperature,
        maxTokens: payload.maxTokens,
        stream: payload.stream,
      }
    );

    if (response.success) {
      sendResponse({
        success: true,
        data: response,
      });
    } else {
      sendResponse({
        success: false,
        error: response.error,
      });
    }
  } catch (error) {
    sendResponse({ success: false, error: String(error) });
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

export {};
