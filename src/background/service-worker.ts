/**
 * Background Service Worker (Manifest V3)
 * Handles extension lifecycle, messaging, and AI requests routing
 */

interface Message {
  type: string;
  payload?: any;
}

interface MessageResponse {
  success: boolean;
  data?: any;
  error?: string;
}

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
  payload: any,
  sendResponse: (response: MessageResponse) => void
) {
  try {
    // Placeholder for AI provider integration
    // This will be implemented in Phase 2
    sendResponse({
      success: false,
      error: 'AI requests not yet implemented (Phase 2)',
    });
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
