import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createIndexedDbStore } from '../src/utils/attachment-store';
import type { StoredAttachment } from '../src/types/attachments';
import { attachmentStoreFor, memoryAttachmentStore } from '../src/popup/attachment-store-instance';

const make = (id: string, data = 'AAA'): StoredAttachment => ({
  meta: { id, name: `${id}.png`, kind: 'image', mime: 'image/png', size: 3 },
  parts: [{ type: 'image', mime: 'image/png', data }],
  bytes: data.length,
});

let name: string;
beforeEach(() => {
  name = `test-${Math.random()}`;
});

describe('attachment store', () => {
  it('returns what was stored', async () => {
    const store = createIndexedDbStore(name);
    await store.put(make('a'));
    expect(await store.get('a')).toEqual(make('a'));
  });

  it('returns undefined for an unknown id', async () => {
    expect(await createIndexedDbStore(name).get('missing')).toBeUndefined();
  });

  it('overwrites an entry stored twice under one id', async () => {
    const store = createIndexedDbStore(name);
    await store.put(make('a', 'AAA'));
    await store.put(make('a', 'ZZZZ'));
    expect((await store.get('a'))!.parts).toEqual([{ type: 'image', mime: 'image/png', data: 'ZZZZ' }]);
  });

  it('clear removes everything', async () => {
    const store = createIndexedDbStore(name);
    await store.put(make('a'));
    await store.put(make('b'));
    await store.clear();
    expect(await store.get('a')).toBeUndefined();
    expect(await store.get('b')).toBeUndefined();
  });

  it('a second store with the same name sees earlier data (panel closed and reopened)', async () => {
    await createIndexedDbStore(name).put(make('a'));
    expect(await createIndexedDbStore(name).get('a')).toEqual(make('a'));
  });
});

describe('per-tab attachment stores', () => {
  it('returns the same store for the same tab', () => {
    expect(attachmentStoreFor(1)).toBe(attachmentStoreFor(1));
  });

  it('clearing one tab leaves the files of another tab', async () => {
    await attachmentStoreFor(1).put(make('a'));
    await attachmentStoreFor(2).put(make('b'));
    await attachmentStoreFor(1).clear();
    expect(await attachmentStoreFor(1).get('a')).toBeUndefined();
    expect(await attachmentStoreFor(2).get('b')).toEqual(make('b'));
  });
});

describe('memory attachment store (no tab id)', () => {
  it('keeps files for the panel session and clears them', async () => {
    const store = memoryAttachmentStore();
    await store.put(make('a'));
    expect(await store.get('a')).toEqual(make('a'));
    await store.clear();
    expect(await store.get('a')).toBeUndefined();
  });
});
