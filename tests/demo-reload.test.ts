import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageIndex } from '../src/utils/page-index';
import { ChangeManager } from '../src/utils/change-manager';
import { DemoManager } from '../src/utils/demo-manager';
import { getTabId } from '../src/utils/tab-scope';

vi.mock('../src/utils/tab-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/tab-scope')>()),
  getTabId: vi.fn(),
}));

const store: Record<string, unknown> = {};
(globalThis as any).chrome = {
  storage: {
    session: {
      get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
      set: vi.fn(async (items: Record<string, unknown>) => Object.assign(store, JSON.parse(JSON.stringify(items)))),
      remove: vi.fn(async (key: string) => { delete store[key]; }),
    },
  },
};

const PAGE = `
  <header><h1>Welcome</h1></header>
  <section id="hero"><h2>Hero</h2><p>Hero text</p><img src="/hero.jpg" alt="hero"></section>
  <section id="cards">
    <div class="card"><img src="/a.jpg" alt=""><h3>Card</h3><p>Card text</p></div>
    <div class="card"><img src="/b.jpg" alt=""><h3>Card</h3><p>Card text</p></div>
  </section>
  <footer><p>Bye</p></footer>`;

let index: PageIndex;
let history: ChangeManager;
let demo: DemoManager;

const boot = async () => {
  index = new PageIndex();
  history = new ChangeManager();
  demo = new DemoManager(history, index);
  await demo.init();
};
const idOf = (selector: string, nth = 0) => index.idOf(document.querySelectorAll(selector)[nth]);
const flush = () => new Promise((resolve) => setTimeout(resolve, 400));
// What a visitor sees: attribute order and empty style attributes left by a revert make no difference
const visible = () => {
  const copy = document.body.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('*').forEach((el) => {
    const attrs = Array.from(el.attributes).filter((a) => !(a.name === 'style' && !a.value));
    Array.from(el.attributes).forEach((a) => el.removeAttribute(a.name));
    attrs.sort((a, b) => a.name.localeCompare(b.name)).forEach((a) => el.setAttribute(a.name, a.value));
  });
  return copy.innerHTML.replace(/\s+/g, ' ');
};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.mocked(getTabId).mockResolvedValue(3);
  document.body.innerHTML = PAGE;
});

describe('demo survives a reload', () => {
  it('replays a chat-style batch and toggles off and on cleanly', async () => {
    await boot();
    history.applyOperations(
      [
        { id: '1', op: 'set_text', target: idOf('h1'), text: 'New welcome', explanation: '' },
        { id: '2', op: 'set_text', target: idOf('#hero h2'), text: 'New hero', explanation: '' },
        { id: '3', op: 'replace_image', target: idOf('#hero img'), src: 'https://x.test/new-hero.jpg', explanation: '' },
        { id: '4', op: 'set_text', target: idOf('.card h3', 0), text: 'First card', explanation: '' },
        { id: '5', op: 'replace_image', target: idOf('.card img', 0), src: 'https://x.test/c1.jpg', explanation: '' },
        { id: '6', op: 'set_text', target: idOf('.card h3', 1), text: 'Second card', explanation: '' },
        { id: '7', op: 'replace_image', target: idOf('.card img', 1), src: 'https://x.test/c2.jpg', explanation: '' },
        { id: '8', op: 'duplicate', target: idOf('.card', 1), explanation: '' },
        { id: '9', op: 'set_text', target: idOf('.card h3', 1), in: '8', text: 'Third card', explanation: '' },
        { id: '10', op: 'replace_image', target: idOf('.card img', 1), in: '8', src: 'https://x.test/c3.jpg', explanation: '' },
        { id: '11', op: 'set_visibility', target: idOf('footer'), visible: false, explanation: '' },
      ] as any,
      index
    );
    const applied = visible();
    await flush();

    // reload: fresh DOM, fresh managers, same storage
    document.body.innerHTML = PAGE;
    const original = visible();
    await boot();

    expect(demo.getState().items.filter((i) => i.status === 'pending')).toHaveLength(0);
    expect(visible()).toBe(applied);

    demo.setEnabled(false);
    expect(visible()).toBe(original);
    demo.setEnabled(true);
    expect(visible()).toBe(applied);
    demo.setEnabled(false);
    expect(visible()).toBe(original);
  });

  it('tells the panel when the demo could not be saved, and clears it after the next good save', async () => {
    await boot();
    const set = vi.mocked(chrome.storage.session.set);
    set.mockRejectedValueOnce(new Error('Session storage quota bytes exceeded. Values were not stored.'));

    history.applyOperations([{ id: '1', op: 'set_text', target: idOf('h1'), text: 'New', explanation: '' }] as any, index);
    await flush();
    expect(demo.getState().saveError).toMatch(/too large for browser storage/i);

    history.applyOperations([{ id: '2', op: 'set_text', target: idOf('h1'), text: 'Newer', explanation: '' }] as any, index);
    await flush();
    expect(demo.getState().saveError).toBeUndefined();
  });

  it('reports other save failures with their reason', async () => {
    await boot();
    vi.mocked(chrome.storage.session.set).mockRejectedValueOnce(new Error('Extension context invalidated.'));

    history.applyOperations([{ id: '1', op: 'set_text', target: idOf('h1'), text: 'New', explanation: '' }] as any, index);
    await flush();

    expect(demo.getState().saveError).toContain('Extension context invalidated.');
  });
});
