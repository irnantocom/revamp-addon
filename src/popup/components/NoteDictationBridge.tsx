import { useEffect, useRef } from 'react';
import { useDictation } from '../use-dictation';
import { sendToTab } from '../tab-messaging';
import type { NoteDictationEvent } from '../../types/voice';

/**
 * Listens for the note popover on the page. The page cannot use the microphone, so it asks the
 * panel (messages from extension code only, a site cannot forge them) and gets the text back.
 */
const NoteDictationBridge = () => {
  const send = (payload: NoteDictationEvent) => {
    void sendToTab({ type: 'VOICE_NOTE_EVENT', payload }).catch(() => {});
  };

  const dictation = useDictation((text, final) => send({ kind: 'text', text, final }));

  const control = useRef(dictation);
  control.current = dictation;

  useEffect(() => {
    const onMessage = (message: { type?: string }, sender: chrome.runtime.MessageSender) => {
      if (sender.id !== chrome.runtime.id) return;
      if (message?.type === 'VOICE_NOTE_TOGGLE') control.current.toggle();
      if (message?.type === 'VOICE_NOTE_CANCEL') control.current.cancel();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const previous = useRef(dictation.state);
  useEffect(() => {
    if (previous.current === dictation.state && dictation.state !== 'error') return;
    previous.current = dictation.state;
    const error = dictation.error
      ? dictation.error + (dictation.needsPermission ? ' Open the Revamp panel, then Settings > Voice > Allow microphone.' : '')
      : undefined;
    send({ kind: 'state', state: dictation.state, ...(error && { error }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.state, dictation.error]);

  return null;
};

export default NoteDictationBridge;
