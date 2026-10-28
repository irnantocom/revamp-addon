import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import AIChatBox from '../src/popup/components/AIChatBox';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let requests: any[];
let aiResponse: any;

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const textarea = () => container.querySelector('textarea')!;
const sendButton = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Send')!;
const draftChips = () => Array.from(container.querySelectorAll('.border-t li'));
const messageChips = () => Array.from(container.querySelectorAll('.overflow-y-auto li'));

const typeText = async (value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea(), value);
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const attach = async (file: File) => {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
};

const send = async () => {
  await act(async () => {
    sendButton().click();
  });
  await settle();
};

const pdf = () => new File(['%PDF-1.7 brief'], 'brief.pdf');

beforeEach(async () => {
  requests = [];
  aiResponse = { success: false, error: 'bad request' };

  (globalThis as any).chrome = {
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(async (message: any) => {
        if (message.type === 'GET_SETTINGS') return { success: true, data: { apiKeys: { openai: 'key' } } };
        if (message.type === 'FETCH_MODELS') return { success: true, data: ['gpt-4o'] };
        if (message.type === 'AI_REQUEST') {
          requests.push(message.payload);
          return aiResponse;
        }
        return { success: true };
      }),
    },
    tabs: {
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async (_tabId: number, message: any) => (message.type === 'GET_PAGE_INDEX' ? { success: false } : { success: true })),
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
    root.render(React.createElement(AIChatBox, {}));
  });
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('AIChatBox: a request that fails', () => {
  it('gives the text and the attachments back instead of leaving them in the history', async () => {
    await attach(pdf());
    expect(draftChips()).toHaveLength(1);
    await typeText('summarise');
    await send();

    expect(container.textContent).toContain('bad request');
    expect(messageChips()).toHaveLength(0);
    expect(textarea().value).toBe('summarise');
    expect(draftChips()).toHaveLength(1);
    expect(container.querySelector('.border-t')!.textContent).toContain('brief.pdf');
  });

  it('does not send the failed turn again with the next request', async () => {
    await attach(pdf());
    await typeText('summarise');
    await send();

    aiResponse = { success: true, data: { content: 'ok', usage: {} } };
    await send();

    expect(requests).toHaveLength(2);
    const second = requests[1].messages;
    const userTurns = second.filter((m: any) => m.role === 'user');
    expect(userTurns).toHaveLength(1);
    expect(JSON.stringify(second)).toContain('"type":"pdf"');
    expect(second.filter((m: any) => Array.isArray(m.content) && m.content.some((p: any) => p.type === 'pdf'))).toHaveLength(1);
  });
});

describe('AIChatBox: attachments with blank text', () => {
  it('sends only the file when the text is just spaces', async () => {
    aiResponse = { success: true, data: { content: 'ok', usage: {} } };
    await attach(pdf());
    await typeText('   ');
    await send();

    const content = requests[0].messages[1].content;
    expect(content.every((part: any) => part.type !== 'text')).toBe(true);
    expect(content[0].type).toBe('pdf');
  });
});

describe('AIChatBox: pasting', () => {
  const paste = async (files: File[], text: string) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { files, getData: (type: string) => (type === 'text/plain' ? text : '') },
    });
    await act(async () => {
      textarea().dispatchEvent(event);
    });
    await settle();
    return event;
  };
  const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], 'image.png', { type: 'image/png' });

  it('leaves text alone when the clipboard holds text and an image (copied from Word or Excel)', async () => {
    const event = await paste([png()], 'Name\tQty');
    expect(event.defaultPrevented).toBe(false);
    expect(draftChips()).toHaveLength(0);
  });

  it('attaches a pasted screenshot when there is no text on the clipboard', async () => {
    const event = await paste([png()], '');
    expect(event.defaultPrevented).toBe(true);
    expect(draftChips()).toHaveLength(1);
  });
});
