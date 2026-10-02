import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageIndex } from '../src/utils/page-index';
import { ChangeManager } from '../src/utils/change-manager';
import { DemoManager } from '../src/utils/demo-manager';
import { captureLocator, resolveLocator } from '../src/utils/locator';

const store: Record<string, unknown> = {};
(globalThis as any).chrome = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
      set: vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items)),
      remove: vi.fn(async (key: string) => { delete store[key]; }),
    },
  },
};

const PAGE = `
  <header><h1>Welcome</h1></header>
  <section id="hero"><h2>Hero</h2><p>Hero text</p></section>
  <section id="about"><h2>About</h2><p>About text</p></section>
  <ul><li>Item</li><li>Item</li><li>Item</li></ul>
  <footer><p>Bye</p></footer>`;

let index: PageIndex;
let history: ChangeManager;
let demo: DemoManager;

const make = () => {
  index = new PageIndex();
  history = new ChangeManager();
  demo = new DemoManager(history, index);
};
const idOf = (selector: string, nth = 0) => index.idOf(document.querySelectorAll(selector)[nth]);

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  document.body.innerHTML = PAGE;
  make();
});

describe('locator', () => {
  it('re-finds repeated items by ordinal', () => {
    const second = document.querySelectorAll('li')[1];
    const loc = captureLocator(second);
    expect(resolveLocator(loc)).toBe(second);
  });

  it('falls back to tag + text when the structure changed', () => {
    const loc = captureLocator(document.querySelector('#about h2')!);
    document.body.insertAdjacentHTML('afterbegin', '<div><div><h2>About</h2></div></div>');
    document.querySelector('#about h2')!.remove();
    expect(resolveLocator(loc)?.textContent).toBe('About');
  });

  it('returns null when nothing matches', () => {
    const loc = captureLocator(document.querySelector('footer p')!);
    document.querySelector('footer')!.remove();
    expect(resolveLocator(loc)).toBeNull();
  });
});

describe('history', () => {
  it('reverting an earlier change also reverts later ones on the same element', () => {
    const h1 = idOf('h1');
    history.applyOperations([{ id: 'a', op: 'set_text', target: h1, text: 'A', explanation: '' }], index);
    history.applyOperations([{ id: 'b', op: 'set_text', target: h1, text: 'B', explanation: '' }], index);
    history.applyOperations([{ id: 'c', op: 'set_text', target: idOf('footer p'), text: 'C', explanation: '' }], index);

    const [first] = history.list();
    expect(history.revertByKey(first.key)).toBe(2);
    expect(document.querySelector('h1')!.textContent).toBe('Welcome');
    expect(document.querySelector('footer p')!.textContent).toBe('C');
    expect(history.list()).toHaveLength(1);
  });

  it('does not cascade to changes that merely use the element as a position reference', () => {
    history.applyOperations([{ id: 'h', op: 'set_visibility', target: idOf('#about'), visible: false, explanation: '' }], index);
    history.applyOperations([{ id: 'm', op: 'move', target: idOf('footer'), ref: idOf('#about'), position: 'before', explanation: '' }], index);

    expect(history.revertByKey(history.list()[0].key)).toBe(1);
    expect(document.querySelector<HTMLElement>('#about')!.style.display).toBe('');
    expect(document.querySelector('footer')!.nextElementSibling?.id).toBe('about');
    expect(history.list()).toHaveLength(1);
  });

  it('reverting a duplicate also reverts edits made inside the copy', () => {
    history.applyOperations([{ id: 'd', op: 'duplicate', target: idOf('#about'), explanation: '' }], index);
    const clone = document.querySelectorAll('section')[2];
    history.applyOperations([{ id: 'e', op: 'set_text', target: index.idOf(clone.querySelector('h2')!), text: 'Copy', explanation: '' }], index);
    expect(history.revertByKey(history.list()[0].key)).toBe(2);
    expect(document.querySelectorAll('section')).toHaveLength(2);
  });
});

