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
