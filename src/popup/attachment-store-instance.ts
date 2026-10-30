import { AttachmentStore, createIndexedDbStore } from '../utils/attachment-store';
import type { StoredAttachment } from '../types/attachments';

const stores = new Map<number, AttachmentStore>();

/** One database per browser tab, so clearing the chat in one tab cannot empty another tab's files */
export function attachmentStoreFor(tabId: number): AttachmentStore {
  let store = stores.get(tabId);
  if (!store) {
    store = createIndexedDbStore(`revamp-attachments-${tabId}`);
    stores.set(tabId, store);
  }
  return store;
}

/** Used when the tab id cannot be resolved: files live only as long as this panel */
export function memoryAttachmentStore(): AttachmentStore {
  const files = new Map<string, StoredAttachment>();
  return {
    async put(attachment) {
      files.set(attachment.meta.id, attachment);
    },
    async get(id) {
      return files.get(id);
    },
    async clear() {
      files.clear();
    },
  };
}
