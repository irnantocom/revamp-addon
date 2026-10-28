# Architecture

## 1. Overview

Three execution contexts, connected by Chrome message passing:

```
┌──────────────────────────────┐   iframe (extension origin)
│ Panel UI  (src/popup, React) │◄──────────────────────────────┐
│ tabs: Inspector Editor AI    │                               │ injected by
│       Demo Export Settings   │                               │ content script
└───────┬──────────────┬───────┘                               │
        │ chrome.tabs  │ chrome.runtime                        │
        │ .sendMessage │ .sendMessage                          │
        ▼              ▼                                       │
┌──────────────────┐  ┌───────────────────────────┐            │
│ Content script   │  │ Service worker            │            │
│ (page context)   │  │ - toggle/inject panel     │            │
│ - inspector      │  │ - settings (storage)      │            │
│ - page index     │  │ - AI requests + providers │            │
│ - operations     │  │ - model list, key check   │            │
│ - demo manager   │  │ - captureVisibleTab       │            │
│ - annotations    │  └───────────┬───────────────┘            │
│ - floating panel ├──────────────┼────────────────────────────┘
└────────┬─────────┘              ▼
         ▼                  AI provider APIs
   Target web page
```

The panel is **not** a browser-action popup. Clicking the toolbar icon sends `TOGGLE_PANEL` to the content script, which injects a draggable, resizable container with an `<iframe src="popup/index.html">`. The service worker injects the content script first if the tab does not have it yet. Everything Revamp adds to the page is marked `data-revamp-ui` so indexing, screenshots and export skip it.

The panel talks to the page through `sendToTab` ([src/popup/tab-messaging.ts](src/popup/tab-messaging.ts)), which targets the content script of the active tab.

## 2. Source map

| Path | Responsibility |
|------|----------------|
| [public/manifest.json](public/manifest.json) | MV3 manifest: `activeTab`, `storage`, `scripting`, host `<all_urls>`, CSP `script-src 'self'`. |
| [src/background/service-worker.ts](src/background/service-worker.ts) | Icon click handling, settings, AI routing, model fetch, key validation, tab screenshots. |
| [src/ai/](src/ai) | `IAIProvider` interface plus OpenAI, Azure OpenAI, Claude, Gemini adapters. |
| [src/content/content-script.ts](src/content/content-script.ts) | Message router and orchestration: inspector, floating panel, preview, demo, notes, export snapshot. |
| [src/popup/](src/popup) | React panel. `App.tsx` owns tab state and the selected element; `components/` has one component per tab plus `ChangePreview` and `VersionsPanel`. |
| [src/utils/page-index.ts](src/utils/page-index.ts) | Numeric Revamp ids, text index for the AI, section tree. |
| [src/utils/operation-parser.ts](src/utils/operation-parser.ts) | Parse and validate AI JSON into `Operation[]`. |
| [src/utils/operation-executor.ts](src/utils/operation-executor.ts) | Apply one operation and return its inverse; HTML sanitizer. |
| [src/utils/change-manager.ts](src/utils/change-manager.ts) | History of applied operations (max 200), per-change and global revert. |
| [src/utils/locator.ts](src/utils/locator.ts) | Durable element description that survives reloads. |
| [src/utils/demo-manager.ts](src/utils/demo-manager.ts) | Persist, restore, toggle, reset, import/export a demo; owns annotations. |
| [src/utils/demo-versions.ts](src/utils/demo-versions.ts) | Named versions, diff between versions, operation descriptions. |
| [src/utils/annotation-layer.ts](src/utils/annotation-layer.ts) | Numbered note pins drawn over the page. |
| [src/utils/selector-generator.ts](src/utils/selector-generator.ts) | Stable selectors (data-* > id > CSS path > XPath). |
| [src/utils/highlight-overlay.ts](src/utils/highlight-overlay.ts) | Hover/pick/preview overlays that never touch the page's own styles. |
| [src/utils/prompt-builder.ts](src/utils/prompt-builder.ts) | System prompt with the page index and the operation catalog. |
| [src/utils/ai-response-parser.ts](src/utils/ai-response-parser.ts), [legacy-changes.ts](src/utils/legacy-changes.ts) | Older selector-based response format, converted into operations. |
| [src/utils/share-code.ts](src/utils/share-code.ts) | Demo to `revamp1:` text code (deflate + base64url). |
| [src/utils/handoff-report.ts](src/utils/handoff-report.ts) | Markdown and HTML change report. |
| [src/utils/screenshot.ts](src/utils/screenshot.ts) | Viewport and stitched full-page screenshots. |
| [src/export/](src/export) | Static-site export pipeline (see section 6). |
| [src/types/](src/types) | Shared types: operations, demo, inspector, snapshots. |
| [tests/](tests) | Vitest suites for selectors, operations, demo, annotations, versions, handoff, export, Azure provider, element editor, input validation. |

