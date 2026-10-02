/** Send a message to the content script of the active tab */
export async function sendToTab<T = any>(message: Record<string, unknown>): Promise<T | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.id) return undefined;
  return chrome.tabs.sendMessage(tab.id, message);
}
