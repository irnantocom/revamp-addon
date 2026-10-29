# Tasks

Status of delivered work and the open backlog. Product intent is in [PRD.md](PRD.md). Update this file when a task starts, finishes or is dropped.

Last verified: `npm test` 243 passed (20 files), `npm run type-check` clean.

## Delivered

| Phase | Scope | Notes |
|-------|-------|-------|
| 0. Bug fixes | `nth-of-type` instead of `nth-child`; uniqueness checks on every selector branch; duplicate id segments in CSS paths; XPath index `[1]`; guarded preview with scroll-into-view and clear feedback; per-change checkboxes; undo for remove and insert | Fixed the "wrong element selected" and "preview does nothing" bugs |
| 1. Indexed snapshot and operations | `PageIndex` with Revamp ids; 10-operation catalog; parser that rejects unknown operations; executor with inverses; prompt rewritten around ids; legacy selector format kept as fallback | AI no longer writes selectors |
| 2. Sections, persistence, export | Section list; save per URL and restore with locators and retries; demo on/off, reset, per-change revert; JSON import/export; static-site export (CSS bundle, assets, tracking removal) | Reorder via up/down buttons, not drag and drop |
| 3. Versions, share, presentation | Named versions and diff; share as JSON or `revamp1:` code; presentation mode; viewport and stitched full-page screenshots | No server |
| 4. Notes and handoff | Notes pinned to elements; "Ask AI to apply open notes"; handoff ZIP (`report.md`, `report.html`, `demo.json`, before/after PNG) | |
| Providers | OpenAI, Azure OpenAI, Claude, Gemini adapters; Azure endpoint, deployment and API-version settings with a real validation request | |
| Cleanup | Removed outdated markdown files; consolidated docs into six files; panel footer no longer says "Phase 2"; `*.zip` is ignored and `extention-v1.zip` is untracked | |
| Input validation | Control-character bypass of the `javascript:` check closed; attribute names validated (`srcdoc`, `on*`, `data-revamp-*` refused); invalid CSS values fail loudly instead of being ignored; legacy `insert`/`html` changes sanitized; panel shows the real error for edits; Update Text asks for confirmation when the element has child elements; `foreignObject` and dangerous SVG animations removed from inserted HTML | See `tests/input-validation.test.ts` |
| Chat attachments | Attach images, PDFs, videos (as 6 sampled frames) and documents (TXT, MD, CSV, JSON, HTML, DOCX) to the AI chat; paperclip, drag and drop, paste; type from magic bytes; IndexedDB for content, metadata in `chatHistory`; capability and size-budget notes instead of API errors | Plan in `docs/superpowers/plans/` (git-ignored). Verified in headless Chrome 150 for images, GIFs and video; the panel logic is covered by jsdom tests (`tests/ai-chat-send.test.ts`); the loaded-extension flow still needs a manual pass |
| Recent fixes | Editor tab keeps style field values after Apply Style and refreshes the attribute list (including `style`) after each edit; Inspector reads full element text; notes sent to the AI with the element's full content (not a 40-character label); export uses current images after a change; HTML and CSS export | See `git log` |

## Backlog

Priority: **P0** blocks release, **P1** next, **P2** later.

### Release readiness
- [ ] **P0** Confirm the icons in `public/icons/` are final, and prepare store listing assets (screenshots, description).
- [ ] **P0** Privacy policy and a written justification for the `<all_urls>` permission.
- [ ] **P1** Keep `package.json` and `public/manifest.json` versions in sync (script or CI check).
- [ ] **P1** Make `npm run build` produce a loadable `dist/` (move manifest and icon copy and popup HTML move from `build.sh` into the build, or make `build.sh` the documented path only).

