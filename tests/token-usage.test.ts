import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
  appendUsage,
  MAX_USAGE_RECORDS,
  pageLabel,
  recordTokenUsage,
  sanitizeUsageRecords,
  summarizeUsage,
  TOKEN_USAGE_KEY,
  TokenUsageRecord,
  usageRecord,
} from '../src/utils/token-usage';
import TokenUsagePanel from '../src/popup/components/TokenUsagePanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rec = (over: Partial<TokenUsageRecord> = {}): TokenUsageRecord => ({
  at: Date.now(),
  provider: 'openai',
  model: 'gpt-4o',
  promptTokens: 100,
  completionTokens: 20,
  totalTokens: 120,
  ...over,
});

/** A chrome.storage area backed by a plain object, with a delay so writes can interleave */
const memoryArea = () => {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: vi.fn(async (key: string) => {
      await new Promise((r) => setTimeout(r, 1));
      return { [key]: data[key] };
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      await new Promise((r) => setTimeout(r, 1));
      Object.assign(data, items);
    }),
  };
};

describe('usageRecord', () => {
  it('builds a record from a provider reply', () => {
    const r = usageRecord('claude', 'claude-sonnet', { promptTokens: 50, completionTokens: 10, totalTokens: 60 }, 'https://example.com/about?x=1', 5);
    expect(r).toEqual({ at: 5, provider: 'claude', model: 'claude-sonnet', promptTokens: 50, completionTokens: 10, totalTokens: 60, page: 'example.com/about' });
  });

  it('adds input and output when the provider gives no total', () => {
    expect(usageRecord('claude', 'm', { promptTokens: 50, completionTokens: 10, totalTokens: 0 })?.totalTokens).toBe(60);
  });

  it('keeps the provider total when it is larger (Gemini counts thinking there)', () => {
    expect(usageRecord('gemini', 'm', { promptTokens: 50, completionTokens: 10, totalTokens: 400 })?.totalTokens).toBe(400);
  });

  it('keeps reasoning tokens when reported', () => {
    expect(usageRecord('openai', 'o3', { promptTokens: 5, completionTokens: 90, totalTokens: 95, reasoningTokens: 80 })?.reasoningTokens).toBe(80);
  });

  it('returns null when there is no usage', () => {
    expect(usageRecord('openai', 'm', undefined)).toBeNull();
    expect(usageRecord('openai', 'm', { promptTokens: 0, completionTokens: 0, totalTokens: 0 })).toBeNull();
  });
});

describe('pageLabel', () => {
  it('keeps host and path of web pages only', () => {
    expect(pageLabel('https://shop.example.com:8080/a/b#top')).toBe('shop.example.com:8080/a/b');
    expect(pageLabel('chrome://extensions/')).toBeUndefined();
    expect(pageLabel('not a url')).toBeUndefined();
    expect(pageLabel(undefined)).toBeUndefined();
  });
});

describe('sanitizeUsageRecords', () => {
  it('drops malformed entries and clamps bad numbers', () => {
    const out = sanitizeUsageRecords([
      rec({ at: 1 }),
      null,
      'junk',
      { at: 2, totalTokens: 'lots' },
      { at: 3, provider: 7, model: 'x', promptTokens: -5, completionTokens: NaN, totalTokens: 10, page: 42 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ at: 3, provider: '', model: 'x', promptTokens: 0, completionTokens: 0, totalTokens: 10 });
  });

  it('returns an empty list for anything that is not an array', () => {
    expect(sanitizeUsageRecords(undefined)).toEqual([]);
    expect(sanitizeUsageRecords({ length: 1 })).toEqual([]);
  });
});

describe('appendUsage', () => {
  it('drops the oldest records beyond the limit', () => {
    const records = Array.from({ length: MAX_USAGE_RECORDS }, (_, i) => rec({ at: i + 1 }));
    const next = appendUsage(records, rec({ at: 999999 }));
    expect(next).toHaveLength(MAX_USAGE_RECORDS);
    expect(next[0].at).toBe(2);
    expect(next.at(-1)!.at).toBe(999999);
  });
});

describe('summarizeUsage', () => {
  it('totals per provider and model, largest first', () => {
    const { totals, byModel } = summarizeUsage([
      rec(),
      rec({ provider: 'claude', model: 'sonnet', promptTokens: 1000, completionTokens: 200, totalTokens: 1200 }),
      rec({ reasoningTokens: 5 }),
    ]);
    expect(totals).toEqual({ requests: 3, promptTokens: 1200, completionTokens: 240, reasoningTokens: 5, totalTokens: 1440 });
    expect(byModel.map((r) => [r.model, r.requests, r.totalTokens])).toEqual([
      ['sonnet', 1, 1200],
      ['gpt-4o', 2, 240],
    ]);
  });
});

describe('recordTokenUsage', () => {
  it('keeps every record when requests finish at the same time', async () => {
    const area = memoryArea();
    await Promise.all([recordTokenUsage(area, rec({ at: 1 })), recordTokenUsage(area, rec({ at: 2 })), recordTokenUsage(area, rec({ at: 3 }))]);
    expect((area.data[TOKEN_USAGE_KEY] as TokenUsageRecord[]).map((r) => r.at)).toEqual([1, 2, 3]);
  });

  it('starts over from stored junk instead of failing', async () => {
    const area = memoryArea();
    area.data[TOKEN_USAGE_KEY] = 'corrupted';
    await recordTokenUsage(area, rec({ at: 7 }));
    expect(area.data[TOKEN_USAGE_KEY]).toEqual([rec({ at: 7 })]);
  });
});

describe('TokenUsagePanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let stored: unknown;
  let onChanged: ((changes: any, area: string) => void) | undefined;

  const render = async () => {
    await act(async () => {
      root.render(React.createElement(TokenUsagePanel));
    });
  };
  const stat = (name: string) => container.querySelector(`[data-testid="stat-${name}"]`)!.textContent;

  beforeEach(() => {
    stored = undefined;
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async () => ({ [TOKEN_USAGE_KEY]: stored })),
          remove: vi.fn(async () => undefined),
        },
        onChanged: {
          addListener: vi.fn((fn) => (onChanged = fn)),
          removeListener: vi.fn(),
        },
      },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('shows totals for today and leaves out older requests', async () => {
    stored = [rec({ at: Date.now() - 10 * 24 * 60 * 60 * 1000, totalTokens: 5000 }), rec(), rec()];
    await render();
    expect(stat('requests')).toBe('2');
    expect(stat('total')).toBe('240');
  });

  it('updates when the service worker records a new request', async () => {
    stored = [rec()];
    await render();
    await act(async () => onChanged!({ [TOKEN_USAGE_KEY]: { newValue: [rec(), rec({ totalTokens: 1000 })] } }, 'local'));
    expect(stat('total')).toBe('1,120');
    expect(container.querySelectorAll('[data-testid="recent-requests"] li')).toHaveLength(2);
  });

  it('says so when there are no requests yet', async () => {
    await render();
    expect(container.textContent).toContain('No AI requests in this period');
  });
});
