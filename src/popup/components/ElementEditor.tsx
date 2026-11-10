import React, { useState, useEffect, useRef } from 'react';
import { InspectedElement } from '../../types/inspector';
import { InspectorControl } from '../use-inspector';

interface Props {
  element: InspectedElement | null;
  onClear: () => void;
  /** Called with fresh element info after an edit, so the attribute list matches the page */
  onElementUpdate: (element: InspectedElement) => void;
  inspector: InspectorControl;
}

const EMPTY_STYLE = {
  color: '',
  backgroundColor: '',
  backgroundImage: '',
  fontSize: '',
  padding: '',
  margin: '',
};

/** Tag names of the elements inside `innerHTML`, in document order (top level and nested) */
function childTags(innerHTML: string): string[] {
  const template = document.createElement('template');
  template.innerHTML = innerHTML;
  return Array.from(template.content.querySelectorAll('*')).map((el) => el.tagName.toLowerCase());
}

const ElementEditor: React.FC<Props> = ({ element, onClear, onElementUpdate, inspector }) => {
  const [textValue, setTextValue] = useState('');
  const [selectedAttribute, setSelectedAttribute] = useState('');
  const [customAttributeName, setCustomAttributeName] = useState('');
  const [attributeValue, setAttributeValue] = useState('');
  const [style, setStyle] = useState(EMPTY_STYLE);
  // Set while we hand refreshed info of the same element back to the parent: the forms must keep what the user typed
  const refreshing = useRef(false);

  useEffect(() => {
    if (refreshing.current) {
      refreshing.current = false;
      return;
    }
    if (element) {
      setTextValue(element.textContent);
      setStyle(EMPTY_STYLE);
    }
  }, [element]);

  /** The element info from selection time is a snapshot; re-read it so edits (e.g. the style attribute) show up */
  const refreshElement = async (tabId: number) => {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_SELECTED_ELEMENT' });
    if (response?.success && response.data) {
      refreshing.current = true;
      onElementUpdate(response.data);
    }
  };

  const handleTextEdit = async () => {
    if (!element) return;

    // Setting text replaces everything inside the element, so links, images and bold text would be lost
    const inside = childTags(element.innerHTML);
    if (inside.length > 0) {
      const unique = Array.from(new Set(inside));
      const shown = unique.slice(0, 5).map((tag) => `<${tag}>`).join(', ') + (unique.length > 5 ? ', ...' : '');
      const proceed = confirm(
        `This element contains ${inside.length} child element${inside.length === 1 ? '' : 's'} (${shown}).\n\n` +
          'Update Text replaces all of them with plain text, which can break the layout.\n' +
          'You can restore them with "Undo Last Edit".\n\nContinue?'
      );
      if (!proceed) return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'EDIT_TEXT',
        payload: {
          selector: element.selector,
          value: textValue,
        },
      });
      if (!response?.success) {
        alert(response?.error || 'Failed to update text');
        return;
      }

      await refreshElement(tab.id);
      alert('Text updated successfully!');
    } catch (error) {
      console.error('[Popup] Failed to edit text:', error);
      alert('Failed to update text');
    }
  };

  const handleAttributeEdit = async () => {
    if (!element || !selectedAttribute) return;

    // Determine actual attribute name
    const attrName = (selectedAttribute === 'custom' ? customAttributeName : selectedAttribute).trim();
    
    if (!attrName || !attributeValue) {
      alert('Please provide both attribute name and value');
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'EDIT_ATTRIBUTE',
        payload: {
          selector: element.selector,
          attribute: attrName,
          value: attributeValue,
        },
      });
      if (!response?.success) {
        alert(response?.error || 'Failed to update attribute');
        return;
      }

      await refreshElement(tab.id);
      alert('Attribute updated successfully!');

      setCustomAttributeName('');
      setSelectedAttribute('');
      setAttributeValue('');
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

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_CSS',
        payload: { selector: element.selector, styles },
      });
      if (!response?.success) {
        alert(response?.error || 'Failed to apply style');
        return;
      }

      await refreshElement(tab.id);
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
      await refreshElement(tab.id);
    } catch (error) {
      console.error('[Popup] Failed to undo:', error);
    }
  };

  const header = (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-gray-900">Element Editor</h3>
      <button
        onClick={inspector.toggle}
        className={`text-xs px-3 py-1 rounded ${
          inspector.active
            ? 'bg-red-100 text-red-700 border border-red-300'
            : 'bg-blue-100 text-blue-700 border border-blue-300'
        }`}
        title="Toggle Inspector"
      >
        {inspector.active ? '⊗ Stop' : '⊕ Inspector'}
      </button>
    </div>
  );

  if (!element) {
    return (
      <div className="p-4 space-y-4">
        {header}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
          <p className="text-sm text-yellow-800">
            {inspector.active
              ? 'Hover over the page to highlight elements, then click one to select it.'
              : 'No element selected. Click Inspector, then click an element on the page.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {header}

      {/* Element Info */}
      <div className="bg-green-50 border border-green-200 rounded p-2 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-green-800">Selected:</span>
            <code className="bg-green-100 px-1 py-0.5 rounded text-green-900">
              {element.tagName}
            </code>
            <span className="text-green-600">{element.selector.type}</span>
          </div>
          <button
            onClick={onClear}
            className="text-xs text-green-700 hover:text-red-600 hover:underline transition-colors"
            title="Clear selected element"
          >
            Clear
          </button>
        </div>
        <div className="mt-1 text-green-700 truncate" title={element.selector.selector}>
          {element.selector.selector}
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
