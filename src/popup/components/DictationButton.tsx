import React from 'react';
import type { DictationControl } from '../use-dictation';
import { openMicPermissionPage } from '../dictation';

interface ButtonProps {
  dictation: DictationControl;
  disabled?: boolean;
}

export const DictationButton: React.FC<ButtonProps> = ({ dictation, disabled }) => {
  const listening = dictation.state === 'listening';
  const transcribing = dictation.state === 'transcribing';
  const label = listening ? 'Stop dictation' : transcribing ? 'Transcribing' : 'Dictate with your voice';
  return (
    <button
      type="button"
      onClick={dictation.toggle}
      disabled={disabled || transcribing}
      title={label}
      aria-label={label}
      aria-pressed={listening}
      className={`flex h-8 w-8 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50 ${
        listening ? 'animate-pulse bg-red-100 text-red-600' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {transcribing ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      )}
    </button>
  );
};

/** Status line under the input: what the microphone is doing, or what went wrong */
export const DictationNotice: React.FC<{ dictation: DictationControl }> = ({ dictation }) => {
  if (dictation.state === 'listening') {
    return <div className="text-xs text-red-600 mt-1">Listening… press the microphone again to stop.</div>;
  }
  if (dictation.state === 'transcribing') {
    return <div className="text-xs text-gray-500 mt-1">Transcribing…</div>;
  }
  if (dictation.error) {
    return (
      <div className="text-xs text-red-600 mt-1" role="alert">
        {dictation.error}{' '}
        {dictation.needsPermission && (
          <button type="button" onClick={openMicPermissionPage} className="underline font-medium">
            Allow microphone
          </button>
        )}
      </div>
    );
  }
  return null;
};
