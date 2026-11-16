import { useCallback, useEffect, useRef, useState } from 'react';
import type { DictationState } from '../types/voice';
import { loadVoiceSettings, startDictation, type DictationSession } from './dictation';

export interface DictationControl {
  state: DictationState;
  error: string | null;
  needsPermission: boolean;
  /** Start listening, or finish and deliver the text when already listening */
  toggle: () => void;
  cancel: () => void;
}

/**
 * Dictation into a text field. `onText` gets everything said since the start (replace, do not append)
 * and `final` once the session has ended; the caller keeps the field's earlier text as its own base.
 */
export function useDictation(onText: (text: string, final: boolean) => void): DictationControl {
  const [state, setState] = useState<DictationState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const session = useRef<DictationSession | null>(null);
  const starting = useRef(false);
  const callback = useRef(onText);
  callback.current = onText;

  const cancel = useCallback(() => {
    session.current?.cancel();
    session.current = null;
    setState('idle');
  }, []);

  // Never leave the microphone open after the field is gone
  useEffect(() => () => session.current?.cancel(), []);

  const toggle = useCallback(() => {
    if (state === 'listening' && session.current) {
      session.current.stop();
      return;
    }
    if (state === 'transcribing' || starting.current) return;

    starting.current = true;
    setError(null);
    setNeedsPermission(false);
    void (async () => {
      const voice = await loadVoiceSettings();
      session.current = await startDictation(voice, {
        onState: (next, problem) => {
          setState(next);
          if (next === 'idle') session.current = null;
          if (next === 'error') {
            session.current = null;
            setError(problem?.message ?? 'Dictation failed.');
            setNeedsPermission(!!problem?.needsPermission);
          }
        },
        onText: (text, final) => callback.current(text, final),
      });
      starting.current = false;
    })();
  }, [state]);

  return { state, error, needsPermission, toggle, cancel };
}
