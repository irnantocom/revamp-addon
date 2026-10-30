import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createIndexedDbStore, purgeOrphanAttachmentDatabases } from '../src/utils/attachment-store';
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

describe('purgeOrphanAttachmentDatabases', () => {
  // The store keeps its connection open, which would block the delete; a closed connection is what an orphan is
  const seed = (dbName: string) =>
    new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('attachments', { keyPath: 'meta.id' });
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  const names = async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => n?.startsWith('revamp-attachments'));

  it('deletes the databases of tabs that are gone, and the old shared one', async () => {
    for (const dbName of ['revamp-attachments', 'revamp-attachments-901', 'revamp-attachments-902', 'revamp-attachments-903']) {
      await seed(dbName);
    }
    // Tabs 1 and 2 are the open stores from the tests above
    await purgeOrphanAttachmentDatabases([1, 2, 902]);
    expect((await names()).sort()).toEqual(['revamp-attachments-1', 'revamp-attachments-2', 'revamp-attachments-902']);
  });

  it('leaves databases that are not Revamp attachment stores alone', async () => {
    await seed('something-else');
    await purgeOrphanAttachmentDatabases([1, 2, 902]);
    expect((await indexedDB.databases()).map((d) => d.name)).toContain('something-else');
  });
});
