# CLAUDE.md

Guidance for AI coding assistants working in this repository.

## What this is

Revamp is a Chrome extension (Manifest V3) that lets a project manager inspect a live page, change it by hand or through AI, keep the changes as a per-page demo, and export the result (static site ZIP or handoff package). It is a tool for agency workflows, not for end users of the edited sites.

Read before large changes: [PRD.md](PRD.md) (scope), [ARCHITECTURE.md](ARCHITECTURE.md) (structure and flows), [design.md](design.md) (UI rules), [TASKS.md](TASKS.md) (what is open).

## Commands

```bash
npm install
./build.sh            # clean build + manifest + icons: the only way to get a loadable dist/
npm run build         # tsc + content/background bundles + popup; does NOT copy manifest or icons
npm run dev           # watch build of the popup only
npm run type-check    # tsc --noEmit
npm test              # vitest (jsdom), all of tests/
npx vitest run tests/demo.test.ts    # one file
```

After a build, reload the extension in `chrome://extensions/` **and** refresh the tab: the content script is injected at page load.

Before finishing any change run `npm run type-check` and `npm test`. Behaviour in real Chrome is not covered by tests; say so when a change needs a manual check.

## Hard constraints

- Manifest V3 only. No `eval`, no inline scripts, no `new Function`, no remote code.
- Stack is TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`), React 18, Tailwind 3, Vite 5, JSZip. Do not introduce another framework or state library unless asked.
- All AI provider calls go through the service worker ([src/background/service-worker.ts](src/background/service-worker.ts)). The panel and content script never call an AI API.
- AI output is data, not code. The AI picks element ids and returns operations from the fixed catalog in [src/types/operations.ts](src/types/operations.ts). Never add an action that runs AI-supplied JavaScript, and keep `set_html` behind `sanitizeHtml`.
- Providers are accessed through `IAIProvider` ([src/ai/provider-interface.ts](src/ai/provider-interface.ts)). No provider-specific logic in UI components.
- Changes to the page must be reversible: every operation returns an inverse. Do not mutate the page in a way that cannot be undone.

## Architecture in five lines

1. The "popup" is an iframe the content script injects into the page; the toolbar icon sends `TOGGLE_PANEL`. There is no browser-action popup.
2. Panel to page messages go through `sendToTab` ([src/popup/tab-messaging.ts](src/popup/tab-messaging.ts)); the router is the `switch` in [src/content/content-script.ts](src/content/content-script.ts).
3. Elements are identified by Revamp ids from `PageIndex` (a `WeakMap`, nothing written to the DOM). Ids do not survive reload.
4. Persistence uses `Locator` (selector + tag + text start + ordinal), stored in `chrome.storage.session` under `tabDemo:<tabId>:<origin><pathname>` (per tab; the tab id comes from `getTabId` in [src/utils/tab-scope.ts](src/utils/tab-scope.ts)).
5. Export is split: the content script captures a `PageSnapshot`; the panel builds the ZIP in `buildStaticSite` ([src/export/build-package.ts](src/export/build-package.ts)).

## Conventions

- **Naming:** files are kebab-case (`page-index.ts`); React components are PascalCase (`DemoPanel.tsx`); utilities are classes or plain functions, one concern per file in `src/utils/`.
- **Comments:** explain why, not what. Match the existing sparse style; do not add banner comments or restate code.
- **Page-injected UI:** anything Revamp adds to the host page gets `data-revamp-ui="true"` (excluded from index, screenshots, export). Attributes written to site elements use the `data-revamp-` prefix and must be stripped on export (see the clone cleanup in the content script).
- **Overlays:** use the classes in [src/utils/highlight-overlay.ts](src/utils/highlight-overlay.ts); never set `outline`, `title` or other styles on a site element for highlighting.
- **Selectors:** use `SelectorGenerator` for generation and `SelectorGenerator.query` / `resolveLocator` for lookup; both tolerate invalid selectors. Do not call `querySelectorAll` on a selector from AI or storage without a try/catch.
- **Storage reads:** treat anything from `chrome.storage` or an imported file as untrusted; validate with `validateOperation` and `sanitizeAnnotations`.
- **Messages:** `{ type, payload? }` in, `{ success, data?, error? }` out. Add a new message type in the content-script `switch`, then document it in ARCHITECTURE.md section 5.
- **Tests:** put new tests in `tests/`, named `<area>.test.ts`. DOM-heavy code uses jsdom through `tests/setup.ts`. Add or update a test with every behaviour fix in `src/utils/` or `src/export/`.
- **UI text:** English, sentence case, outcome-focused (see design.md).

## Gotchas

- `npm run build` does not produce a loadable extension; use `./build.sh`. `emptyOutDir` is false, so stale files stay in `dist/` until `build.sh` deletes it.
- The content script and service worker are IIFE bundles built by `build-content.js`; adding a dynamic `import()` there is inlined, not code-split. The popup is built by `vite.config.ts` with chunks.
- `.gitignore` ignores every root `*.md` except the ones it whitelists. A new root-level doc is silently untracked unless it is whitelisted. Currently allowed: README, ARCHITECTURE, CLAUDE, design, PRD, TASKS.
- Settings lists nine providers; only OpenAI, Azure OpenAI, Claude and Gemini have adapters in the service worker. The rest return "not yet implemented". Do not claim support for them.
- `AIChatBox` first tries the operations format and falls back to the older selector-based format ([src/utils/ai-response-parser.ts](src/utils/ai-response-parser.ts), [src/utils/legacy-changes.ts](src/utils/legacy-changes.ts)). Keep the fallback working until it is deliberately removed.
- Never write file content (attachment `parts`) to `chrome.storage` or the per-tab chat history (`tabChat:<tabId>`): both are capped at 10 MB. Metadata only; content goes to IndexedDB through `attachmentStoreFor(tabId)`. Decide a file's type from its bytes (`sniffFileType`), never from its name or `file.type`.
- Attachments reach the model only through `buildRequestMessages` and the adapters' converters in `src/ai/message-format.ts`; add a provider's attachment support by extending `src/ai/capabilities.ts` and its converter.
- Page text in the AI index is sent in full (up to 800 characters per element). Do not shorten it for brevity; truncation caused the AI to rewrite text it had not seen.
- `chrome.tabs.captureVisibleTab` is rate limited (about 2 calls per second); full-page screenshots wait between frames on purpose.
- The panel iframe and the page are different origins; the panel cannot touch the page DOM and must go through messages.

## Working style for this project

- Be precise and conservative: do not invent Chrome APIs; check the manifest permissions before relying on one.
- Make the smallest change that solves the problem; do not redesign the product or add features that were not requested.
- When something is ambiguous, pick the safe, reversible option and say what you chose.
- Complex features start as an incremental MVP.
- Prefer maintainability over cleverness; this code will be extended for months and reviewed by senior developers.
- When you change behaviour, update the affected doc (ARCHITECTURE.md for structure and messages, TASKS.md for status, PRD.md only when scope changes).
- Do not create new top-level markdown files for notes or summaries; put the content in one of the six existing docs.
