import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import AttachmentChips from '../src/popup/components/AttachmentChips';
import { useAttachments } from '../src/popup/use-attachments';
import { AttachmentError } from '../src/utils/attachment-reader';
import type { AttachmentStore } from '../src/utils/attachment-store';
import type { StoredAttachment } from '../src/types/attachments';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const caps = { image: true, pdf: true };
let api: ReturnType<typeof useAttachments>;
let container: HTMLDivElement;
let root: Root;
let store: AttachmentStore;

const result = (file: File): StoredAttachment => ({
  meta: { id: `${file.name}-${Math.random()}`, name: file.name, kind: 'image', mime: 'image/png', size: 2048 },
  parts: [],
  bytes: 0,
});

const Host: React.FC<{ read: (file: File) => Promise<StoredAttachment> }> = ({ read }) => {
  api = useAttachments(caps, store, read as never);
  return React.createElement(AttachmentChips, { items: api.items, onRemove: api.remove });
};

const mount = async (read: (file: File) => Promise<StoredAttachment>) => {
  await act(async () => {
    root.render(React.createElement(Host, { read }));
  });
};
const add = async (...names: string[]) => {
  await act(async () => {
    await api.addFiles(names.map((n) => new File(['x'], n)));
  });
};
const chips = () => Array.from(container.querySelectorAll('li'));

beforeEach(() => {
  store = { put: vi.fn(async () => undefined), get: vi.fn(), clear: vi.fn() } as unknown as AttachmentStore;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useAttachments and AttachmentChips', () => {
  it('shows a chip per file, stores each one, and reports them as ready', async () => {
    await mount(async (file) => result(file));
    await add('a.png', 'b.png');

    expect(chips()).toHaveLength(2);
    expect(api.ready.map((m) => m.name)).toEqual(['a.png', 'b.png']);
    expect(store.put).toHaveBeenCalledTimes(2);
    expect(api.busy).toBe(false);
  });

  it('exposes chip-ready items with kind and size from the metadata', async () => {
    await mount(async (file) => result(file));
    await add('a.png');
    expect(api.chips).toEqual([expect.objectContaining({ key: api.items[0].key, name: 'a.png', kind: 'image', size: 2048, status: 'ready' })]);
  });

  it('shows "Reading..." and reports busy while a file is being processed', async () => {
    let finish!: (value: StoredAttachment) => void;
    await mount((file) => new Promise((resolve) => (finish = () => resolve(result(file)))));
    let pending!: Promise<void>;
    await act(async () => {
      pending = api.addFiles([new File(['x'], 'slow.png')]);
    });

    expect(container.textContent).toContain('Reading...');
    expect(api.busy).toBe(true);

    await act(async () => {
      finish(undefined as never);
      await pending;
    });
    expect(api.busy).toBe(false);
  });

  it('shows the reason for a file that cannot be used and keeps it out of `ready`', async () => {
    await mount(async () => {
      throw new AttachmentError('"x.png" is larger than 10 MB.');
    });
    await add('x.png');

    expect(container.textContent).toContain('"x.png" is larger than 10 MB.');
    expect(api.ready).toHaveLength(0);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('turns an unexpected error into a readable message', async () => {
    await mount(async () => {
      throw new Error('boom');
    });
    await add('x.png');
    expect(container.textContent).toContain('could not be read');
  });

  it('stops at 5 files without reading the 6th', async () => {
    const read = vi.fn(async (file: File) => result(file));
    await mount(read);
    await add('1.png', '2.png', '3.png', '4.png', '5.png');
    await add('6.png');

    expect(read).toHaveBeenCalledTimes(5);
    expect(container.textContent).toContain('up to 5 files');
    expect(api.ready).toHaveLength(5);
  });

  it('lets a file be removed', async () => {
    await mount(async (file) => result(file));
    await add('a.png', 'b.png');
    const key = api.items[0].key;
    await act(async () => api.remove(key));

    expect(api.ready.map((m) => m.name)).toEqual(['b.png']);
    expect(chips()).toHaveLength(1);
  });

  it('shows a name with markup as plain text', async () => {
    await mount(async (file) => result(file));
    await add('<img src=x onerror=alert(1)>.png');

    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>.png');
  });

  it('keeps a very long name complete in the tooltip and isolates right-to-left characters', async () => {
    const name = `${'a'.repeat(300)}‮fdp.exe`;
    await mount(async (file) => result(file));
    await add(name);

    const label = container.querySelector(`[title="${name}"]`)!;
    expect(label).not.toBeNull();
    expect(label.className).toContain('unicode-bidi');
  });

  it('renders two files with the same name', async () => {
    await mount(async (file) => result(file));
    await add('same.png', 'same.png');
    expect(chips()).toHaveLength(2);
    expect(api.ready).toHaveLength(2);
  });

  it('only shows thumbnails that are image data URLs', () => {
    act(() => {
      root.render(
        React.createElement(AttachmentChips, {
          items: [
            { key: '1', name: 'ok.png', kind: 'image', thumb: 'data:image/png;base64,AAAA', status: 'ready' },
            { key: '2', name: 'bad.png', kind: 'image', thumb: 'https://evil.test/x.png', status: 'ready' },
          ],
        })
      );
    });
    const images = Array.from(container.querySelectorAll('img'));
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });
});
