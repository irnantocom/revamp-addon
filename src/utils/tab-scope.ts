export const chatKey = (tabId: number): string => `tabChat:${tabId}`;

export const demoKey = (tabId: number, pageKey: string): string => `tabDemo:${tabId}:${pageKey}`;

let cachedTabId: number | undefined;

export function resetTabIdCache(): void {
  cachedTabId = undefined;
}

/**
 * Neither the panel nor the content script can read its own tab id; the service worker
 * sees it as `sender.tab.id`. Failures are not cached so a sleeping worker can be retried.
 */
export async function getTabId(): Promise<number | undefined> {
  if (cachedTabId !== undefined) return cachedTabId;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_ID' });
    if (response?.success && typeof response.data === 'number') {
      cachedTabId = response.data;
      return cachedTabId;
    }
  } catch (error) {
    console.warn('[Revamp] Could not resolve tab id:', error);
  }
  return undefined;
}
