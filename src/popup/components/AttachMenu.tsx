import React, { useEffect, useRef, useState } from 'react';

export interface AttachMenuItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

interface Props {
  items: AttachMenuItem[];
  disabled?: boolean;
}

/** The + button of the chat input: opens a list of ways to add content (more sources can be added as items) */
const AttachMenu: React.FC<Props> = ({ items, disabled }) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // A request in flight closes the menu too
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        title="Add files"
        aria-label="Add files"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-gray-600">{item.icon}</span>
              <span className="min-w-0">
                <span className="block text-gray-900">{item.label}</span>
                <span className="block truncate text-xs text-gray-500">{item.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default AttachMenu;
