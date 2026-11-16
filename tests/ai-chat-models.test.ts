import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import AIChatBox from '../src/popup/components/AIChatBox';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetches: string[];
let modelReplies: any[];
let apiKeys: Record<string, string>;

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const inspector = { active: false, toggle: async () => {} };
const render = async (active?: boolean) => {
  await act(async () => {
    root.render(React.createElement(AIChatBox, { inspector, active }));
  });
  await settle();
};

const selects = () => Array.from(container.querySelectorAll('select'));
const modelOptions = () => Array.from(selects()[1].querySelectorAll('option')).map((o) => o.textContent);
const refreshButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="Refresh model list"]')!;

beforeEach(async () => {
  fetches = [];
  apiKeys = { gemini: 'k', openai: 'k' };
  modelReplies = [];

  (globalThis as any).chrome = {
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(async (message: any) => {
        if (message.type === 'GET_SETTINGS') return { success: true, data: { apiKeys } };
        if (message.type === 'FETCH_MODELS') {
          fetches.push(message.payload.provider);
          return modelReplies.shift() ?? { success: true, data: ['m-1'] };
        }
        return { success: true };
      }),
    },
    tabs: {
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async () => ({ success: false })),
    },
  };
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('AIChatBox: model list', () => {
  it('asks the provider for its models when the chat first shows', async () => {
    modelReplies = [{ success: true, data: ['gemini-3.5-flash', 'gemini-3.5-flash-lite'] }];
    await render(true);

    expect(fetches).toEqual(['gemini']);
    expect(modelOptions()).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash-lite']);
  });

  it('asks again when the tab is shown again, and picks up new models', async () => {
    modelReplies = [{ success: true, data: ['old'] }, { success: true, data: ['old', 'new'] }];
    await render(true);
    await render(false);
    expect(fetches).toHaveLength(1);

    await render(true);
    expect(fetches).toHaveLength(2);
    expect(modelOptions()).toEqual(['old', 'new']);
  });

  it('keeps the model the user picked when it is still in the new list', async () => {
    modelReplies = [{ success: true, data: ['a', 'b'] }, { success: true, data: ['a', 'b', 'c'] }];
    await render(true);
    await act(async () => {
      const select = selects()[1];
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'b');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await render(false);
    await render(true);

    expect(selects()[1].value).toBe('b');
  });

  it('refetches when the provider is switched back to', async () => {
    await render(true);
    const change = async (value: string) =>
      act(async () => {
        const select = selects()[0];
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });

    await change('openai');
    await settle();
    await change('gemini');
    await settle();

    expect(fetches).toEqual(['gemini', 'openai', 'gemini']);
  });

  it('shows the fallback list without caching it, so the next visit tries again', async () => {
    modelReplies = [{ success: false, error: 'offline' }, { success: true, data: ['live-model'] }];
    await render(true);
    expect(modelOptions()).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash-lite']);

    await render(false);
    await render(true);

    expect(fetches).toHaveLength(2);
    expect(modelOptions()).toEqual(['live-model']);
  });

  it('keeps showing the old list while a refresh is running', async () => {
    modelReplies = [{ success: true, data: ['old'] }];
    await render(true);

    let release: (v: any) => void = () => undefined;
    modelReplies.push(new Promise((resolve) => (release = resolve)) as any);
    (chrome.runtime.sendMessage as any).mockImplementation(async (message: any) => {
      if (message.type === 'GET_SETTINGS') return { success: true, data: { apiKeys } };
      if (message.type === 'FETCH_MODELS') return modelReplies.shift();
      return { success: true };
    });

    await act(async () => {
      refreshButton().click();
    });
    expect(modelOptions()).toEqual(['old']);

    await act(async () => release({ success: true, data: ['new'] }));
    await settle();
    expect(modelOptions()).toEqual(['new']);
  });

  it('ignores a reply that arrives after the provider was changed', async () => {
    let release: (v: any) => void = () => undefined;
    modelReplies = [new Promise((resolve) => (release = resolve)) as any, { success: true, data: ['openai-model'] }];
    (chrome.runtime.sendMessage as any).mockImplementation(async (message: any) => {
      if (message.type === 'GET_SETTINGS') return { success: true, data: { apiKeys } };
      if (message.type === 'FETCH_MODELS') return modelReplies.shift();
      return { success: true };
    });
    await render(true);

    await act(async () => {
      const select = selects()[0];
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'openai');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    await act(async () => release({ success: true, data: ['late-gemini-model'] }));
    await settle();

    expect(modelOptions()).toEqual(['openai-model']);
  });

  it('the refresh button asks the current provider again', async () => {
    await render(true);
    expect(fetches).toHaveLength(1);

    await act(async () => {
      refreshButton().click();
    });
    await settle();

    expect(fetches).toEqual(['gemini', 'gemini']);
  });
});