## 3. AI edit pipeline

The AI never writes selectors or code. It picks element ids from a numbered index and returns operations from a fixed catalog.

```
Panel (AIChatBox)                     Content script                  Service worker
─────────────────                     ──────────────                  ──────────────
GET_PAGE_INDEX  ───────────────────►  PageIndex.build(scope)
                ◄───────────────────  { index text, rootId, count }
buildSystemPrompt(index) + user text
AI_REQUEST ───────────────────────────────────────────────────────►  provider.generateCompletion
           ◄───────────────────────────────────────────────────────  raw text
parseOperationsResponse(raw)  → Operation[]  (falls back to legacy format)
PREVIEW_OPERATIONS ─────────────────► highlight targets (overlay)
user ticks changes in ChangePreview
APPLY_OPERATIONS ───────────────────► applyOperation() per op
                                       ├─ validate target still exists
                                       ├─ mutate DOM, record inverse
                                       └─ ChangeManager.push → DemoManager.save
```

**Operation catalog** ([src/types/operations.ts](src/types/operations.ts)): `set_text`, `set_attr`, `set_style`, `set_visibility`, `set_html`, `remove`, `move`, `duplicate`, `replace_image`, `set_link`. Every operation has `id`, `op`, `target` (Revamp id) and a short `explanation`.

**Safety rules**
- Operations not in the catalog are rejected by the parser.
- `set_html` (and the legacy `html` / `insert` changes) go through `sanitizeHtml`: `script, style, iframe, object, embed, link, meta, base, form, foreignObject` are removed, SVG animations (`animate`, `set`, `animateTransform`, `animateMotion`) are removed only when they target a URL or `on*` attribute or carry an unsafe URL (harmless ones such as spinners stay), `on*` attributes are dropped, and `javascript:`, `vbscript:` and `data:text/html` URLs are dropped. URL checks ignore tabs, newlines and other control characters, because browsers do too (`java<TAB>script:` is still `javascript:`).
- Attributes are set only through `setSafeAttribute`: the name must be a valid attribute name, and `on*`, `srcdoc` and `data-revamp-*` are refused.
- Inline styles are set only through `applyStyles`: every declaration is tried on a scratch element first, so a value the browser would silently ignore (`24` without a unit, `red; }`) fails with a clear message and nothing is half-applied. A trailing `!important` is accepted; an empty value removes the property.
- Edit messages (`EDIT_TEXT`, `EDIT_ATTRIBUTE`, `APPLY_CSS`) answer with the real result (`success: false` plus the reason); the panel shows that reason and keeps the form as typed.
- Each applied operation stores an inverse, so revert does not depend on re-finding the element by selector.
- All provider calls happen in the service worker; the panel and content script never see the network request to an AI API.

### Page index

`PageIndex` assigns each meaningful element (landmarks, text tags, media) a numeric id held in a `WeakMap`, so ids are stable within a page session and nothing is written to the DOM. It renders `[id] tag "text"` lines, indented by nesting, capped at 400 entries. Editable text is shown in full (up to 800 characters, 40 000 per index) so the AI can rewrite or translate all of it; longer text is marked `…[TRUNCATED: N chars total]` and the prompt forbids rewriting it. Elements hidden by Revamp stay listed as `(HIDDEN)`.

Scope is **element** when the user has a selection (that element and its descendants), otherwise **page**.

## 4. Persistence and element location

Ids die on reload, so saved changes use a `Locator` ([src/utils/locator.ts](src/utils/locator.ts)): structural selector, tag, first 80 characters of normalized text, and an ordinal among identical elements. `resolveLocator` tries, in order:

1. the selector, if it still points at one element with the same tag and text;
2. any element with the same tag and text, picked by ordinal;
3. the selector alone, if only the text changed.

`DemoManager` ([src/utils/demo-manager.ts](src/utils/demo-manager.ts)):
- saves `DemoConfig` (name, `pageKey`, enabled flag, `PersistedOperation[]`, annotations) with a 300 ms debounce;
- on load, replays operations; those that cannot be located stay **pending** and are retried at 1 s, 3 s, 7 s and 15 s (late-rendering SPAs);
- when demo mode is switched off, operations are parked and the page reverts;
- validates every imported or stored operation again before applying it.

| Storage key (`chrome.storage.local`) | Value |
|-----|------|
| `settings` | `{ aiProvider, apiKeys, azure: { endpoint, apiVersion, deployment }, ... }` |
| `demo:<origin><pathname>` | `DemoConfig` for that page |
| `demoVersions:<origin><pathname>` | `DemoVersion[]` |
| `localStorage["revamp-panel-position"]` (host page) | floating panel x/y |

## 5. Message reference

