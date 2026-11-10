/** Token counts of AI requests, as the providers report them; kept in chrome.storage.local */
export const TOKEN_USAGE_KEY = 'tokenUsage';
/** Oldest records are dropped beyond this; about 200 bytes each */
export const MAX_USAGE_RECORDS = 1000;

export interface TokenUsageRecord {
  at: number;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Part of completionTokens spent on reasoning, when the provider reports it */
  reasoningTokens?: number;
  totalTokens: number;
  /** Host and path of the page the request was made from */
  page?: string;
}

export interface UsageTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface ModelUsage extends UsageTotals {
  provider: string;
  model: string;
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');

/** `host/path` of an http(s) page; anything else (chrome://, extension pages) is not worth showing */
export function pageLabel(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return (parsed.host + parsed.pathname).slice(0, 200);
  } catch {
    return undefined;
  }
}

/** A record for one provider reply, or null when the provider reported no usage */
export function usageRecord(
  provider: string,
  model: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; reasoningTokens?: number } | undefined,
  pageUrl?: string,
  at: number = Date.now()
): TokenUsageRecord | null {
  if (!usage) return null;
  const promptTokens = count(usage.promptTokens);
  const completionTokens = count(usage.completionTokens);
  // Claude has no total of its own; Gemini's total also holds thinking tokens, so prefer the provider's number
  const totalTokens = count(usage.totalTokens) || promptTokens + completionTokens;
  if (totalTokens === 0) return null;

  const reasoningTokens = count(usage.reasoningTokens);
  const page = pageLabel(pageUrl);
  return {
    at,
    provider: text(provider, 40),
    model: text(model, 120),
    promptTokens,
    completionTokens,
    ...(reasoningTokens > 0 && { reasoningTokens }),
    totalTokens,
    ...(page && { page }),
  };
}

/** Storage content is untrusted: keep only well-formed records */
export function sanitizeUsageRecords(raw: unknown): TokenUsageRecord[] {
  if (!Array.isArray(raw)) return [];
  const records: TokenUsageRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const at = count(r.at);
    const totalTokens = count(r.totalTokens);
    if (!at || !totalTokens) continue;
    const reasoningTokens = count(r.reasoningTokens);
    const page = text(r.page, 200);
    records.push({
      at,
      provider: text(r.provider, 40),
      model: text(r.model, 120),
      promptTokens: count(r.promptTokens),
      completionTokens: count(r.completionTokens),
      ...(reasoningTokens > 0 && { reasoningTokens }),
      totalTokens,
      ...(page && { page }),
    });
  }
  return records.slice(-MAX_USAGE_RECORDS);
}

export function appendUsage(
  records: TokenUsageRecord[],
  record: TokenUsageRecord,
  max: number = MAX_USAGE_RECORDS
): TokenUsageRecord[] {
  return [...records, record].slice(-max);
}

const emptyTotals = (): UsageTotals => ({
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
});

const add = (totals: UsageTotals, r: TokenUsageRecord): void => {
  totals.requests += 1;
  totals.promptTokens += r.promptTokens;
  totals.completionTokens += r.completionTokens;
  totals.reasoningTokens += r.reasoningTokens ?? 0;
  totals.totalTokens += r.totalTokens;
};

/** Overall totals and one row per provider and model, largest total first */
export function summarizeUsage(records: TokenUsageRecord[]): { totals: UsageTotals; byModel: ModelUsage[] } {
  const totals = emptyTotals();
  const byModel = new Map<string, ModelUsage>();
  for (const r of records) {
    add(totals, r);
    const key = `${r.provider}\u0000${r.model}`;
    let row = byModel.get(key);
    if (!row) {
      row = { provider: r.provider, model: r.model, ...emptyTotals() };
      byModel.set(key, row);
    }
    add(row, r);
  }
  return { totals, byModel: Array.from(byModel.values()).sort((a, b) => b.totalTokens - a.totalTokens) };
}

// Requests can finish at the same time; chaining keeps one read-modify-write from overwriting another
let pending: Promise<void> = Promise.resolve();

export function recordTokenUsage(
  area: Pick<chrome.storage.StorageArea, 'get' | 'set'>,
  record: TokenUsageRecord
): Promise<void> {
  pending = pending
    .then(async () => {
      const stored = await area.get(TOKEN_USAGE_KEY);
      await area.set({ [TOKEN_USAGE_KEY]: appendUsage(sanitizeUsageRecords(stored[TOKEN_USAGE_KEY]), record) });
    })
    .catch((error) => console.error('[Revamp] Could not record token usage:', error));
  return pending;
}
