import React from 'react';
import { AIChange } from '../../types/ai-response';

interface Props {
  changes: AIChange[];
  onApply: (change: AIChange) => void;
  onApplyAll: () => void;
  onPreview: (change: AIChange) => void;
}

const ChangePreview: React.FC<Props> = ({ changes, onApply, onApplyAll, onPreview }) => {
  const getActionColor = (action: string) => {
    switch (action) {
      case 'css': return 'bg-blue-100 text-blue-800';
      case 'html': return 'bg-purple-100 text-purple-800';
      case 'text': return 'bg-green-100 text-green-800';
      case 'remove': return 'bg-red-100 text-red-800';
      case 'insert': return 'bg-yellow-100 text-yellow-800';
      case 'attribute': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const truncate = (str: string, maxLen: number) => {
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen) + '...';
  };

  return (
    <div className="change-preview mt-2 p-2 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex justify-between items-center mb-2">
        <h4 className="font-semibold text-xs text-gray-700">
          📋 {changes.length} Change{changes.length > 1 ? 's' : ''} Proposed
        </h4>
        <button
          onClick={onApplyAll}
          className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
        >
          ✓ Apply All
        </button>
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {changes.map((change) => (
          <div 
            key={change.id} 
            className="p-2 bg-white rounded border border-gray-200 hover:border-blue-300 transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-1">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getActionColor(change.action)}`}>
                    {change.action.toUpperCase()}
                  </span>
                  <code className="text-[10px] text-gray-600 truncate block">
                    {truncate(change.selector, 30)}
                  </code>
                </div>
                <p className="text-[10px] text-gray-500 line-clamp-2">
                  {change.explanation}
                </p>
              </div>
              
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => onPreview(change)}
                  className="px-1.5 py-0.5 bg-gray-200 text-gray-700 text-[10px] rounded hover:bg-gray-300 transition-colors"
                  title="Preview this change"
                >
                  👁
                </button>
                <button
                  onClick={() => onApply(change)}
                  className="px-1.5 py-0.5 bg-green-600 text-white text-[10px] rounded hover:bg-green-700 transition-colors"
                  title="Apply this change"
                >
                  ✓
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ChangePreview;
