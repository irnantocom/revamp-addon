/** The delimiter after the id keeps tab 1 from matching tab 12 */
export function isTabKey(key: string, tabId: number): boolean {
  return key === `tabChat:${tabId}` || key.startsWith(`tabDemo:${tabId}:`);
}

export async function purgeTabState(
  area: Pick<chrome.storage.StorageArea, 'get' | 'remove'>,
  tabId: number
): Promise<void> {
  const all = await area.get(null);
  const keys = Object.keys(all).filter((key) => isTabKey(key, tabId));
  if (keys.length > 0) await area.remove(keys);
}