**Panel/content script → service worker:** `PING`, `GET_SETTINGS`, `UPDATE_SETTINGS`, `AI_REQUEST`, `FETCH_MODELS`, `VALIDATE_API_KEY`, `CAPTURE_VISIBLE_TAB`, `INJECT_CONTENT_SCRIPT`.

**Panel → content script** (via `chrome.tabs.sendMessage`):

| Group | Types |
|-------|-------|
| Panel and inspector | `TOGGLE_PANEL`, `START_INSPECTOR`, `STOP_INSPECTOR`, `GET_SELECTED_ELEMENT`, `GET_ELEMENT_INFO` |
| Manual edits | `EDIT_TEXT`, `EDIT_ATTRIBUTE`, `APPLY_CSS`, `UNDO_EDIT` |
| AI and operations | `GET_PAGE_INDEX`, `PREVIEW_OPERATIONS`, `APPLY_OPERATIONS`, `PREVIEW_CHANGES`, `CLEAR_PREVIEW`, `UNDO_CHANGE`, `UNDO_ALL`, `APPLY_AI_CHANGE`, `APPLY_AI_REVAMP`, `LOCATE_ELEMENT` |
| Demo | `DEMO_STATE`, `DEMO_SET_ENABLED`, `DEMO_SET_NAME`, `DEMO_REVERT`, `DEMO_RESET`, `DEMO_EXPORT`, `DEMO_IMPORT` |
| Notes | `ANNOTATION_ADD`, `ANNOTATION_UPDATE`, `ANNOTATION_DELETE`, `ANNOTATION_VISIBLE`, `ANNOTATION_NOTES_CONTEXT` |
| Presentation and output | `PRESENTATION_SET`, `SCREENSHOT`, `HANDOFF_CAPTURE`, `EXPORT_SNAPSHOT`, `GET_PAGE_HTML`, `GET_SUBTREE_SNAPSHOT` |

**Content script → panel:** `ELEMENT_SELECTED` (broadcast with `chrome.runtime.sendMessage`).

Responses use `{ success, data?, error? }`.

## 6. Static export pipeline

Runs in two places: capture in the page, build in the panel.

```
Panel (ExportPanel)                      Content script
───────────────────                      ──────────────
EXPORT_SNAPSHOT(options) ──────────────► capturePageSnapshot()
                                          ├─ optional scroll pass (lazy images, reveal-on-scroll)
                                          ├─ clone DOM; drop data-revamp-ui, tracking, noise
                                          ├─ promote lazy attributes (data-src, data-bg, ...)
                                          ├─ absolute URLs
                                          └─ collect stylesheets in cascade order
                         ◄─────────────  PageSnapshot { html, sheets[], warnings }
buildStaticSite(snapshot, options, fetcher)
  1. resolve sheets: fetch cross-origin CSS, inline @import (depth ≤ 5), keep media queries
  2. collect asset URLs from HTML and CSS (images, fonts, optional media)
  3. download (6 parallel; ≤ 800 assets, ≤ 15 MB each, ≤ 250 MB total)
  4. rewrite URLs to assets/<kind>/<name>-<hash>.<ext>
  5. emit index.html, css/styles.css, assets/, README.txt, report.json
JSZip → download <host>-static-<date>.zip
```

Notes:
- The panel downloads assets with `fetch` from the extension origin, so cross-origin files work through `host_permissions`.
- Failed downloads keep their original absolute URL, so the exported page still works online.
- `STATIC_SAFETY_CSS` forces `[data-aos]` and `.elementor-invisible` content visible, since scripts are removed.
- `includeDemo = false` exports the original page without the applied operations.
- Tracking and noise filtering lives in [src/export/tracking.ts](src/export/tracking.ts) (host list, URL patterns, known widget containers).

## 7. Build pipeline

```
npm run build
 ├─ tsc                       type-check only (noEmit)
 ├─ node build-content.js     Vite lib build, IIFE → dist/content/content-script.js
 │                            and dist/background/service-worker.js
 └─ vite build                popup (React + Tailwind) → dist/popup/
build.sh adds: rm -rf dist first; copy public/manifest.json and public/icons; move popup HTML.
```

Content script and service worker are separate IIFE bundles with `inlineDynamicImports`, because content scripts cannot be ES modules and the service worker must be one file. The popup is a normal multi-chunk Vite build. `emptyOutDir` is false in both, so stale files persist until `build.sh` wipes `dist/`.

## 8. Security boundaries

- MV3 CSP `script-src 'self'; object-src 'self'`: no `eval`, no inline scripts.
- AI output is data, never code: fixed operation catalog, sanitized HTML, no script action.
- API keys live in `chrome.storage.local`, read only by the service worker for provider calls.
- `<all_urls>` host access is required for asset download and injection; there is no remote code loading.
- The panel iframe is an extension page; the host page cannot read its DOM, but page CSS can still affect the container, which is why the container uses explicit styles.
