import React, { useEffect, useMemo, useState } from 'react';
import { providerLabel } from '../../ai/capabilities';
import {
  MAX_USAGE_RECORDS,
  sanitizeUsageRecords,
  summarizeUsage,
  TOKEN_USAGE_KEY,
  TokenUsageRecord,
} from '../../utils/token-usage';

type Range = 'today' | 'week' | 'all';

const RANGES: Array<[Range, string]> = [
  ['today', 'Today'],
  ['week', 'Last 7 days'],
  ['all', 'All'],
];

/** Requests listed one by one; the totals cover the whole range */
const RECENT_LIMIT = 50;

const formatNumber = (n: number): string => n.toLocaleString('en-US');

const formatTime = (at: number): string =>
  new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function rangeStart(range: Range, now: number): number {
  if (range === 'all') return 0;
  if (range === 'week') return now - 7 * 24 * 60 * 60 * 1000;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

const TokenUsagePanel: React.FC = () => {
  const [records, setRecords] = useState<TokenUsageRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [range, setRange] = useState<Range>('today');

  useEffect(() => {
    chrome.storage.local
      .get(TOKEN_USAGE_KEY)
      .then((stored) => setRecords(sanitizeUsageRecords(stored[TOKEN_USAGE_KEY])))
      .catch((error) => console.error('[Tokens] Failed to load usage:', error))
      .finally(() => setLoaded(true));

    // The service worker writes a record after every AI reply; follow it while the tab is open
    const handleChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && TOKEN_USAGE_KEY in changes) {
        setRecords(sanitizeUsageRecords(changes[TOKEN_USAGE_KEY].newValue));
      }
    };
    chrome.storage.onChanged.addListener(handleChange);
    return () => chrome.storage.onChanged.removeListener(handleChange);
  }, []);

  const inRange = useMemo(() => {
    const since = rangeStart(range, Date.now());
    return records.filter((r) => r.at >= since);
  }, [records, range]);
  const { totals, byModel } = useMemo(() => summarizeUsage(inRange), [inRange]);
  const recent = useMemo(() => inRange.slice(-RECENT_LIMIT).reverse(), [inRange]);

  const clearHistory = async () => {
    if (!confirm('Delete the token history of all requests? This cannot be undone.')) return;
    try {
      await chrome.storage.local.remove(TOKEN_USAGE_KEY);
      setRecords([]);
    } catch (error) {
      console.error('[Tokens] Failed to clear usage:', error);
      alert('Failed to clear the token history');
    }
  };

  const stats: Array<[string, number]> = [
    ['Requests', totals.requests],
    ['Input', totals.promptTokens],
    ['Output', totals.completionTokens],
    ['Total', totals.totalTokens],
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Token usage</h3>
        <button
          onClick={clearHistory}
          disabled={records.length === 0}
          className={`text-xs px-3 py-1 rounded transition-colors ${
            records.length === 0 ? 'text-gray-400 cursor-not-allowed' : 'text-gray-600 hover:text-red-600 hover:bg-red-50'
          }`}
        >
          Clear history
        </button>
      </div>

      <div className="flex gap-1" role="group" aria-label="Time range">
        {RANGES.map(([value, label]) => (
          <button
            key={value}
            onClick={() => setRange(value)}
            aria-pressed={range === value}
            className={`flex-1 text-xs py-1 rounded border ${
              range === value
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {stats.map(([label, value]) => (
          <div key={label} className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-lg font-semibold text-gray-900" data-testid={`stat-${label.toLowerCase()}`}>
              {formatNumber(value)}
            </div>
          </div>
        ))}
      </div>
      {totals.reasoningTokens > 0 && (
        <p className="text-xs text-gray-500">
          {formatNumber(totals.reasoningTokens)} of the output tokens were spent on reasoning.
        </p>
      )}

      {!loaded ? (
        <div className="text-xs text-gray-500 text-center py-2">Loading...</div>
      ) : inRange.length === 0 ? (
        <div className="bg-gray-100 rounded-lg p-4 text-center text-sm text-gray-600">
          No AI requests in this period. Token counts appear here after each AI Chat reply.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <h4 className="text-xs font-semibold text-gray-900 mb-2">By model</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 text-left">
                  <th className="font-medium pb-1">Model</th>
                  <th className="font-medium pb-1 text-right">Req.</th>
                  <th className="font-medium pb-1 text-right">Input</th>
                  <th className="font-medium pb-1 text-right">Output</th>
                  <th className="font-medium pb-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {byModel.map((row) => (
                  <tr key={`${row.provider}:${row.model}`} className="border-t border-gray-100">
                    <td className="py-1 pr-1 max-w-0 w-2/5">
                      <div className="truncate text-gray-900" title={row.model}>{row.model || '(unknown)'}</div>
                      <div className="text-gray-500">{providerLabel(row.provider)}</div>
                    </td>
                    <td className="py-1 text-right">{formatNumber(row.requests)}</td>
                    <td className="py-1 text-right">{formatNumber(row.promptTokens)}</td>
                    <td className="py-1 text-right">{formatNumber(row.completionTokens)}</td>
                    <td className="py-1 text-right font-medium">{formatNumber(row.totalTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <h4 className="text-xs font-semibold text-gray-900 mb-2">
              Recent requests{inRange.length > RECENT_LIMIT ? ` (latest ${RECENT_LIMIT})` : ''}
            </h4>
            <ul className="space-y-2" data-testid="recent-requests">
              {recent.map((r, i) => (
                <li key={`${r.at}-${i}`} className="text-xs border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-gray-900" title={r.model}>{r.model || '(unknown)'}</span>
                    <span className="text-gray-500 whitespace-nowrap">{formatTime(r.at)}</span>
                  </div>
                  <div className="text-gray-600">
                    {formatNumber(r.promptTokens)} in · {formatNumber(r.completionTokens)} out
                    {r.reasoningTokens ? ` (${formatNumber(r.reasoningTokens)} reasoning)` : ''} ·{' '}
                    <span className="font-medium">{formatNumber(r.totalTokens)} total</span>
                  </div>
                  {r.page && (
                    <div className="truncate text-gray-400" title={r.page}>{r.page}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <p className="text-xs text-gray-500">
        Counts as reported by each provider, including follow-up requests the chat makes to finish or repair a
        reply. Stored on this computer only; the latest {formatNumber(MAX_USAGE_RECORDS)} requests are kept.
      </p>
    </div>
  );
};

export default TokenUsagePanel;