### Providers and AI
- [ ] **P1** Manual pass of chat attachments in the loaded extension: paperclip dialog, drag and drop, paste (including text copied from Word or Excel), a real reply per provider (OpenAI `file` part, Claude 5 MB / 100-page PDF limits, Gemini), closing and reopening the panel, Clear chat empties IndexedDB, `chatHistory` holds no file data. Also check whether IndexedDB in the panel iframe is partitioned per website: if it is, a file attached on one site shows as "no longer available" on another.
- [ ] **P1** Verify PDF input on the Azure deployment's API version, then set `azure.pdf` to true in `src/ai/capabilities.ts`.
- [ ] **P1** Manual check of uploaded images on the page: replace an `<img>` with an attachment, undo, reload (demo replays it), export; try a site whose CSP sets `img-src` without `data:` and a `<picture>` image. Same for a hero `div` with a CSS background (with and without a gradient overlay): the index shows `bg-image="…"`, the AI keeps the gradient, `!important` beats the page's rule.
- [ ] **P2** Pseudo-element backgrounds (`::before`/`::after`): new operation with a property whitelist that tags the element with a `data-revamp-*` attribute and injects a `<style>` rule; must be undoable, persisted in the demo, kept in the export (attribute stripped). See "Images and backgrounds" in ARCHITECTURE.md.
- [ ] **P2** Show the new image in the preview before Apply, and downscale an oversized upload instead of refusing it.
- [ ] **P2** Native Gemini video input instead of sampled frames; OCR or text extraction for providers and models without vision.
- [ ] **P1** Remove attachment content that is no longer used: a file removed from a draft stays in IndexedDB until Clear chat, and Clear chat is disabled when the chat is empty. Add `delete` to `AttachmentStore` and call it from `remove`.
- [ ] **P2** Attachment polish from the review: HEIC/AVIF photos are reported as undecodable videos (check the `ftyp` brand in `file-sniff.ts`); DOCX tracked changes and field codes merge into the text; strip bidi/control characters from file names before they enter the prompt; wrap long names in error chips and notes; show a note only once instead of under every reply; await the IndexedDB transaction's `oncomplete` in `put`; catch `load()` errors per file; tell the user when earlier files go to a newly selected provider.
- [ ] **P1** Adapters for Groq and OpenRouter (OpenAI-compatible; smallest effort). Remove or hide providers from Settings that stay unimplemented (Perplexity, Mistral, Cohere).
- [ ] **P1** Use JSON mode or structured output where the provider supports it (Azure/OpenAI first) to cut parse failures.
- [ ] **P2** Streaming responses in the chat.
- [ ] **P2** Token and cost estimate before sending a large page index.

### Robustness
- [ ] **P1** Test coverage for the content-script message router and `PageIndex` (the two largest untested areas).
- [ ] **P1** `MutationObserver` re-apply for SPAs that overwrite edits after the retry window (15 s).
- [ ] **P2** Decide on iframes and Shadow DOM support; document the decision either way.
- [ ] **P2** Split `src/content/content-script.ts` (about 1,500 lines) into floating panel, inspector and message handlers.
- [ ] **P2** Split `src/popup/components/AIChatBox.tsx` (about 940 lines) and `DemoPanel.tsx` (about 610 lines).

### Demo and sharing
- [ ] **P1** Drag-and-drop section reordering.
- [ ] **P1** Persist imported `insert` changes from the legacy format (currently not saved).
- [ ] **P2** Hosted share links (needs a backend decision, see PRD risks).
- [ ] **P2** Warn when a share code is too long to paste comfortably and suggest the JSON file.

### Export
- [ ] **P1** Export a selected subtree instead of the whole page.
- [ ] **P2** Optional JavaScript bundle with a reviewed allowlist, so simple interactions survive.
- [ ] **P2** Visual regression check of the exported page against the live page on a few reference sites.

### Security
- [ ] **P1** Evaluate encrypting API keys at rest or routing through a team proxy.
- [ ] **P2** Review the `web_accessible_resources` entries (`content/*`, `popup/*` for all URLs) and narrow them if possible.

### UX
- [ ] **P1** First-run guidance: no API key set, no element selected, unsupported page.
- [ ] **P2** Keyboard and screen-reader pass on the panel (see design.md section 7).
- [ ] **P2** Dark mode.

## Conventions for this file
- One line per task; start with the priority.
- When a task is done, move it to **Delivered** with a one-line note rather than deleting it.
- Link a commit or file when a decision is not obvious from the task text.
