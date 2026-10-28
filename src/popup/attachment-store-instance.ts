import { createIndexedDbStore } from '../utils/attachment-store';

/** One store for the whole panel; every panel instance shares the same IndexedDB database */
export const attachmentStore = createIndexedDbStore();
