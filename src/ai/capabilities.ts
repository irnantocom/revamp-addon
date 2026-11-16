/** What kinds of attachments each provider adapter can send */
export interface ProviderCapabilities {
  image: boolean;
  pdf: boolean;
}

const NONE: ProviderCapabilities = { image: false, pdf: false };

const CAPABILITIES: Record<string, ProviderCapabilities> = {
  openai: { image: true, pdf: true },
  claude: { image: true, pdf: true },
  gemini: { image: true, pdf: true },
  // PDF file parts are not confirmed for Azure deployments; enable once verified
  azure: { image: true, pdf: false },
};

export function getCapabilities(provider: string): ProviderCapabilities {
  return CAPABILITIES[provider] ?? NONE;
}

const LABELS: Record<string, string> = { openai: 'OpenAI', azure: 'Azure OpenAI', claude: 'Claude', gemini: 'Gemini' };

/** Providers whose adapter can turn speech into text (Claude has no audio input) */
export function canTranscribe(provider: string): boolean {
  return provider === 'openai' || provider === 'azure' || provider === 'gemini';
}

export function providerLabel(provider: string): string {
  return LABELS[provider] ?? provider;
}

/** Value for an <input type="file"> accept attribute: what the provider can use, plus documents */
export function acceptedFileTypes(caps: ProviderCapabilities): string {
  const types: string[] = [];
  if (caps.image) types.push('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm');
  if (caps.pdf) types.push('application/pdf');
  types.push('.txt', '.md', '.csv', '.json', '.html', '.docx');
  return types.join(',');
}
