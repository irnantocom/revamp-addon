import React, { useCallback, useEffect, useState } from 'react';
import { DemoConfig } from '../../types/demo';
import { DemoVersion, describeOperation, diffDemos } from '../../utils/demo-versions';
import { sendToTab } from '../tab-messaging';

interface Props {
  pageKey: string;
  /** Called with a human-readable result after loading a version */
  onNotice: (text: string) => void;
  onChanged: () => void;
}

const CURRENT = '__current__';

const VersionsPanel: React.FC<Props> = ({ pageKey, onNotice, onChanged }) => {
  const storageKey = `demoVersions:${pageKey}`;
  const [versions, setVersions] = useState<DemoVersion[]>([]);
  const [label, setLabel] = useState('');
  const [left, setLeft] = useState('');
  const [right, setRight] = useState(CURRENT);

  const load = useCallback(async () => {
    const stored = await chrome.storage.local.get(storageKey);
    setVersions((stored[storageKey] as DemoVersion[]) || []);
  }, [storageKey]);

  useEffect(() => {
    load();
  }, [load]);

  const persist = async (next: DemoVersion[]) => {
    setVersions(next);
    await chrome.storage.local.set({ [storageKey]: next });
  };

  const currentConfig = async (): Promise<DemoConfig | undefined> => {
    const response = await sendToTab<{ success: boolean; data?: DemoConfig }>({ type: 'DEMO_EXPORT' });
    return response?.success ? response.data : undefined;
  };

  const saveVersion = async () => {
    const config = await currentConfig();
    if (!config || config.operations.length === 0) {
      onNotice('Make some changes before saving a version.');
      return;
    }
    const version: DemoVersion = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      label: label.trim() || `Version ${versions.length + 1}`,
      savedAt: Date.now(),
      config,
    };
    await persist([...versions, version]);
    setLabel('');
    setLeft(version.id);
    onNotice(`Saved "${version.label}" (${config.operations.length} changes).`);
  };

  const loadVersion = async (version: DemoVersion) => {
    if (!confirm(`Replace the current demo with "${version.label}"? Unsaved changes will be lost.`)) return;
    const response = await sendToTab<{ success: boolean; error?: string; data?: { applied: number; pending: number } }>({
      type: 'DEMO_IMPORT',
      config: version.config,
    });
    if (response?.success && response.data) {
      onNotice(`Loaded "${version.label}": ${response.data.applied} applied` + (response.data.pending ? `, ${response.data.pending} pending` : ''));
    } else {
      onNotice(response?.error || 'Could not load that version.');
    }
    onChanged();
  };

  const deleteVersion = async (version: DemoVersion) => {
    if (!confirm(`Delete "${version.label}"?`)) return;
    await persist(versions.filter((v) => v.id !== version.id));
    if (left === version.id) setLeft('');
    if (right === version.id) setRight(CURRENT);
  };

  const [diffText, setDiffText] = useState<ReturnType<typeof diffDemos> | null>(null);
  const [diffTitle, setDiffTitle] = useState('');

  const compare = async () => {
    const resolve = async (id: string): Promise<{ name: string; config?: DemoConfig }> =>
      id === CURRENT
        ? { name: 'Current', config: await currentConfig() }
        : { name: versions.find((v) => v.id === id)?.label || 'Version', config: versions.find((v) => v.id === id)?.config };

    const a = await resolve(left);
    const b = await resolve(right);
    if (!a.config || !b.config) {
      onNotice('Pick two versions to compare.');
      return;
    }
    setDiffTitle(`${a.name} → ${b.name}`);
    setDiffText(diffDemos(a.config, b.config));
  };

  const options = [
    ...versions.map((v) => (
      <option key={v.id} value={v.id}>{v.label}</option>
    )),
    <option key={CURRENT} value={CURRENT}>Current (unsaved)</option>,
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">Versions</h3>

      <div className="flex gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`Version ${versions.length + 1}: e.g. After client feedback`}
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button onClick={saveVersion} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 rounded-lg">
          Save
        </button>
      </div>

      {versions.length === 0 ? (
        <p className="text-xs text-gray-500">Save a snapshot of the demo to keep each round of feedback.</p>
      ) : (
        <ul className="space-y-1">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center gap-2 border border-gray-200 rounded px-2 py-1.5">
              <div className="flex-1 min-w-0">
                <span className="block text-xs font-medium text-gray-800 truncate">{v.label}</span>
                <span className="block text-[10px] text-gray-400">
                  {new Date(v.savedAt).toLocaleString()} · {v.config.operations.length} changes
                </span>
              </div>
              <button onClick={() => loadVersion(v)} className="text-[11px] text-blue-600 hover:text-blue-800">Load</button>
              <button onClick={() => deleteVersion(v)} className="text-[11px] text-red-500 hover:text-red-700">Delete</button>
            </li>
          ))}
        </ul>
      )}

      {versions.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 text-xs">
            <select value={left} onChange={(e) => setLeft(e.target.value)} className="flex-1 min-w-0 border border-gray-300 rounded p-1">
              <option value="">Compare…</option>
              {options}
            </select>
            <span>→</span>
            <select value={right} onChange={(e) => setRight(e.target.value)} className="flex-1 min-w-0 border border-gray-300 rounded p-1">
              {options}
            </select>
            <button onClick={compare} disabled={!left} className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">
              Compare
            </button>
          </div>

          {diffText && (
            <div className="text-xs space-y-2">
              <p className="font-medium text-gray-700">{diffTitle}</p>
              {diffText.added.length + diffText.removed.length + diffText.changed.length === 0 ? (
                <p className="text-gray-500">No differences ({diffText.unchanged} identical changes).</p>
              ) : (
                <ul className="space-y-1">
                  {diffText.added.map((op, i) => (
                    <li key={`a${i}`} className="text-green-700">+ {describeOperation(op)}</li>
                  ))}
                  {diffText.changed.map((c, i) => (
                    <li key={`c${i}`} className="text-amber-700">
                      ~ {describeOperation(c.before)}
                      <br />
                      &nbsp;&nbsp;→ {describeOperation(c.after)}
                    </li>
                  ))}
                  {diffText.removed.map((op, i) => (
                    <li key={`r${i}`} className="text-red-700">− {describeOperation(op)}</li>
                  ))}
                </ul>
              )}
              <p className="text-[10px] text-gray-400">{diffText.unchanged} change(s) identical in both.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VersionsPanel;
