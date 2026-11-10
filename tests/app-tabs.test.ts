import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Only App's own tab handling is under test; each tab body is a stub
const mounts = vi.hoisted(() => ({ chat: 0 }));
vi.mock('../src/popup/components/AIChatBox', async () => {
  const React = await import('react');
  return {
    default: () => {
      React.useEffect(() => {
        mounts.chat += 1;
      }, []);
      return React.createElement('textarea', { 'data-testid': 'chat-input' });
    },
  };
});
// vi.mock is hoisted, so it cannot be called in a loop: one call per component
const { stub } = vi.hoisted(() => ({
  stub: async (name: string) => {
    const React = await import('react');
    return { default: () => React.createElement('div', null, name) };
  },
}));
vi.mock('../src/popup/components/ElementEditor', () => stub('ElementEditor'));
vi.mock('../src/popup/components/ExportPanel', () => stub('ExportPanel'));
vi.mock('../src/popup/components/Settings', () => stub('Settings'));
vi.mock('../src/popup/components/DemoPanel', () => stub('DemoPanel'));
vi.mock('../src/popup/components/TokenUsagePanel', () => stub('TokenUsagePanel'));
vi.mock('../src/utils/attachment-store', () => ({ purgeOrphanAttachmentDatabases: vi.fn(async () => undefined) }));

import App from '../src/popup/App';

let container: HTMLDivElement;
let root: Root;

const tabButton = (label: string) =>
  Array.from(container.querySelectorAll('nav button')).find((b) => b.textContent === label) as HTMLButtonElement;
const chatInput = () => container.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]');
const open = async (label: string) => {
  await act(async () => {
    tabButton(label).click();
  });
};

beforeEach(async () => {
  mounts.chat = 0;
  (globalThis as any).chrome = {
    runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
    tabs: { query: vi.fn(async () => []) },
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(App));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('App tabs', () => {
  it('has no Inspector tab, opens on the Editor and puts Tokens right after Settings', () => {
    const labels = Array.from(container.querySelectorAll('nav button')).map((b) => b.textContent);
    expect(labels).toEqual(['Editor', 'AI Chat', 'Demo', 'Export', 'Settings', 'Tokens']);
    expect(container.querySelector('main')!.textContent).toBe('ElementEditor');
  });

  it('shows the token usage when Tokens is opened', async () => {
    await open('Tokens');
    expect(container.querySelector('main')!.textContent).toBe('TokenUsagePanel');
  });

  it('does not build the AI chat until it is opened', () => {
    expect(chatInput()).toBeNull();
    expect(mounts.chat).toBe(0);
  });

  it('keeps the AI chat (draft text and attachments) alive while another tab is shown', async () => {
    await open('AI Chat');
    chatInput()!.value = 'draft that is not sent yet';

    await open('Demo');
    await open('AI Chat');

    expect(mounts.chat).toBe(1);
    expect(chatInput()!.value).toBe('draft that is not sent yet');
  });
});
