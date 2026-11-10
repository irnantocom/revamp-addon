import { useEffect, useState } from 'react';
import { ensureContentScript } from './tab-messaging';

export interface InspectorControl {
  active: boolean;
  toggle: () => Promise<void>;
}

/**
 * Start/stop the element picker on the page. App owns the one instance and hands it to every tab
 * with a toggle, so a tab mounted later still shows the right state; INSPECTOR_STATE_CHANGED keeps
 * it right when the page stops the picker after a selection.
 */
export function useInspector(): InspectorControl {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message?.type === 'INSPECTOR_STATE_CHANGED') setActive(!!message.isActive);
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const toggle = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      if (!(await ensureContentScript(tab.id))) {
        alert('Failed to load inspector. Please refresh the page and try again.');
        return;
      }

      await chrome.tabs.sendMessage(tab.id, { type: active ? 'STOP_INSPECTOR' : 'START_INSPECTOR' });
      setActive(!active);
    } catch (error) {
      console.error('[Revamp] Failed to toggle inspector:', error);
      alert('Failed to start inspector: ' + error);
    }
  };

  return { active, toggle };
}
