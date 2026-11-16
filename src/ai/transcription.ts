import type { TranscribeRequest } from './provider-interface';

/** Multipart body for the OpenAI-style /audio/transcriptions endpoint (Azure shares its shape) */
export function audioFormData(request: TranscribeRequest, includeModel: boolean): FormData {
  const binary = atob(request.audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: request.mimeType }), 'dictation.wav');
  // Azure takes the model from the deployment in the URL
  if (includeModel) form.append('model', request.model);
  if (request.language) form.append('language', request.language);
  form.append('response_format', 'json');
  return form;
}
