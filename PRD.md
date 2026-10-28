# Product Requirements: Revamp

## 1. Problem

Project managers and agencies need to show a client or a team what a website change would look like before any design or development work starts. Today that means screenshots in slides, rough mockups, or asking a developer to build a throwaway page. Each route is slow, loses the real page's fidelity, or burns developer time on something that may be rejected.

## 2. Product

Revamp is a Chrome extension that turns any live web page into an editable demo. The user describes changes in natural language or edits elements directly; the page changes in the browser immediately. The result can be presented, shared, handed to designers and developers as a precise change list, or exported as a static copy of the page.

The real website is never modified. Changes live in the user's browser.

## 3. Users

| User | Goal | Typical action |
|------|------|----------------|
| **Project manager** (primary) | Turn a requirement into a visible demo without engineering help | "Change the hero heading, hide the testimonials section, swap the banner image" |
| **Agency designer / strategist** | Pitch a revamp on the client's real site | Edit, save versions, present full-screen, screenshot |
| **Developer receiving the handoff** | Know exactly what to build | Read the change list with selectors, text and before/after screenshots |

Not the target: end users of the edited site, or people who need to publish changes to production.

## 4. Goals and non-goals

### Goals
1. A non-technical person can make a convincing demo of a page change in minutes.
2. AI changes are predictable and reversible: the user sees them before they apply and can revert any one.
3. Demos survive page reloads and can be passed to a teammate without a server.
4. A demo can be converted into artifacts others can act on: a change list, screenshots, a static copy.

### Non-goals
- Publishing edits to the live site or integrating with a CMS.
- Real-time collaboration or hosted share links (needs a backend; out of scope for now).
- Editing behaviour (JavaScript logic, forms, authentication flows).
- Pixel-perfect export of heavily scripted pages.
- Supporting iframes and Shadow DOM content.

## 5. Functional requirements

Priority: **P0** required for the product to work, **P1** expected, **P2** later. Status reflects the code today.

### Inspect and edit
| ID | Requirement | Pri | Status |
|----|-------------|-----|--------|
| F1 | Visually highlight the hovered element and select it by click; block page clicks while inspecting | P0 | Done |
| F2 | Generate stable selectors: `data-*` > unique id > CSS path (`nth-of-type`) > XPath | P0 | Done |
| F3 | Edit text, attributes and CSS of the selected element; undo | P0 | Done |
| F4 | Run in a floating panel that can be dragged, resized and toggled from the toolbar icon | P0 | Done |

### AI changes
| ID | Requirement | Pri | Status |
|----|-------------|-----|--------|
| F5 | Page-level and element-level AI requests from a chat box | P0 | Done |
| F6 | AI references elements by id from a page index and returns operations from a fixed catalog; no AI-written selectors or code | P0 | Done |
| F7 | Preview each proposed change, select which to apply, apply, revert individually or all | P0 | Done |
| F8 | Provider-agnostic adapter; work with OpenAI, Azure OpenAI, Claude, Gemini | P0 | Done |
| F9 | Full text of elements is sent so rewrite and translation cover everything; refuse to rewrite text the AI cannot see in full | P1 | Done |
| F10 | Perplexity, Mistral, Cohere, Groq, OpenRouter adapters | P2 | Not started (keys can be entered, requests fail with "not yet implemented") |
| F23 | Attach images, PDFs and text documents (TXT, MD, CSV, JSON, HTML, DOCX) to the AI chat as context that stays with the conversation; paperclip, drag and drop, paste | P1 | Done |
| F24 | Attach videos (MP4, WebM), sent to the AI as sampled still frames | P1 | Done |

### Demo management
| ID | Requirement | Pri | Status |
|----|-------------|-----|--------|
| F11 | Persist changes per page and re-apply after reload, including pages that render late | P0 | Done |
| F12 | Section list: hide/show, move up/down, duplicate, remove | P1 | Done (buttons, no drag and drop) |
| F13 | Demo on/off switch, reset, per-change revert | P1 | Done |
| F14 | Named versions with comparison | P1 | Done |
| F15 | Share as JSON file or text code; import from either | P1 | Done |
| F16 | Notes pinned to elements; turn open notes into an AI request | P1 | Done |
| F17 | Presentation mode (hide extension UI); viewport and full-page screenshots | P1 | Done |

### Output
| ID | Requirement | Pri | Status |
|----|-------------|-----|--------|
| F18 | Handoff package: change list (Markdown and HTML), before/after screenshots, demo JSON | P1 | Done |
| F19 | Static export ZIP: HTML, single CSS file, downloaded images and fonts, local URLs, failures reported | P0 | Done |
| F20 | Export removes analytics, ads, chat widgets and cookie banners; keeps lazy-loaded and reveal-on-scroll content visible | P1 | Done |
| F21 | Optional export of videos/audio and original scripts | P2 | Done (off by default) |
| F22 | Export of selected subtree only; JavaScript bundle; component extraction | P2 | Not started |

## 6. Non-functional requirements

| Area | Requirement |
|------|-------------|
| Platform | Chrome, Manifest V3, service worker (no persistent background page) |
| Stack | TypeScript (strict), React, Tailwind, Vite, JSZip; no other stacks unless decided |
| Security | No `eval`, no inline scripts; AI output is never executed as code; HTML from the AI is sanitized; AI requests only from the service worker |
| Privacy | Page content and attached files leave the browser only to the AI provider the user configured; the chat says so next to the attachments. API keys stay in `chrome.storage.local`; file content stays in IndexedDB |
| Non-destructive | The live site is never changed; every change has an inverse |
| Resilience | Selection by locator (selector + tag + text + ordinal) survives reloads; invalid saved or imported operations are skipped, not fatal |
| Performance | Index capped (400 elements, bounded text budget); export limited to 800 assets, 15 MB per file, 250 MB total |
| Quality | `npm test` and `npm run type-check` pass before merging |

## 7. Success measures

- A PM completes "change heading, hide section, replace image" on an unfamiliar site in under 5 minutes with no developer help.
- AI-proposed operations that fail to apply (target missing or invalid) stay under 5% of operations on the test sites.
- Exported static copy opens offline with layout matching the live page on the reference sites (a visual check per release).
- A teammate can reproduce a shared demo from a JSON file or code with no manual repair.

These are targets; there is no telemetry yet, so they are checked by hand.

## 8. Risks and open questions

| Risk or question | Notes |
|------------------|-------|
| SPA re-render overwrites edits | Mitigated by retry restore; a continuous `MutationObserver` re-apply is not built. Decide whether it is needed. |
| Shared demos without a server | JSON and codes work but long demos make long codes. Hosted links need a backend decision. |
| API key storage | Plain `chrome.storage.local`. A team proxy or encrypted storage may be required for agency use. |
| Export fidelity | Sites with CSS-in-JS runtime injection, canvas, or JS-driven layout will not match. Documented in the export README. |
| Iframes, Shadow DOM | Out of scope; decide if clients' sites need them. |
| Chrome Web Store release | Needs final icons, privacy policy and a permissions justification for `<all_urls>`. |
