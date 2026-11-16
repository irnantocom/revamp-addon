// Google retires Gemini models without notice (1.5 and 2.0 now answer 404), so this list is only a
// fallback for when the live list cannot be fetched. Keep it to models checked against the API.
export const DEFAULT_GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];

// The list endpoint also returns speech, image, robotics and agent models that cannot answer a chat turn.
const NOT_FOR_CHAT = /tts|image|nano-banana|robotics|computer-use|embedding|transcribe|omni|customtools|deep-research|live|audio/;

function tier(id: string): number {
  if (/-flash-lite/.test(id)) return 1;
  if (/-flash/.test(id)) return 0;
  if (/-pro/.test(id)) return 2;
  return 3;
}

function version(id: string): number {
  const match = id.match(/^gemini-(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

/** Chat-capable Gemini ids from a `models.list` response: fast models first, newest first within a tier. */
export function pickGeminiModels(data: unknown): string[] {
  const models = (data as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return [];

  const ids = models
    .filter((m): m is { name: string; supportedGenerationMethods?: string[] } =>
      typeof m?.name === 'string' && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((id) => id.startsWith('gemini') && !NOT_FOR_CHAT.test(id));

  return [...new Set(ids)].sort((a, b) => tier(a) - tier(b) || version(b) - version(a) || a.localeCompare(b));
}

/** Google's own wording for a retired model; the chat box otherwise blames the API key for it. */
export function describeGeminiError(message: string, model: string): string {
  if (/no longer available|is not found for API version|not supported for generateContent/i.test(message)) {
    return `The model "${model}" is no longer available from Google. Pick another Gemini model in the list above.`;
  }
  return message;
}
