import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import AIChatBox from '../src/popup/components/AIChatBox';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let requests: any[];
let recognition: any;

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

class FakeRecognition {
  onresult: any;
  onerror: any;
  onend: any;
  constructor() { recognition = this; }
  start() {}
  stop() { this.onend?.(); }
  abort() {}
}

const textarea = () => container.querySelector('textarea')!;
const mic = () => container.querySelector<HTMLButtonElement>('[aria-label="Dictate with your voice"], [aria-label="Stop dictation"]')!;
const sendButton = () => Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Send message')!;
const say = async (parts: Array<[string, boolean]>) => {
  await act(async () => {
    recognition.onresult({ resultIndex: 0, results: parts.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) });
  });
};

beforeEach(async () => {
  requests = [];
  (window as any).SpeechRecognition = FakeRecognition;
  (globalThis as any).chrome = {
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(async (message: any) => {
        if (message.type === 'GET_SETTINGS') return { success: true, data: { apiKeys: { openai: 'key' }, voice: { engine: 'browser', language: 'id-ID' } } };
        if (message.type === 'FETCH_MODELS') return { success: true, data: ['gpt-4o'] };
        if (message.type === 'AI_REQUEST') requests.push(message.payload);
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
  await act(async () => {
    root.render(React.createElement(AIChatBox, { inspector: { active: false, toggle: async () => {} } }));
  });
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as any).SpeechRecognition;
  vi.restoreAllMocks();
});

describe('AIChatBox: dictation', () => {
  it('puts the spoken text after what was typed, holds the field while listening, and never sends', async () => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea(), 'Make the hero');
      textarea().dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => { mic().click(); });
    await settle();
    expect(recognition).toBeDefined();
    expect(container.textContent).toContain('Listening');
    expect(textarea().readOnly).toBe(true);
    expect(sendButton().disabled).toBe(true);

    await say([['lebih besar', false]]);
    expect(textarea().value).toBe('Make the hero lebih besar');

    await say([['lebih besar', true]]);
    await act(async () => { mic().click(); });
    await settle();

    expect(textarea().value).toBe('Make the hero lebih besar');
    expect(textarea().readOnly).toBe(false);
    expect(sendButton().disabled).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('shows why the microphone failed and offers the permission page', async () => {
    await act(async () => { mic().click(); });
    await settle();
    await act(async () => { recognition.onerror({ error: 'not-allowed' }); recognition.onend(); });

    expect(container.querySelector('[role="alert"]')!.textContent).toContain('blocked');
    expect(container.textContent).toContain('Allow microphone');
  });
});
