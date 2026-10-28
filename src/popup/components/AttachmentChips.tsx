import React from 'react';
import type { AttachmentKind } from '../../types/attachments';

export interface ChipItem {
  key: string;
  name: string;
  kind?: AttachmentKind;
  size?: number;
  thumb?: string;
  status?: 'reading' | 'ready' | 'error';
  error?: string;
}

interface Props {
  items: ChipItem[];
  /** Omit for read-only chips, e.g. inside a sent message */
  onRemove?: (key: string) => void;
}

const ICON: Record<AttachmentKind, string> = { image: 'IMG', pdf: 'PDF', video: 'VID', document: 'DOC' };

const formatSize = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Only inline image data URLs are shown; anything else in `thumb` is ignored */
const isImageDataUrl = (value: string | undefined): value is string => !!value && /^data:image\/(png|jpeg|gif|webp);base64,/.test(value);

const AttachmentChips: React.FC<Props> = ({ items, onRemove }) => {
  if (items.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li
          key={item.key}
          className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${
            item.status === 'error' ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'
          }`}
        >
          {isImageDataUrl(item.thumb) ? (
            <img src={item.thumb} alt="" className="h-8 w-8 rounded object-cover" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-[10px] font-semibold text-gray-600">
              {item.kind ? ICON[item.kind] : '!'}
            </span>
          )}
          <span className="min-w-0">
            <span title={item.name} className="block max-w-[140px] truncate font-medium text-gray-800 [unicode-bidi:isolate]">
              {item.name}
            </span>
            {item.status === 'reading' && <span className="block text-[10px] text-gray-500">Reading...</span>}
            {item.status !== 'reading' && item.size !== undefined && (
              <span className="block text-[10px] text-gray-500">{formatSize(item.size)}</span>
            )}
            {item.error && (
              <span role="alert" className="block max-w-[220px] text-[10px] text-red-700">
                {item.error}
              </span>
            )}
          </span>
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${item.name}`}
              onClick={() => onRemove(item.key)}
              className="ml-1 text-gray-400 hover:text-gray-700"
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
};

export default AttachmentChips;
