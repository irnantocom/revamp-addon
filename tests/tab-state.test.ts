import { describe, it, expect } from 'vitest';
import { isTabKey, purgeTabState } from '../src/background/tab-state';

describe('isTabKey', () => {
  it('matches the chat key and demo keys of exactly that tab', () => {
    expect(isTabKey('tabChat:1', 1)).toBe(true);
    expect(isTabKey('tabDemo:1:https://a.com/x', 1)).toBe(true);
  });

  it('does not match another tab whose id starts with the same digits', () => {
    expect(isTabKey('tabChat:12', 1)).toBe(false);
    expect(isTabKey('tabDemo:12:https://a.com/x', 1)).toBe(false);
  });

  it('ignores unrelated keys', () => {
    expect(isTabKey('settings', 1)).toBe(false);
  });
});

describe('purgeTabState', () => {
  const fakeArea = (initial: Record<string, unknown>) => {
    const data = { ...initial };
    return {
      data,
      get: async () => ({ ...data }),
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      },
    };
  };

  it('removes only the keys of the closed tab', async () => {
    const area = fakeArea({
      'tabChat:1': [],
      'tabChat:12': [],
      'tabDemo:1:https://a.com/': {},
      'tabDemo:12:https://a.com/': {},
    });
    await purgeTabState(area as any, 1);
    expect(Object.keys(area.data).sort()).toEqual(['tabChat:12', 'tabDemo:12:https://a.com/']);
  });

  it('does nothing when the tab has no state', async () => {
    const area = fakeArea({ 'tabChat:12': [] });
    await purgeTabState(area as any, 1);
    expect(Object.keys(area.data)).toEqual(['tabChat:12']);
  });
});
