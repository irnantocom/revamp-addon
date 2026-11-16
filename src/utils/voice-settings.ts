export type VoiceEngine = 'browser' | 'provider';
export type VoiceProvider = 'openai' | 'azure' | 'gemini';

export interface VoiceSettings {
  engine: VoiceEngine;
  /** BCP 47 tag for the browser engine; its first part is the language hint for providers */
  language: string;
  provider: VoiceProvider;
  /** OpenAI/Gemini model id, or the Azure transcription deployment name */
  model: string;
}

export const VOICE_PROVIDERS: VoiceProvider[] = ['openai', 'azure', 'gemini'];

export const DEFAULT_VOICE_MODELS: Record<VoiceProvider, string> = {
  openai: 'whisper-1',
  azure: '',
  gemini: 'gemini-3.5-flash',
};

export const VOICE_LANGUAGES: { tag: string; label: string }[] = [
  { tag: 'id-ID', label: 'Bahasa Indonesia' },
  { tag: 'en-US', label: 'English (US)' },
  { tag: 'en-GB', label: 'English (UK)' },
  { tag: 'ms-MY', label: 'Bahasa Melayu' },
  { tag: 'es-ES', label: 'Español' },
  { tag: 'fr-FR', label: 'Français' },
  { tag: 'de-DE', label: 'Deutsch' },
  { tag: 'ja-JP', label: '日本語' },
];

function browserLanguage(): string {
  const tag = typeof navigator !== 'undefined' ? navigator.language : '';
  return VOICE_LANGUAGES.some((l) => l.tag === tag) ? tag : 'en-US';
}

export function defaultVoiceSettings(): VoiceSettings {
  return { engine: 'browser', language: browserLanguage(), provider: 'openai', model: DEFAULT_VOICE_MODELS.openai };
}

/** Settings come from chrome.storage: keep only values this code understands */
export function normalizeVoiceSettings(raw: unknown): VoiceSettings {
  const defaults = defaultVoiceSettings();
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const provider = VOICE_PROVIDERS.find((p) => p === input.provider) ?? defaults.provider;
  const language = VOICE_LANGUAGES.find((l) => l.tag === input.language)?.tag ?? defaults.language;
  const model = typeof input.model === 'string' ? input.model.trim().slice(0, 200) : DEFAULT_VOICE_MODELS[provider];

  return {
    engine: input.engine === 'provider' ? 'provider' : 'browser',
    language,
    provider,
    model,
  };
}

/** "id-ID" -> "id": the ISO 639-1 hint providers expect */
export function languageHint(language: string): string {
  return language.split('-')[0].toLowerCase();
}
