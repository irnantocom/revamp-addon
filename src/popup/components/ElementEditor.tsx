import React, { useState, useEffect } from 'react';
import { InspectedElement } from '../../types/inspector';

interface Props {
  element: InspectedElement | null;
  onClear: () => void;
}

const ElementEditor: React.FC<Props> = ({ element, onClear }) => {
  const [textValue, setTextValue] = useState('');
  const [selectedAttribute, setSelectedAttribute] = useState('');
  const [customAttributeName, setCustomAttributeName] = useState('');
  const [attributeValue, setAttributeValue] = useState('');
  const [style, setStyle] = useState({
    color: '',
    backgroundColor: '',
    backgroundImage: '',
    fontSize: '',
    padding: '',
    margin: '',
  });

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
      
      // Update local state to reflect the new attribute
      if (selectedAttribute === 'custom' && customAttributeName) {
        // Add the new attribute to the element's attributes
        element.attributes[customAttributeName] = attributeValue;
        // Reset form
        setCustomAttributeName('');
        setSelectedAttribute('');
        setAttributeValue('');
      } else {
        // Just reset the value for existing attributes
        setAttributeValue('');
        setSelectedAttribute('');
      }
    } catch (error) {
      console.error('[Popup] Failed to edit attribute:', error);
      alert('Failed to update attribute');
    }
  };

  const handleStyleApply = async () => {
    if (!element) return;

    const styles: Record<string, string> = {};
    if (style.color.trim()) styles['color'] = style.color.trim();
    if (style.backgroundColor.trim()) styles['background-color'] = style.backgroundColor.trim();
    if (style.backgroundImage.trim()) {
      const url = style.backgroundImage.trim().replace(/"/g, '%22');
      styles['background-image'] = /^url\(/i.test(url) ? url : `url("${url}")`;
      styles['background-size'] = 'cover';
      styles['background-position'] = 'center';
    }
    if (style.fontSize.trim()) styles['font-size'] = style.fontSize.trim();
    if (style.padding.trim()) styles['padding'] = style.padding.trim();
    if (style.margin.trim()) styles['margin'] = style.margin.trim();

    if (Object.keys(styles).length === 0) {
      alert('Fill in at least one style field');
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      await chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_CSS',
        payload: { selector: element.selector, styles },
      });

      setStyle({ color: '', backgroundColor: '', backgroundImage: '', fontSize: '', padding: '', margin: '' });
    } catch (error) {
      console.error('[Popup] Failed to apply style:', error);
      alert('Failed to apply style');
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
            <optgroup label="Edit Existing Attributes">
              {Object.keys(element.attributes).map((attr) => (
                <option key={attr} value={attr}>
                  {attr} = "{element.attributes[attr]}"
                </option>
              ))}
            </optgroup>
            <optgroup label="Add New Attribute">
              <option value="custom">+ Add custom attribute</option>
            </optgroup>
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
                {selectedAttribute === 'custom' ? 'Add Attribute' : 'Update Attribute'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Style Editor */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Edit Style</h3>
        <div className="space-y-2">
          {([
            ['color', 'Text color (e.g. #1a365d)'],
            ['backgroundColor', 'Background color (e.g. #f5f5f5)'],
            ['backgroundImage', 'Background image URL'],
            ['fontSize', 'Font size (e.g. 24px)'],
            ['padding', 'Padding (e.g. 16px 24px)'],
            ['margin', 'Margin (e.g. 0 auto)'],
          ] as const).map(([key, placeholder]) => (
            <input
              key={key}
              type="text"
              value={style[key]}
              onChange={(e) => setStyle((prev) => ({ ...prev, [key]: e.target.value }))}
              placeholder={placeholder}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          ))}
          <button
            onClick={handleStyleApply}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            Apply Style
          </button>
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
