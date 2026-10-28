import type { StoredAttachment } from '../types/attachments';

/**
 * File content of chat attachments. It lives in IndexedDB rather than chrome.storage: files are far
 * larger than the storage quota, and chatHistory (which is mirrored between panels) keeps metadata only.
 */
export interface AttachmentStore {
  put(attachment: StoredAttachment): Promise<void>;
  get(id: string): Promise<StoredAttachment | undefined>;
  clear(): Promise<void>;
}

const STORE_NAME = 'attachments';

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(`Attachment storage failed: ${req.error?.message ?? 'unknown error'}`));
  });

export function createIndexedDbStore(dbName = 'revamp-attachments'): AttachmentStore {
  let opened: Promise<IDBDatabase> | undefined;

  const open = (): Promise<IDBDatabase> => {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('Attachment storage is not available in this browser.'));
    }
    opened ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME, { keyPath: 'meta.id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opened = undefined;
        reject(new Error(`Attachment storage could not be opened: ${req.error?.message ?? 'unknown error'}`));
      };
    });
    return opened;
  };

  const objectStore = async (mode: IDBTransactionMode) => (await open()).transaction(STORE_NAME, mode).objectStore(STORE_NAME);

  return {
    async put(attachment) {
      await request((await objectStore('readwrite')).put(attachment));
    },
    async get(id) {
      return (await request((await objectStore('readonly')).get(id))) as StoredAttachment | undefined;
    },
    async clear() {
      await request((await objectStore('readwrite')).clear());
    },
  };
}
