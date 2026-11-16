import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotationLayer } from '../src/utils/annotation-layer';
import { Annotation } from '../src/types/demo';

const note = (id: string, text: string, resolved = false): Annotation => ({
  id, text, resolved, createdAt: 1, target: { selector: 'h1', tag: 'h1', text: '', ord: 0 },
});

beforeEach(() => {
  document.body.innerHTML = '<h1>Title</h1><p>Body</p>';
  document.documentElement.querySelectorAll('[data-revamp-ui]').forEach((e) => e.remove());
  // jsdom reports zero-size rects; give elements a box so pins render
  Element.prototype.getBoundingClientRect = () => ({ top: 10, left: 10, width: 100, height: 20, right: 110, bottom: 30, x: 10, y: 10, toJSON() {} }) as DOMRect;
});

const make = (annotations: Annotation[], resolve = () => document.querySelector('h1')) =>
  new AnnotationLayer(() => annotations, resolve as any, vi.fn());

describe('AnnotationLayer', () => {
  it('renders one numbered pin per findable note, marking resolved ones', () => {
    const layer = make([note('a', 'First'), note('b', 'Second', true)]);
    layer.render();
    const pins = document.querySelectorAll('#revamp-annotations button');
    expect(pins).toHaveLength(2);
    expect(pins[0].textContent).toBe('1');
    expect(pins[1].textContent).toBe('✓');
  });

  it('skips notes whose element cannot be found, but keeps numbering', () => {
    const layer = make([note('a', 'First'), note('b', 'Second')], vi.fn().mockReturnValueOnce(null).mockReturnValue(document.querySelector('h1')) as any);
    layer.render();
    const pins = document.querySelectorAll('#revamp-annotations button');
    expect(pins).toHaveLength(1);
    expect(pins[0].textContent).toBe('2');
  });

  it('hides when suspended or switched off, and returns afterwards', () => {
    const layer = make([note('a', 'First')]);
    layer.render();
    layer.suspend(true);
    expect(document.getElementById('revamp-annotations')).toBeNull();
    layer.suspend(false);
    expect(document.getElementById('revamp-annotations')).not.toBeNull();
    layer.setVisible(false);
    expect(document.getElementById('revamp-annotations')).toBeNull();
  });

  it('pin click reports the note', () => {
    const onPin = vi.fn();
    const annotations = [note('a', 'First')];
    const layer = new AnnotationLayer(() => annotations, () => document.querySelector('h1'), onPin);
    layer.render();
    (document.querySelector('#revamp-annotations button') as HTMLButtonElement).click();
    expect(onPin).toHaveBeenCalledWith(annotations[0]);
  });

  it('pickElement resolves with the clicked page element and ignores Revamp UI', async () => {
    const layer = make([]);
    const highlight = vi.fn();
    const picked = layer.pickElement(highlight);

    const ui = document.createElement('div');
    ui.setAttribute('data-revamp-ui', 'true');
    document.body.appendChild(ui);
    ui.click();

    document.querySelector('p')!.click();
    expect(await picked).toBe(document.querySelector('p'));
  });

  it('pickElement resolves null on Escape', async () => {
    const layer = make([]);
    const picked = layer.pickElement(() => {});
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await picked).toBeNull();
  });

  it('popover saves trimmed text and refuses empty notes', () => {
    const layer = make([]);
    const onSave = vi.fn();
    layer.openPopover(document.querySelector('h1')!, '', { onSave });

    const textarea = document.querySelector('[data-revamp-ui] textarea') as HTMLTextAreaElement;
    const save = Array.from(document.querySelectorAll('[data-revamp-ui] button')).find((b) => b.textContent === 'Save') as HTMLButtonElement;

    save.click();
    expect(onSave).not.toHaveBeenCalled();

    textarea.value = '  Swap image  ';
    save.click();
    expect(onSave).toHaveBeenCalledWith('Swap image');
    expect(document.querySelector('[data-revamp-ui] textarea')).toBeNull();
  });
});

describe('AnnotationLayer note dictation', () => {
  const open = (dictation?: { toggle: () => void; cancel: () => void }) => {
    const layer = make([]);
    layer.openPopover(document.querySelector('h1')!, 'Existing', { onSave: vi.fn(), dictation });
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-revamp-ui] textarea')!;
    const mic = document.querySelector<HTMLButtonElement>('[aria-label="Dictate with your voice"]');
    return { layer, textarea, mic };
  };

  it('shows the microphone only when the panel can listen', () => {
    expect(open().mic).toBeNull();
    expect(open({ toggle: vi.fn(), cancel: vi.fn() }).mic).not.toBeNull();
  });

  it('appends dictated text to what was already written and locks the field while listening', () => {
    const dictation = { toggle: vi.fn(), cancel: vi.fn() };
    const { layer, textarea, mic } = open(dictation);

    mic!.click();
    expect(dictation.toggle).toHaveBeenCalledTimes(1);

    layer.applyDictation({ kind: 'state', state: 'listening' });
    expect(textarea.readOnly).toBe(true);
    layer.applyDictation({ kind: 'text', text: 'new words', final: false });
    expect(textarea.value).toBe('Existing new words');
    layer.applyDictation({ kind: 'text', text: 'new words now', final: true });
    layer.applyDictation({ kind: 'state', state: 'idle' });

    expect(textarea.value).toBe('Existing new words now');
    expect(textarea.readOnly).toBe(false);
  });

  it('shows an error and cancels a running dictation when the popover closes', () => {
    const dictation = { toggle: vi.fn(), cancel: vi.fn() };
    const { layer } = open(dictation);

    layer.applyDictation({ kind: 'state', state: 'error', error: 'Microphone access is blocked.' });
    expect(document.querySelector('[role="status"]')!.textContent).toContain('blocked');

    layer.applyDictation({ kind: 'state', state: 'listening' });
    layer.closePopover();
    expect(dictation.cancel).toHaveBeenCalledTimes(1);
  });

  it('ignores events when no popover is open', () => {
    expect(() => make([]).applyDictation({ kind: 'text', text: 'x', final: true })).not.toThrow();
  });
});

describe('AnnotationLayer popover size', () => {
  const popoverWidth = () => document.querySelector<HTMLElement>('[data-revamp-ui] textarea')!.parentElement!.style.width;

  it('is wide enough for the button row and counts its padding inside the width', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1024 });
    make([]).openPopover(document.querySelector('h1')!, '', { onSave: vi.fn() });
    const popover = document.querySelector<HTMLElement>('[data-revamp-ui] textarea')!.parentElement!;
    expect(popoverWidth()).toBe('380px');
    expect(popover.style.boxSizing).toBe('border-box');
  });

  it('shrinks to fit a narrow window', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 320 });
    make([]).openPopover(document.querySelector('h1')!, '', { onSave: vi.fn() });
    expect(popoverWidth()).toBe('304px');
  });
});
