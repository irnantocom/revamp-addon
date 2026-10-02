import React, { useEffect, useState } from 'react';

export interface PreviewStatus {
  changeId: string;
  /** Elements matched by the change's selector (undefined while loading) */
  matches?: number;
  error?: string;
}

/** Display model shared by selector-based changes and indexed operations */
export interface ChangeItem {
  id: string;
  /** Short label such as TEXT, CSS, MOVE */
  badge: string;
  /** Where it applies: a selector or "[12]" */
  target: string;
  explanation: string;
}

interface Props {
  changes: ChangeItem[];
  previewStatus: PreviewStatus | null;
  onApply: (id: string) => void;
  onApplySelected: (ids: string[]) => void;
  onTogglePreview: (id: string) => void;
}

const ChangePreview: React.FC<Props> = ({
  changes,
  previewStatus,
  onApply,
  onApplySelected,
  onTogglePreview,
}) => {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(changes.map((c) => c.id)));

  // Keep selection valid if the list of changes is replaced
  useEffect(() => {
    setSelected(new Set(changes.map((c) => c.id)));
  }, [changes]);

  const getActionColor = (badge: string) => {
    switch (badge.toLowerCase()) {
      case 'css':
      case 'set_style': return 'bg-blue-100 text-blue-800';
      case 'html':
      case 'set_html': return 'bg-purple-100 text-purple-800';
      case 'text':
      case 'set_text': return 'bg-green-100 text-green-800';
      case 'remove': return 'bg-red-100 text-red-800';
      case 'insert':
      case 'duplicate': return 'bg-yellow-100 text-yellow-800';
      case 'attribute':
      case 'set_attr':
      case 'set_link':
      case 'replace_image': return 'bg-orange-100 text-orange-800';
      case 'move':
      case 'set_visibility': return 'bg-teal-100 text-teal-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const truncate = (str: string, maxLen: number) => {
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen) + '...';
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = selected.size === changes.length;
  const selectedIds = changes.filter((c) => selected.has(c.id)).map((c) => c.id);

  return (
    <div className="change-preview mt-2 p-2 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex justify-between items-center mb-2 gap-2">
        <label className="flex items-center gap-1.5 font-semibold text-xs text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() =>
              setSelected(allSelected ? new Set() : new Set(changes.map((c) => c.id)))
            }
          />
          {changes.length} Change{changes.length > 1 ? 's' : ''} ({selected.size} selected)
        </label>
        <button
          onClick={() => onApplySelected(selectedIds)}
          disabled={selectedIds.length === 0}
          className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          ✓ Apply Selected
        </button>
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {changes.map((change) => {
          const isPreviewing = previewStatus?.changeId === change.id;
          const status = isPreviewing ? previewStatus : null;
          return (
            <div
              key={change.id}
              className={`p-2 bg-white rounded border transition-colors ${
                selected.has(change.id) ? 'border-gray-200 hover:border-blue-300' : 'border-gray-100 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <input
                  type="checkbox"
                  className="mt-0.5 flex-shrink-0"
                  checked={selected.has(change.id)}
                  onChange={() => toggle(change.id)}
                  title="Include in Apply Selected"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getActionColor(change.badge)}`}>
                      {change.badge.toUpperCase()}
                    </span>
                    <code className="text-[10px] text-gray-600 truncate block" title={change.target}>
                      {truncate(change.target, 30)}
                    </code>
                  </div>
                  <p className="text-[10px] text-gray-500 line-clamp-2">
                    {change.explanation}
                  </p>
                  {status && (
                    <p
                      className={`text-[10px] mt-1 ${
                        status.error || status.matches === 0 ? 'text-red-600' : 'text-blue-600'
                      }`}
                    >
                      {status.error
                        ? status.error
                        : status.matches === undefined
                        ? 'Locating...'
                        : status.matches === 0
                        ? 'No element matches this selector'
                        : `${status.matches} element${status.matches > 1 ? 's' : ''} highlighted`}
                    </p>
                  )}
                </div>

                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => onTogglePreview(change.id)}
                    className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                      isPreviewing
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                    title={isPreviewing ? 'Hide highlight' : 'Highlight target on page'}
                  >
                    {isPreviewing ? '🙈' : '👁'}
                  </button>
                  <button
                    onClick={() => onApply(change.id)}
                    className="px-1.5 py-0.5 bg-green-600 text-white text-[10px] rounded hover:bg-green-700 transition-colors"
                    title="Apply this change"
                  >
                    ✓
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ChangePreview;
