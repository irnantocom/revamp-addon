import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import ElementEditor from '../src/popup/components/ElementEditor';
import { InspectedElement } from '../src/types/inspector';
import { useInspector } from '../src/popup/use-inspector';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** The page side: a real element whose attributes are reported like GET_SELECTED_ELEMENT does */
let target: HTMLElement;

const inspect = (): InspectedElement => {
  const attributes: Record<string, string> = {};
  target.getAttributeNames().forEach((name) => (attributes[name] = target.getAttribute(name) || ''));
  return {
    selector: { selector: '#hero', type: 'id' } as InspectedElement['selector'],
    tagName: 'h1',
    attributes,
    textContent: target.textContent || '',
    innerHTML: target.innerHTML,
    rect: {} as DOMRect,
  };
};

const Host: React.FC<{ initial?: InspectedElement | null }> = ({ initial }) => {
  const [element, setElement] = useState<InspectedElement | null>(initial === undefined ? inspect() : initial);
  return React.createElement(ElementEditor, {
    element,
    onClear: () => setElement(null),
    onElementUpdate: setElement,
    inspector: useInspector(),
  });
};

let container: HTMLDivElement;
let root: Root;

const render = async () => {
  await act(async () => {
    root.render(React.createElement(Host));
  });
};

const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const click = async (label: string) => {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)!;
  await act(async () => {
    button.click();
  });
};

const colorInput = () => container.querySelector<HTMLInputElement>('input[placeholder^="Text color"]')!;
const attributeOptions = () =>
  Array.from(container.querySelectorAll('select option')).map((o) => o.textContent || '');

