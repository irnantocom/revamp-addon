import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import AttachMenu from '../src/popup/components/AttachMenu';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onSelect = vi.fn();

const render = async (disabled = false) => {
  await act(async () => {
    root.render(
      React.createElement(AttachMenu, {
        disabled,
        items: [{ id: 'upload', label: 'Add photos & files', description: 'Upload from computer', icon: null, onSelect }],
      })
    );
  });
};
const plus = () => container.querySelector<HTMLButtonElement>('[aria-label="Add files"]')!;
const items = () => Array.from(container.querySelectorAll('[role="menuitem"]'));

beforeEach(() => {
  onSelect.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AttachMenu', () => {
  it('opens a list on click and runs the chosen item, then closes', async () => {
    await render();
    expect(items()).toHaveLength(0);

    await act(async () => plus().click());
    expect(items()).toHaveLength(1);
    expect(items()[0].textContent).toContain('Add photos & files');
    expect(items()[0].textContent).toContain('Upload from computer');

    await act(async () => (items()[0] as HTMLElement).click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(items()).toHaveLength(0);
  });

  it('closes on Escape and on a click outside', async () => {
    await render();
    await act(async () => plus().click());
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(items()).toHaveLength(0);

    await act(async () => plus().click());
    await act(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(items()).toHaveLength(0);
  });

  it('closes when it becomes disabled', async () => {
    await render();
    await act(async () => plus().click());
    await render(true);
    expect(items()).toHaveLength(0);
    expect(plus().disabled).toBe(true);
  });
});