describe('DemoManager', () => {
  const edit = () => {
    history.applyOperations([
      { id: 'a', op: 'set_text', target: idOf('h1'), text: 'Sail Beyond', explanation: 'Hero' },
      { id: 'b', op: 'set_visibility', target: idOf('#about'), visible: false, explanation: 'Hide about' },
      { id: 'c', op: 'move', target: idOf('footer'), ref: idOf('#hero'), position: 'before', explanation: 'Footer up' },
      { id: 'd', op: 'set_text', target: idOf('li', 1), text: 'Second', explanation: 'Second item' },
    ], index);
  };

  it('saves applied operations and replays them on a fresh page load', async () => {
    edit();
    await new Promise((r) => setTimeout(r, 400));
    expect(Object.keys(store)).toEqual([expect.stringContaining('demo:')]);

    // "Reload": pristine DOM, new session objects
    document.body.innerHTML = PAGE;
    make();
    await demo.init();

    expect(document.querySelector('h1')!.textContent).toBe('Sail Beyond');
    expect(document.querySelector<HTMLElement>('#about')!.style.display).toBe('none');
    expect(document.querySelectorAll('li')[1].textContent).toBe('Second');
    expect(document.querySelectorAll('li')[0].textContent).toBe('Item');
    expect(document.querySelector('footer')!.nextElementSibling?.id).toBe('hero');
    expect(demo.getState().items).toHaveLength(4);
  });

  it('keeps changes pending when the element is not on the page yet', async () => {
    edit();
    await new Promise((r) => setTimeout(r, 400));

    document.body.innerHTML = '<header><h1>Welcome</h1></header>';
    make();
    await demo.init();

    const state = demo.getState();
    expect(state.items.filter((i) => i.status === 'applied')).toHaveLength(1);
    expect(state.items.filter((i) => i.status === 'pending')).toHaveLength(3);
    // pending changes survive being saved again
    await new Promise((r) => setTimeout(r, 400));
    expect((store[`demo:${location.origin}${location.pathname}`] as any).operations).toHaveLength(4);
  });

  it('turning demo mode off restores the page and keeps the saved changes', async () => {
    edit();
    demo.setEnabled(false);
    expect(document.querySelector('h1')!.textContent).toBe('Welcome');
    expect(document.querySelector<HTMLElement>('#about')!.style.display).toBe('');
    expect(demo.toConfig().operations).toHaveLength(4);
    expect(demo.toConfig().enabled).toBe(false);

    demo.setEnabled(true);
    expect(document.querySelector('h1')!.textContent).toBe('Sail Beyond');
    expect(history.getUndoStackSize()).toBe(4);
  });

  it('export then import reproduces the demo', () => {
    edit();
    const config = JSON.parse(JSON.stringify(demo.toConfig()));

    document.body.innerHTML = PAGE;
    make();
    const result = demo.importConfig(config);

    expect(result).toEqual({ applied: 4, pending: 0 });
    expect(document.querySelector('h1')!.textContent).toBe('Sail Beyond');
  });

  it('rejects files that are not demos', () => {
    expect(() => demo.importConfig({ hello: 'world' })).toThrow(/Not a Revamp demo/);
    expect(() => demo.importConfig({ kind: 'revamp-demo', version: 2, operations: [] })).toThrow(/version/);
  });

  it('reset clears the page and the saved demo', async () => {
    edit();
    await new Promise((r) => setTimeout(r, 400));
    await demo.reset();
    expect(document.querySelector('h1')!.textContent).toBe('Welcome');
    expect(Object.keys(store)).toHaveLength(0);
  });
});

