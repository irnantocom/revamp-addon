import { useCallback, useRef, useState } from 'react';
import type { ProviderCapabilities } from '../ai/capabilities';
import type { AttachmentMeta } from '../types/attachments';
import type { ChipItem } from './components/AttachmentChips';
import { LIMITS, readAttachment } from '../utils/attachment-reader';
import type { AttachmentStore } from '../utils/attachment-store';
import { defaultReaderDeps } from '../utils/media-processing';

export interface PendingAttachment {
  key: string;
  name: string;
  status: 'reading' | 'ready' | 'error';
  error?: string;
  meta?: AttachmentMeta;
}

/**
 * Images to attach from a paste. Text copied from Word, Excel or a web page often carries a rendered
 * picture of itself next to the text, so a paste that has text is left alone.
 */
export function pastedImageFiles(files: File[], plainText: string): File[] {
  if (plainText.trim() !== '') return [];
  return files.filter((file) => file.type.startsWith('image/'));
}

/** Files picked for the message being written: validated, converted and stored one by one */
export function useAttachments(caps: ProviderCapabilities, store: AttachmentStore, read: typeof readAttachment = readAttachment) {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  // Updates arrive from several async reads; the ref always holds the latest list
  const latest = useRef<PendingAttachment[]>([]);
  const counter = useRef(0);
  const capsRef = useRef(caps);
  capsRef.current = caps;

  const commit = useCallback((next: PendingAttachment[]) => {
    latest.current = next;
    setItems(next);
  }, []);

  const patch = useCallback(
    (key: string, change: Partial<PendingAttachment>) =>
      commit(latest.current.map((item) => (item.key === key ? { ...item, ...change } : item))),
    [commit]
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      const active = latest.current.filter((item) => item.status !== 'error').length;
      const accepted = files.slice(0, Math.max(0, LIMITS.maxFiles - active));
      const added: PendingAttachment[] = accepted.map((file) => ({
        key: `attachment-${++counter.current}`,
        name: file.name,
        status: 'reading',
      }));
      if (accepted.length < files.length) {
        added.push({
          key: `attachment-${++counter.current}`,
          name: 'Too many files',
          status: 'error',
          error: `You can attach up to ${LIMITS.maxFiles} files per message.`,
        });
      }
      commit([...latest.current, ...added]);

      await Promise.all(
        accepted.map(async (file, i) => {
          const { key } = added[i];
          try {
            const result = await read(file, capsRef.current, defaultReaderDeps);
            await store.put(result);
            patch(key, { status: 'ready', meta: result.meta });
          } catch (error) {
            patch(key, { status: 'error', error: error instanceof Error && error.name === 'AttachmentError' ? error.message : `"${file.name}" could not be read.` });
          }
        })
      );
    },
    [commit, patch, read, store]
  );

  /** Put files that were already read back into the draft, e.g. after a request failed */
  const restore = useCallback(
    (metas: AttachmentMeta[]) =>
      commit([
        ...latest.current,
        ...metas.map((meta): PendingAttachment => ({ key: `attachment-${++counter.current}`, name: meta.name, status: 'ready', meta })),
      ]),
    [commit]
  );

  const remove = useCallback((key: string) => commit(latest.current.filter((item) => item.key !== key)), [commit]);
  const clear = useCallback(() => commit([]), [commit]);

  return {
    items,
    chips: items.map((item): ChipItem => ({
      key: item.key,
      name: item.name,
      status: item.status,
      error: item.error,
      kind: item.meta?.kind,
      size: item.meta?.size,
      thumb: item.meta?.thumb,
    })),
    ready: items.flatMap((item) => (item.status === 'ready' && item.meta ? [item.meta] : [])),
    busy: items.some((item) => item.status === 'reading'),
    addFiles,
    restore,
    remove,
    clear,
  };
}
