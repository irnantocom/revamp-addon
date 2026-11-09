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

describe('AIChatBox: replacing page content from a document', () => {
  const operations = '```json\n{"explanation":"x","operations":[{"id":"op-1","op":"set_text","target":5,"text":"Hi","explanation":"e"}],"warnings":[]}\n```';
  let pageMessages: any[];

  const pageIndex = (extra: Record<string, unknown> = {}) => ({
    success: true,
    data: { mode: 'page', rootId: 1, rootTag: 'body', index: '[5] h1 "Old"', count: 1, truncated: false, url: 'https://x.test', title: 'T', ...extra },
  });

  const mockPage = (index: unknown, untouched: Array<{ id: number; label: string }> = []) => {
    pageMessages = [];
    (globalThis as any).chrome.tabs.sendMessage = vi.fn(async (_tabId: number, message: any) => {
      pageMessages.push(message);
      if (message.type === 'GET_PAGE_INDEX') return index;
      if (message.type === 'SECTION_COVERAGE') return { success: true, data: { untouched } };
      return { success: true, data: { summary: 'ok' } };
    });
  };

  const hideButton = () => Array.from(container.querySelectorAll('button')).find((b) => /^Hide (it|them)$/.test(b.textContent || ''));

  it('offers to hide the sections the document left out, and hides them on request', async () => {
    mockPage(pageIndex(), [{ id: 7, label: 'Team' }, { id: 8, label: 'Blog' }]);
    aiResponse = { success: true, data: { content: operations, usage: {} } };
    await attach(pdf());
    await typeText('use this');
    await send();

    expect(pageMessages.find((m) => m.type === 'SECTION_COVERAGE').payload).toEqual({ targets: [5] });
    expect(container.textContent).toContain('2 sections keep its old content: Team, Blog');

    await act(async () => {
      hideButton()!.click();
    });
    await settle();

    const apply = pageMessages.find((m) => m.type === 'APPLY_OPERATIONS');
    expect(apply.payload.operations.map((o: any) => [o.op, o.target, o.visible])).toEqual([
      ['set_visibility', 7, false],
      ['set_visibility', 8, false],
    ]);
    expect(hideButton()).toBeUndefined();
  });

  it('shows nothing when no document was attached', async () => {
    mockPage(pageIndex(), [{ id: 7, label: 'Team' }]);
    aiResponse = { success: true, data: { content: operations, usage: {} } };
    await typeText('change the heading');
    await send();

    expect(pageMessages.some((m) => m.type === 'SECTION_COVERAGE')).toBe(false);
    expect(hideButton()).toBeUndefined();
  });

  it('does not check coverage when only a selected element was indexed', async () => {
    mockPage(pageIndex({ mode: 'element' }), [{ id: 7, label: 'Team' }]);
    aiResponse = { success: true, data: { content: operations, usage: {} } };
    await attach(pdf());
    await send();

    expect(pageMessages.some((m) => m.type === 'SECTION_COVERAGE')).toBe(false);
  });

  it('tells the user when the page index or the reply was cut off', async () => {
    mockPage(pageIndex({ truncated: true, count: 400 }));
    aiResponse = { success: true, data: { content: operations, truncated: true, usage: {} } };
    await typeText('rewrite it');
    await send();

    expect(container.textContent).toContain('only its first 400 elements were sent');
    expect(container.textContent).toContain('cut off at the output limit');
  });
});

describe('AIChatBox: images from a web page named in the message', () => {
  const html = '<html><body><img src="/ship.jpg" alt="Tall ship"><img src="/deck.jpg" alt="Deck"></body></html>';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    aiResponse = { success: true, data: { content: 'ok', usage: {} } };
    fetchMock = vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  const systemPrompt = (request: number) => requests[request].messages[0].content as string;

  it('reads the page, shows what it found and lists the images in the prompt', async () => {
    await typeText('replace the pictures with images from https://ship.test/');
    await send();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://ship.test/');
    expect(systemPrompt(0)).toContain('1. https://ship.test/ship.jpg  "Tall ship"');
    expect(container.textContent).toContain('Read 2 images from ship.test for the AI to choose from.');
  });

  it('keeps the list for later messages without reading the page again', async () => {
    await typeText('use images from https://ship.test/');
    await send();
    await typeText('now change the hero');
    await send();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(systemPrompt(1)).toContain('https://ship.test/deck.jpg');
  });

  it('says so when the page cannot be read, and still sends the request', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await typeText('use images from https://down.test/');
    await send();

    expect(requests).toHaveLength(1);
    expect(systemPrompt(0)).not.toContain('IMAGES FROM WEB PAGES');
    expect(container.textContent).toContain('Could not read images from https://down.test/: the site could not be reached.');
  });

  it('does not read anything when the message names no page', async () => {
    await typeText('change the heading');
    await send();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
