/** Send a message to the content script of the active tab */
export async function sendToTab<T = any>(message: Record<string, unknown>): Promise<T | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.id) return undefined;
  return chrome.tabs.sendMessage(tab.id, message);
}

/** The content script may still be loading right after the page or extension (re)loads: poll until it answers */
export async function ensureContentScript(tabId: number): Promise<boolean> {
  const maxRetries = 10;
  const retryDelay = 200;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return true;
    } catch {
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  console.error('[Revamp] Content script failed to load after retries');
  return false;
}
