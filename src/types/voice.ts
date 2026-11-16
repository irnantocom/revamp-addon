export type DictationState = 'idle' | 'listening' | 'transcribing' | 'error';

/** Panel to page: what the microphone is doing for the note popover */
export type NoteDictationEvent =
  | { kind: 'state'; state: DictationState; error?: string }
  | { kind: 'text'; text: string; final: boolean };
