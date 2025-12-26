import React, { useState, useEffect } from 'react';

interface InspectedElement {
  selector: {
    selector: string;
    type: string;
    confidence: string;
  };
  tagName: string;
  attributes: Record<string, string>;
  textContent: string;
  innerHTML: string;
}

interface Props {
  element: InspectedElement | null;
  onClear: () => void;
}

const ElementEditor: React.FC<Props> = ({ element, onClear }) => {
  const [textValue, setTextValue] = useState('');
  const [selectedAttribute, setSelectedAttribute] = useState('');
  const [customAttributeName, setCustomAttributeName] = useState('');
  const [attributeValue, setAttributeValue] = useState('');

  useEffect(() => {
    if (element) {
      setTextValue(element.textContent);
    }
  }, [element]);

  const handleTextEdit = async () => {
    if (!element) return;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      await chrome.tabs.sendMessage(tab.id, {
        type: 'EDIT_TEXT',
        payload: {
          selector: element.selector,
          value: textValue,
        },
      });

      alert('Text updated successfully!');
    } catch (error) {
      console.error('[Popup] Failed to edit text:', error);
      alert('Failed to update text');
    }
  };

  const handleAttributeEdit = async () => {
    if (!element || !selectedAttribute) return;

    // Determine actual attribute name
    const attrName = selectedAttribute === 'custom' ? customAttributeName : selectedAttribute;
    
    if (!attrName || !attributeValue) {
      alert('Please provide both attribute name and value');
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      await chrome.tabs.sendMessage(tab.id, {
        type: 'EDIT_ATTRIBUTE',
        payload: {
          selector: element.selector,
          attribute: attrName,
          value: attributeValue,
        },
      });

      alert('Attribute updated successfully!');
      
      // Reset custom attribute name after successful update
      if (selectedAttribute === 'custom') {
        setCustomAttributeName('');
      }
    } catch (error) {
      console.error('[Popup] Failed to edit attribute:', error);
      alert('Failed to update attribute');
    }
  };

  const handleUndo = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      await chrome.tabs.sendMessage(tab.id, { type: 'UNDO_EDIT' });
    } catch (error) {
      console.error('[Popup] Failed to undo:', error);
    }
  };

  if (!element) {
    return (
      <div className="p-4">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
          <p className="text-sm text-yellow-800">
            No element selected. Go to the Inspector tab to select an element.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Element Info */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex justify-between items-start mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Selected Element</h2>
          <button
            onClick={onClear}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
        </div>

        <div className="space-y-2 text-xs">
          <div>
            <span className="font-medium text-gray-700">Tag:</span>
            <code className="ml-2 bg-gray-100 px-2 py-1 rounded">{element.tagName}</code>
          </div>
          <div>
            <span className="font-medium text-gray-700">Selector:</span>
            <code className="ml-2 bg-gray-100 px-2 py-1 rounded text-xs break-all">
              {element.selector.selector}
            </code>
          </div>
          <div>
            <span className="font-medium text-gray-700">Type:</span>
            <span className="ml-2 text-gray-600">{element.selector.type}</span>
          </div>
        </div>
      </div>

      {/* Text Editor */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Edit Text Content</h3>
        <textarea
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          className="w-full border border-gray-300 rounded-lg p-2 text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          rows={4}
          placeholder="Enter new text content..."
        />
        <button
          onClick={handleTextEdit}
          className="mt-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          Update Text
        </button>
      </div>

      {/* Attribute Editor */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Edit Attributes</h3>
        <div className="space-y-2">
          <select
            value={selectedAttribute}
            onChange={(e) => {
              setSelectedAttribute(e.target.value);
              setAttributeValue(element.attributes[e.target.value] || '');
            }}
            className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Select an attribute...</option>
            {Object.keys(element.attributes).map((attr) => (
              <option key={attr} value={attr}>
                {attr}
              </option>
            ))}
            <option value="custom">+ Add custom attribute</option>
          </select>

          {selectedAttribute && (
            <>
              {selectedAttribute === 'custom' && (
                <input
                  type="text"
                  value={customAttributeName}
                  placeholder="Attribute name (e.g., 'src', 'href')"
                  onChange={(e) => setCustomAttributeName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              )}
              <input
                type="text"
                value={attributeValue}
                onChange={(e) => setAttributeValue(e.target.value)}
                placeholder="Attribute value"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleAttributeEdit}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
              >
                Update Attribute
              </button>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleUndo}
          className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          Undo Last Edit
        </button>
      </div>
    </div>
  );
};

export default ElementEditor;