beforeEach(() => {
  document.body.innerHTML = '<h1 id="hero" class="title">Hello</h1>';
  target = document.getElementById('hero')!;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  (globalThis as any).chrome = {
    runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1 }]),
      sendMessage: vi.fn(async (_tabId: number, message: any) => {
        if (message.type === 'APPLY_CSS') {
          Object.entries(message.payload.styles as Record<string, string>).forEach(([k, v]) =>
            target.style.setProperty(k, v)
          );
          return { success: true };
        }
        if (message.type === 'EDIT_ATTRIBUTE') {
          target.setAttribute(message.payload.attribute, message.payload.value);
          return { success: true };
        }
        if (message.type === 'GET_SELECTED_ELEMENT') return { success: true, data: inspect() };
        return { success: true };
      }),
    },
  };
  vi.spyOn(window, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('ElementEditor style fields', () => {
  it('keeps the values in the style fields after Apply Style', async () => {
    await render();
    await type(colorInput(), '#ff0000');
    await click('Apply Style');

    expect(target.style.color).toBe('rgb(255, 0, 0)');
    expect(colorInput().value).toBe('#ff0000');
  });

  it('lists the style attribute (with the applied value) in Edit Attributes afterwards', async () => {
    await render();
    expect(attributeOptions().some((o) => o.startsWith('style ='))).toBe(false);

    await type(colorInput(), '#ff0000');
    await click('Apply Style');

    const style = attributeOptions().find((o) => o.startsWith('style ='));
    expect(style).toBeDefined();
    expect(style).toContain('color');
  });

  it('shows an attribute that was just edited with its new value', async () => {
    await render();
    const select = container.querySelector<HTMLSelectElement>('select')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'class');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const valueInput = container.querySelector<HTMLInputElement>('input[placeholder="Attribute value"]')!;
    await type(valueInput, 'headline');
    await click('Update Attribute');

    expect(attributeOptions()).toContain('class = "headline"');
  });

  describe('when the page rejects an edit', () => {
    const reject = (type: string, error: string) => {
      const send = (globalThis as any).chrome.tabs.sendMessage as ReturnType<typeof vi.fn>;
      const original = send.getMockImplementation()!;
      send.mockImplementation(async (tabId: number, message: any) =>
        message.type === type ? { success: false, error } : original(tabId, message)
      );
    };

    it('shows the reason instead of "updated successfully" and keeps the style fields', async () => {
      reject('APPLY_CSS', 'Invalid CSS: font-size: 24');
      await render();
      await type(colorInput(), '#ff0000');
      await click('Apply Style');

      expect(window.alert).toHaveBeenCalledWith('Invalid CSS: font-size: 24');
      expect(colorInput().value).toBe('#ff0000');
    });

    it('shows the reason for an invalid attribute and keeps the form open', async () => {
      reject('EDIT_ATTRIBUTE', '"my attr" is not a valid attribute name.');
      await render();
      const select = container.querySelector<HTMLSelectElement>('select')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
        setter.call(select, 'custom');
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await type(container.querySelector<HTMLInputElement>('input[placeholder^="Attribute name"]')!, 'my attr');
      await type(container.querySelector<HTMLInputElement>('input[placeholder="Attribute value"]')!, 'v');
      await click('Add Attribute');

      expect(window.alert).toHaveBeenCalledWith('"my attr" is not a valid attribute name.');
      expect(window.alert).not.toHaveBeenCalledWith('Attribute updated successfully!');
      expect(container.querySelector('input[placeholder^="Attribute name"]')).not.toBeNull();
    });

    it('shows the reason when the text edit fails', async () => {
      reject('EDIT_TEXT', 'Element not found');
      await render();
      await click('Update Text');

      expect(window.alert).toHaveBeenCalledWith('Element not found');
      expect(window.alert).not.toHaveBeenCalledWith('Text updated successfully!');
    });
  });

  describe('Update Text on an element that has child elements', () => {
    const textMessages = () =>
      ((globalThis as any).chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, message]) => message.type === 'EDIT_TEXT'
      );

    beforeEach(() => {
      target.innerHTML = 'Hello <a href="/x">link</a> and <b>bold</b>';
    });

    it('asks for confirmation, mentioning what would be lost, and does nothing when cancelled', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await render();
      await click('Update Text');

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      const question = confirmSpy.mock.calls[0][0] as string;
      expect(question).toContain('2');
      expect(question).toMatch(/<a>/);
      expect(question).toMatch(/<b>/);
      expect(textMessages()).toHaveLength(0);
    });

    it('applies the edit once the user confirms', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await render();
      await click('Update Text');

      expect(textMessages()).toHaveLength(1);
    });

    it('asks again after the edit is undone and the child elements are back', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const original = target.innerHTML;
      const send = (globalThis as any).chrome.tabs.sendMessage as ReturnType<typeof vi.fn>;
      const base = send.getMockImplementation()!;
      send.mockImplementation(async (tabId: number, message: any) => {
        if (message.type === 'EDIT_TEXT') {
          target.textContent = message.payload.value;
          return { success: true };
        }
        if (message.type === 'UNDO_EDIT') {
          target.innerHTML = original;
          return { success: true };
        }
        return base(tabId, message);
      });

      await render();
      await click('Update Text');
      expect(confirmSpy).toHaveBeenCalledTimes(1);

      await click('Undo Last Edit');
      await click('Update Text');
      expect(confirmSpy).toHaveBeenCalledTimes(2);
    });

    it('does not ask when the element holds plain text only', async () => {
      target.innerHTML = 'Just text';
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await render();
      await click('Update Text');

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(textMessages()).toHaveLength(1);
    });
  });
});

describe('ElementEditor inspector toggle', () => {
  const sent = () =>
    ((globalThis as any).chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mock.calls.map(([, m]) => m.type);

  it('starts and stops the inspector from the Editor tab', async () => {
    await render();
    await click('⊕ Inspector');
    expect(sent()).toContain('START_INSPECTOR');

    await click('⊗ Stop');
    expect(sent()).toContain('STOP_INSPECTOR');
    expect(container.textContent).toContain('⊕ Inspector');
  });

  it('offers the inspector when nothing is selected', async () => {
    await act(async () => {
      root.render(React.createElement(Host, { initial: null }));
    });
    expect(container.textContent).toContain('No element selected. Click Inspector');
    await click('⊕ Inspector');
    expect(sent()).toContain('START_INSPECTOR');
  });

  it('follows the page when it stops the inspector after a selection', async () => {
    await render();
    await click('⊕ Inspector');
    const listener = ((globalThis as any).chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    await act(async () => listener({ type: 'INSPECTOR_STATE_CHANGED', isActive: false }));
    expect(container.textContent).toContain('⊕ Inspector');
  });
});
