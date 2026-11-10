import React, { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { AnnotationInfo, DemoConfig, HistoryItem, SectionInfo } from '../../types/demo';
import { buildHandoffReport } from '../../utils/handoff-report';
import { Operation } from '../../types/operations';
import { decodeShareCode, encodeShareCode } from '../../utils/share-code';
import { sendToTab } from '../tab-messaging';
import VersionsPanel from './VersionsPanel';

interface DemoState {
  enabled: boolean;
  name: string;
  pageKey: string;
  items: HistoryItem[];
  parkedCount: number;
  sections: SectionInfo[];
  annotations: AnnotationInfo[];
  saveError?: string;
}

interface Props {
  /** Send a prompt to the AI Chat tab */
  onAskAI?: (prompt: string) => void;
}

const OP_LABELS: Record<string, string> = {
  set_text: 'Text',
  set_html: 'HTML',
  set_attr: 'Attribute',
  set_link: 'Link',
  replace_image: 'Image',
  set_style: 'Style',
  set_visibility: 'Visibility',
  move: 'Move',
  duplicate: 'Duplicate',
  remove: 'Remove',
  custom: 'Change',
};

const send = sendToTab;

const DemoPanel: React.FC<Props> = ({ onAskAI }) => {
  const [state, setState] = useState<DemoState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [shareCode, setShareCode] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [showPins, setShowPins] = useState(true);
  const [exportingHandoff, setExportingHandoff] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await send<{ success: boolean; data?: DemoState }>({ type: 'DEMO_STATE' });
      if (response?.success && response.data) {
        setState(response.data);
        setError('');
      }
    } catch {
      setError('Cannot reach the page. Reload it and reopen Revamp.');
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (message: Record<string, unknown>) => {
    await send(message);
    await refresh();
  };

  const applyOps = async (operations: Operation[]) => {
    const response = await send<{ success: boolean; error?: string }>({
      type: 'APPLY_OPERATIONS',
      payload: { operations },
    });
    if (response && !response.success) setNotice(response.error || 'Change failed');
    await refresh();
  };

  const opId = () => `ui-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const toggleSection = (s: SectionInfo) =>
    applyOps([{ id: opId(), op: 'set_visibility', target: s.id, visible: s.hidden, explanation: `${s.hidden ? 'Show' : 'Hide'} ${s.label}` }]);

  const moveSection = (s: SectionInfo, direction: 'up' | 'down') => {
    const ref = direction === 'up' ? s.previousId : s.nextId;
    if (!ref) return;
    return applyOps([{
      id: opId(), op: 'move', target: s.id, ref,
      position: direction === 'up' ? 'before' : 'after',
      explanation: `Move ${s.label} ${direction}`,
    }]);
  };

  const duplicateSection = (s: SectionInfo) =>
    applyOps([{ id: opId(), op: 'duplicate', target: s.id, explanation: `Duplicate ${s.label}` }]);

  const removeSection = (s: SectionInfo) => {
    if (!confirm(`Remove section "${s.label}" from the demo? You can revert it from the change list.`)) return;
    return applyOps([{ id: opId(), op: 'remove', target: s.id, explanation: `Remove ${s.label}` }]);
  };

  const resetAll = async () => {
    if (!confirm('Revert all changes and delete the saved demo for this page?')) return;
    await run({ type: 'DEMO_RESET' });
    setNotice('All changes reset.');
  };

  const exportDemo = async () => {
    const response = await send<{ success: boolean; data?: unknown }>({ type: 'DEMO_EXPORT' });
    if (!response?.success) return;
    const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = (state?.name || 'revamp-demo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    a.href = url;
    a.download = `${slug || 'revamp-demo'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importDemo = async (file: File) => {
    try {
      const config = JSON.parse(await file.text());
      const response = await send<{ success: boolean; error?: string; data?: { applied: number; pending: number } }>({
        type: 'DEMO_IMPORT',
        config,
      });
      if (response?.success && response.data) {
        const { applied, pending } = response.data;
        const differentPage = config.pageKey && state && config.pageKey !== state.pageKey;
        setNotice(
          `Imported: ${applied} applied` +
            (pending ? `, ${pending} pending (element not found yet)` : '') +
            (differentPage ? `. Note: this demo was made for ${config.pageKey}` : '')
        );
      } else {
        setNotice(response?.error || 'Import failed');
      }
    } catch {
      setNotice('That file is not valid JSON.');
    }
    if (fileInput.current) fileInput.current.value = '';
    await refresh();
  };

  const present = async () => {
    await send({ type: 'PRESENTATION_SET', on: true });
    setNotice('Presentation mode is on. Press Esc on the page to exit.');
  };

  const screenshot = async (fullPage: boolean) => {
    setCapturing(true);
    setNotice(fullPage ? 'Capturing full page… the panel hides for a few seconds.' : 'Capturing…');
    try {
      const response = await send<{ success: boolean; error?: string; data?: { truncated: boolean } }>({
        type: 'SCREENSHOT',
        fullPage,
      });
      if (response?.success) {
        setNotice(
          'Screenshot downloaded.' +
            (response.data?.truncated ? ' The page was very tall, so the image stops at the browser limit.' : '')
        );
      } else {
        setNotice(response?.error || 'Screenshot failed.');
      }
    } catch {
      setNotice('Screenshot failed. Reload the page and try again.');
    } finally {
      setCapturing(false);
    }
  };

  const copyShareCode = async () => {
    const response = await send<{ success: boolean; data?: Parameters<typeof encodeShareCode>[0] }>({ type: 'DEMO_EXPORT' });
    if (!response?.success || !response.data) return;
    if (response.data.operations.length === 0) {
      setNotice('Nothing to share yet. Make some changes first.');
      return;
    }
    const code = await encodeShareCode(response.data);
    setShareCode(code);
    try {
      await navigator.clipboard.writeText(code);
      setNotice('Share code copied. Send it to a teammate; they paste it under "Import from code".');
    } catch {
      setNotice('Share code ready below. Copy it manually.');
    }
  };

  const importShareCode = async (code: string) => {
    try {
      const config = await decodeShareCode(code);
      const response = await send<{ success: boolean; error?: string; data?: { applied: number; pending: number } }>({
        type: 'DEMO_IMPORT',
        config,
      });
      if (response?.success && response.data) {
        const differentPage = config.pageKey && state && config.pageKey !== state.pageKey;
        setNotice(
          `Imported: ${response.data.applied} applied` +
            (response.data.pending ? `, ${response.data.pending} pending (element not found yet)` : '') +
            (differentPage ? `. Note: this demo was made for ${config.pageKey}` : '')
        );
        setShareCode('');
      } else {
        setNotice(response?.error || 'Import failed');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Import failed');
    }
    await refresh();
  };

  const addNote = async () => {
    await send({ type: 'ANNOTATION_ADD' });
    setNotice('Click an element on the page to attach a note. Press Esc to cancel.');
  };

  const togglePins = async (visible: boolean) => {
    setShowPins(visible);
    await send({ type: 'ANNOTATION_VISIBLE', visible });
  };

  const askAIToApplyNotes = async () => {
    const response = await send<{
      success: boolean;
      data?: Array<AnnotationInfo & { tag: string; context: string }>;
    }>({ type: 'ANNOTATION_NOTES_CONTEXT' });
    const notes = response?.data || [];
    if (notes.length === 0) {
      setNotice('No open notes with a findable element.');
      return;
    }

    // Each note carries the complete current content of its element, with ids the AI can target
    const blocks = notes.map(
      (n) =>
        `NOTE ${n.number} — attached to element [${n.elementId}] <${n.tag}>:\n"${n.text}"\n` +
        `Current content of that element (ids in brackets are the only valid targets):\n${n.context}`
    );
    onAskAI?.(
      `Apply these client notes to the page. Return complete new text for anything you change; never shorten it.\n\n${blocks.join('\n\n')}`
    );
  };

  const exportHandoff = async () => {
    setExportingHandoff(true);
    setNotice('Building handoff package… the panel hides while screenshots are taken (about 10–30 seconds).');
    try {
      const configResponse = await send<{ success: boolean; data?: DemoConfig }>({ type: 'DEMO_EXPORT' });
      const stateResponse = await send<{ success: boolean; data?: DemoState }>({ type: 'DEMO_STATE' });
      if (!configResponse?.success || !configResponse.data) throw new Error('Could not read the demo');
      const config = configResponse.data;
      const notes = stateResponse?.data?.annotations || [];

      const shots = await send<{ success: boolean; error?: string; data?: { after: string; before: string | null; truncated: boolean } }>({
        type: 'HANDOFF_CAPTURE',
      });

      const zip = new JSZip();
      const dataUrlToBase64 = (url: string) => url.slice(url.indexOf(',') + 1);
      let afterImage: string | undefined;
      let beforeImage: string | undefined;
      if (shots?.success && shots.data) {
        afterImage = 'after.png';
        zip.file(afterImage, dataUrlToBase64(shots.data.after), { base64: true });
        if (shots.data.before) {
          beforeImage = 'before.png';
          zip.file(beforeImage, dataUrlToBase64(shots.data.before), { base64: true });
        }
      }

      const report = buildHandoffReport({ config, notes, beforeImage, afterImage });
      zip.file('report.html', report.html);
      zip.file('report.md', report.markdown);
      zip.file('demo.json', JSON.stringify(config, null, 2));

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = (config.name || 'revamp-demo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      a.href = url;
      a.download = `${slug || 'revamp-demo'}-handoff.zip`;
      a.click();
      URL.revokeObjectURL(url);

      setNotice(
        'Handoff package downloaded.' +
          (shots?.success ? '' : ` Screenshots were skipped (${shots?.error || 'capture failed'}).`) +
          (shots?.data?.truncated ? ' The page was very tall, so screenshots stop at the browser limit.' : '')
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Handoff export failed.');
    } finally {
      setExportingHandoff(false);
    }
  };

  if (!state) {
    return <div className="p-4 text-sm text-gray-500">{error || 'Loading...'}</div>;
  }

  const applied = state.items.filter((i) => i.status === 'applied').length;

  return (
    <div className="p-4 space-y-4">
      {/* Demo mode */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Demo mode</h2>
            <p className="text-[11px] text-gray-500 break-all">{state.pageKey}</p>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={state.enabled}
              onChange={(e) => run({ type: 'DEMO_SET_ENABLED', enabled: e.target.checked })}
            />
            {state.enabled ? 'On' : 'Off'}
          </label>
        </div>
        {state.saveError && (
          <p role="alert" className="text-xs text-red-800 bg-red-50 border border-red-200 rounded p-2">
            {state.saveError}
          </p>
        )}
        {!state.enabled && (
          <p className="text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded p-2">
            The original page is showing. {state.parkedCount} saved change(s) are kept and return when you switch demo mode on.
          </p>
        )}
        <input
          type="text"
          defaultValue={state.name}
          key={state.name}
          onBlur={(e) => e.target.value.trim() !== state.name && run({ type: 'DEMO_SET_NAME', name: e.target.value })}
          placeholder="Demo name, e.g. Client A – Homepage Revamp"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <p className="text-[11px] text-gray-500">
          Changes are saved in this browser for this page and re-applied when you open it again. The real website is never modified.
        </p>
      </div>

      {notice && (
        <div className="text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded p-2 flex justify-between gap-2">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-blue-500">✕</button>
        </div>
      )}

      {/* Sections */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Sections ({state.sections.length})</h3>
        {state.sections.length === 0 ? (
          <p className="text-xs text-gray-500">No sections detected on this page.</p>
        ) : (
          <ul className="space-y-1">
            {state.sections.map((s) => (
              <li
                key={s.id}
                className={`flex items-center gap-1 border rounded px-2 py-1.5 ${s.hidden ? 'bg-gray-50 opacity-60' : 'bg-white'} border-gray-200`}
              >
                <button
                  onClick={() => send({ type: 'LOCATE_ELEMENT', id: s.id, label: s.label })}
                  className="flex-1 min-w-0 text-left"
                  title="Scroll to this section"
                  disabled={!state.enabled}
                >
                  <span className="block text-xs font-medium text-gray-800 truncate">{s.label}</span>
                  <span className="block text-[10px] text-gray-400">&lt;{s.tag}&gt;{s.hidden ? ' · hidden' : ''}</span>
                </button>
                <SectionButton label={s.hidden ? 'Show' : 'Hide'} onClick={() => toggleSection(s)} disabled={!state.enabled}>
                  {s.hidden ? '🙈' : '👁'}
                </SectionButton>
                <SectionButton label="Move up" onClick={() => moveSection(s, 'up')} disabled={!state.enabled || !s.canMoveUp}>↑</SectionButton>
                <SectionButton label="Move down" onClick={() => moveSection(s, 'down')} disabled={!state.enabled || !s.canMoveDown}>↓</SectionButton>
                <SectionButton label="Duplicate" onClick={() => duplicateSection(s)} disabled={!state.enabled}>⧉</SectionButton>
                <SectionButton label="Remove" onClick={() => removeSection(s)} disabled={!state.enabled}>🗑</SectionButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Change list */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900">Changes ({applied})</h3>
          <button
            onClick={resetAll}
            disabled={state.items.length === 0 && state.parkedCount === 0}
            className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-300"
          >
            Reset all
          </button>
        </div>
        {state.items.length === 0 ? (
          <p className="text-xs text-gray-500">No changes yet. Use the AI Chat, Editor or the section controls above.</p>
        ) : (
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {state.items.map((item) => (
              <li key={item.key} className="flex items-center gap-2 border border-gray-200 rounded px-2 py-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${item.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-700'}`}>
                  {OP_LABELS[item.op] || item.op}
                </span>
                <span className="flex-1 min-w-0 text-xs text-gray-700 truncate" title={item.explanation || item.label}>
                  {item.explanation || item.label}
                </span>
                {item.status === 'pending' && <span className="text-[10px] text-yellow-700">not found</span>}
                <button
                  onClick={() => run({ type: 'DEMO_REVERT', key: item.key })}
                  className="text-[11px] text-gray-500 hover:text-gray-900"
                  title="Revert this change (and later changes to the same element)"
                >
                  ↩ Revert
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Notes */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Notes ({state.annotations.length})</h3>
          <label className="flex items-center gap-1 text-[11px] text-gray-600 cursor-pointer">
            <input type="checkbox" checked={showPins} onChange={(e) => togglePins(e.target.checked)} />
            Show pins
          </label>
        </div>
        <button
          onClick={addNote}
          className="w-full border border-dashed border-amber-400 text-amber-700 hover:bg-amber-50 text-sm font-medium py-2 rounded-lg"
        >
          + Add note to an element
        </button>
        {state.annotations.length > 0 && (
          <ul className="space-y-1">
            {state.annotations.map((n) => (
              <li key={n.id} className="flex items-start gap-2 border border-gray-200 rounded px-2 py-1.5">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={n.resolved}
                  onChange={(e) => run({ type: 'ANNOTATION_UPDATE', id: n.id, resolved: e.target.checked })}
                  title="Mark as resolved"
                />
                <button
                  className="flex-1 min-w-0 text-left"
                  onClick={() => n.elementId && send({ type: 'LOCATE_ELEMENT', id: n.elementId, label: `Note ${n.number}` })}
                  disabled={!n.found}
                  title={n.found ? 'Scroll to the element' : 'Element not found on this page'}
                >
                  <span className={`block text-xs ${n.resolved ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                    {n.number}. {n.text}
                  </span>
                  <span className="block text-[10px] text-gray-400">
                    {n.elementLabel}{n.found ? '' : ' · not found'}
                  </span>
                </button>
                <button
                  onClick={() => run({ type: 'ANNOTATION_DELETE', id: n.id })}
                  className="text-[11px] text-red-500 hover:text-red-700"
                  title="Delete note"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {onAskAI && state.annotations.some((n) => !n.resolved) && (
          <button
            onClick={askAIToApplyNotes}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium py-2 rounded-lg"
          >
            Ask AI to apply open notes
          </button>
        )}
      </div>

      <VersionsPanel pageKey={state.pageKey} onNotice={setNotice} onChanged={refresh} />

      {/* Present */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">Present</h3>
        <div className="flex gap-2">
          <button
            onClick={present}
            className="flex-1 bg-gray-900 hover:bg-black text-white text-sm font-medium py-2 rounded-lg"
          >
            Presentation mode
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => screenshot(false)}
            disabled={capturing}
            className="flex-1 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium py-2 rounded-lg"
          >
            Screenshot (view)
          </button>
          <button
            onClick={() => screenshot(true)}
            disabled={capturing}
            className="flex-1 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium py-2 rounded-lg"
          >
            Screenshot (full page)
          </button>
        </div>
        <button
          onClick={exportHandoff}
          disabled={exportingHandoff || capturing}
          className="w-full border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium py-2 rounded-lg"
        >
          {exportingHandoff ? 'Building…' : 'Export handoff package (.zip)'}
        </button>
        <p className="text-[11px] text-gray-500">
          The handoff package has before/after screenshots, the list of changes with element hints, notes, and the demo file, for designers and developers.
        </p>
        <p className="text-[11px] text-gray-500">
          Presentation mode hides Revamp's panel so the client sees only the page. Screenshots never include the panel. In full-page shots, fixed headers appear once at the top.
        </p>
      </div>

      {/* Save / share */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">Save & share</h3>
        <div className="flex gap-2">
          <button
            onClick={exportDemo}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg"
          >
            Export JSON
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            className="flex-1 border border-gray-300 hover:bg-gray-50 text-sm font-medium py-2 rounded-lg"
          >
            Import JSON
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importDemo(e.target.files[0])}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={copyShareCode}
            className="flex-1 border border-gray-300 hover:bg-gray-50 text-sm font-medium py-2 rounded-lg"
          >
            Copy share code
          </button>
        </div>
        {shareCode && (
          <textarea
            readOnly
            value={shareCode}
            rows={3}
            onFocus={(e) => e.target.select()}
            className="w-full border border-gray-300 rounded-lg p-2 text-[10px] font-mono break-all"
          />
        )}
        <textarea
          placeholder="Paste a share code here (revamp1:…) and press Import from code"
          rows={2}
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
          className="w-full border border-gray-300 rounded-lg p-2 text-xs"
        />
        <button
          onClick={() => codeInput.trim() && importShareCode(codeInput).then(() => setCodeInput(''))}
          className="w-full border border-gray-300 hover:bg-gray-50 text-sm font-medium py-2 rounded-lg"
        >
          Import from code
        </button>
        <p className="text-[11px] text-gray-500">
          Share the file or the code with a teammate; they open the same page and import it. Importing replaces the current demo.
        </p>
      </div>
    </div>
  );
};

const SectionButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    className="w-6 h-6 flex items-center justify-center text-xs rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
  >
    {children}
  </button>
);

export default DemoPanel;
