import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatKey, demoKey, getTabId, resetTabIdCache } from '../src/utils/tab-scope';

const sendMessage = vi.fn();

beforeEach(() => {
  sendMessage.mockReset();
  resetTabIdCache();
  (globalThis as any).chrome = { runtime: { sendMessage } };
});

describe('storage keys', () => {
  it('builds the chat and demo keys from the tab id', () => {
    expect(chatKey(5)).toBe('tabChat:5');
    expect(demoKey(5, 'https://a.com/x')).toBe('tabDemo:5:https://a.com/x');
  });
});

describe('getTabId', () => {
  it('asks the service worker once and caches the id', async () => {
    sendMessage.mockResolvedValue({ success: true, data: 7 });
    expect(await getTabId()).toBe(7);
    expect(await getTabId()).toBe(7);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_TAB_ID' });
  });

  it('returns undefined when the service worker has no tab', async () => {
    sendMessage.mockResolvedValue({ success: false, error: 'No tab' });
    expect(await getTabId()).toBeUndefined();
  });

  it('returns undefined when messaging throws, and does not cache the failure', async () => {
    sendMessage.mockRejectedValueOnce(new Error('worker asleep'));
    expect(await getTabId()).toBeUndefined();
    sendMessage.mockResolvedValue({ success: true, data: 9 });
    expect(await getTabId()).toBe(9);
  });
});