describe('listSections', () => {
  it('lists top-level blocks with move neighbours and keeps hidden ones', () => {
    history.applyOperations([{ id: 'h', op: 'set_visibility', target: idOf('#about'), visible: false, explanation: '' }], index);
    const sections = index.listSections();
    const about = sections.find((s) => s.label === 'About')!;
    expect(about.hidden).toBe(true);
    const hero = sections.find((s) => s.label === 'Hero')!;
    expect(hero.canMoveUp).toBe(true); // header sits before it
    expect(hero.nextId).toBe(about.id);
  });
});

describe('annotations', () => {
  it('adds, updates, resolves and deletes notes, and re-finds their elements', () => {
    const note = demo.addAnnotation(document.querySelector('#hero h2')!, '  Replace heading  ');
    expect(note.text).toBe('Replace heading');

    let [info] = demo.listAnnotations();
    expect(info).toMatchObject({ number: 1, found: true, resolved: false });
    expect(index.resolve(info.elementId!)).toBe(document.querySelector('#hero h2'));

    demo.updateAnnotation(note.id, { resolved: true, text: 'Done' });
    [info] = demo.listAnnotations();
    expect(info).toMatchObject({ resolved: true, text: 'Done' });

    document.querySelector('#hero')!.remove();
    expect(demo.listAnnotations()[0].found).toBe(false);

    expect(demo.deleteAnnotation(note.id)).toBe(true);
    expect(demo.listAnnotations()).toHaveLength(0);
    expect(demo.deleteAnnotation('nope')).toBe(false);
  });

  it('persists notes with the demo, and across export/import', async () => {
    demo.addAnnotation(document.querySelector('footer p')!, 'Client wants this moved up');
    await new Promise((r) => setTimeout(r, 400));

    document.body.innerHTML = PAGE;
    make();
    await demo.init();
    expect(demo.listAnnotations()).toHaveLength(1);
    expect(demo.listAnnotations()[0].found).toBe(true);

    const config = JSON.parse(JSON.stringify(demo.toConfig()));
    make();
    demo.importConfig(config);
    expect(demo.listAnnotations()[0].text).toBe('Client wants this moved up');
  });

  it('ignores malformed annotations in imported files', () => {
    demo.importConfig({
      kind: 'revamp-demo', version: 1, operations: [],
      annotations: [{ nope: 1 }, { id: 'a', text: 'ok', target: { tag: 'h1', selector: 'h1' } }],
    });
    expect(demo.getAnnotations()).toHaveLength(1);
  });

  it('skips imported operations with invalid arguments', () => {
    const result = demo.importConfig({
      kind: 'revamp-demo', version: 1,
      operations: [{ id: 'x', op: 'set_text', explanation: '', target: { selector: 'h1', tag: 'h1', text: 'Welcome', ord: 0 }, args: {} }],
    });
    expect(result).toEqual({ applied: 0, pending: 0 });
    expect(document.querySelector('h1')!.textContent).toBe('Welcome');
  });
});

describe('notes for the AI', () => {
  it('includes the full text of the annotated element and ids of its children', () => {
    const long = 'Diakui sebagai ibu kota furnitur China, Foshan adalah rumah bagi ribuan pabrik. '.repeat(5).trim();
    document.body.innerHTML = `<section id="s"><h2>Title</h2><p id="para">${long}</p></section>`;
    make();
    demo.addAnnotation(document.querySelector('#para')!, 'Translate to Indonesian');
    demo.addAnnotation(document.querySelector('#s')!, 'Make friendlier');
    const done = demo.addAnnotation(document.querySelector('h2')!, 'Already done');
    demo.updateAnnotation(done.id, { resolved: true });

    const notes = demo.openNotesWithContext();
    expect(notes).toHaveLength(2);

    const paragraph = notes[0];
    expect(paragraph.context).toContain(long);
    expect(paragraph.context).toContain(`[${paragraph.elementId}] p`);

    // A section note carries its children with their own ids, so the AI can edit them
    const section = notes[1];
    expect(section.context).toContain(long);
    expect(section.context).toMatch(/\[\d+\] h2 "Title"/);
  });
});
