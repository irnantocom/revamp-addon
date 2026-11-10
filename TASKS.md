# Tasks

Status of delivered work and the open backlog. Product intent is in [PRD.md](PRD.md). Update this file when a task starts, finishes or is dropped.

Last verified: `npm test` 408 passed (32 files), `npm run type-check` clean.

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
| Per-tab state | AI chat, chat attachments and the demo are kept per browser tab (`chrome.storage.session`, one IndexedDB database per tab); a new tab starts clean, a reload keeps the tab's state, closing the tab discards it (unsaved demo and chat are also lost when the extension is updated or reloaded) | Spec and plan in `docs/superpowers/` (git-ignored). Unit-tested; the loaded-extension flow still needs a manual pass (see Backlog) |
| Recent fixes | Editor tab keeps style field values after Apply Style and refreshes the attribute list (including `style`) after each edit; Inspector reads full element text; notes sent to the AI with the element's full content (not a 40-character label); export uses current images after a change; HTML and CSS export; the Editor tab's selected-element card uses the compact style of the AI chat banner | See `git log` |
| Page content from a document | A document attached to a page-wide request is mapped onto the page's sections; sections it leaves out are offered for hiding (**Hide them**, undoable), never removed; a long page's index and a reply cut at the output limit are reported | Prompt rule 11, `SECTION_COVERAGE`, `PageIndex.untouchedSections`. Unit-tested; the manual check is open in Backlog |
| Images on the page | An uploaded image replaces an `<img>` or a CSS `background-image` (`attachment:<id>` becomes a data URL in the panel, 2,000,000-character cap); `bg-image` entries in the index; pictures from a web page named in the chat, with a WordPress media-library fallback only when that page has fewer pictures than the edited page has places; one picture at several sizes is listed once; each picture is used at most once | `attachment-refs.ts`, `web-images.ts`. Limits in ARCHITECTURE.md "Images and backgrounds". Unit-tested; manual checks open in Backlog. The replaced images no longer repeat (checked in Chrome) |
| Layout safety | `set_html` that would strip a section's classes and styles is refused (`layoutRisk`); the panel asks the page (`CHECK_OPERATIONS`) and has the model redo refused operations once; operations on a duplicate (`in`), so the model can reuse the page's own sections and move them; tables as inline-styled HTML | Verified in Chrome on the Christmas Cruise document ("starting to look good"); undo, reload and export of copies still to check |
| Long and empty replies | Output-limit detection for all four providers; one retry with a bigger budget, then up to two continuations merged by id; an empty reply explains itself (finish reason, reasoning tokens) | `reply-continuation.ts`. Unit-tested; the cost of the extra requests is still to be observed |
| Demo lost on reload | A demo too large for `chrome.storage.session` (10 MB) was not saved, silently, so a reload lost every change while Demo mode still showed On. The panel now shows why (`saveError` in `DEMO_STATE`), and an applied upload is re-encoded to WebP (1600 px at most, `image-shrink.ts`) so more pictures fit | Reproduced in Chrome 150 with nine 1.9 MB images; `tests/demo-reload.test.ts`, `tests/attachment-refs.test.ts`. A demo of many large pictures can still pass 10 MB: the notice says so. Whether this is what you hit on your page is unconfirmed |
| Inspector in Editor, Tokens tab | The Inspector tab is gone: its start/stop toggle is in the Editor header (as in AI Chat), Editor is the opening tab and is always enabled. The service worker records the token usage of every AI reply (`tokenUsage` in `chrome.storage.local`, latest 1,000); a Tokens tab after Settings shows totals by range, per model and per request | `use-inspector.ts`, `token-usage.ts`, `TokenUsagePanel.tsx`; `tests/token-usage.test.ts`, `tests/app-tabs.test.ts`, `tests/element-editor.test.ts`. Not yet checked in the loaded extension |
| Azure and OpenAI fixes | `temperature` and `max_completion_tokens` adapt to reasoning models; the token limit drops to the ceiling the API reports; Azure endpoints keep a gateway base path (API Management) and show the gateway's error message | Unit-tested (`azure-provider.test.ts`, `openai-provider.test.ts`); chat replies came back from the Azure deployment in later runs (the APIM endpoint and each deployment were not tested one by one) |

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
- [ ] **P1** Manual check of replacing content from a document: a long page and a short document (the sections left out show a banner and **Hide them** hides them, Undo brings them back), a page over 400 indexed elements (note under the reply), a reply cut at the token limit (warning). The cut-off handling is now automatic (retry with a bigger budget, then up to two continuations): check how many extra requests a long page needs and what they cost, then decide whether a manual **Continue** button is still wanted, and whether an AI-side plan step (map document to sections first, then apply per section) is needed for very long pages.
- [ ] **P1** Manual check of images from another site: name a real site in the chat (a static one such as https://www.tallship.com.sg, and a JavaScript-built one to see the "no images found" note), ask for hero and card images, apply, undo, reload, export. Watch for hotlink protection (broken image, failed request in DevTools) and for CSP `img-src` on the target page.
- [ ] **P1** Manual check of image variety: a reference page with plenty of pictures (no library read, no repeats), and one with few (the note says how many came from the media library, the replaced images match the document's topic and none is used twice). If many places stay unchanged because the library is too thin, raise `LIBRARY_PAGES` or let the user name a second reference page.
- [ ] **P2** Images from another site, next steps: download the chosen image into the demo as a data URL when hotlinking fails (reuse `resolveAttachmentSources` with the 2 MB cap); try `referrerpolicy="no-referrer"` on replaced images; let the model see candidate images (send a few thumbnails) so it chooses by content instead of alt text; read the rendered page for JavaScript-built sites.
- [ ] **P1** Manual check of the layout guard with the Christmas Cruise document on the furniture template: no section is left unstyled, the sections whose `set_html` was refused come back as separate text changes, and the repair pass costs one extra request. If the model keeps rebuilding sections, consider showing class names (or a structure outline) of the target in the index.
- [ ] **P1** Manual check of layouts built from the page's own sections: a document with more items than the template has columns or cards (duplicate + `in` + move), a document with a table (shows as a styled table, readable on the template's background and in dark sections), then undo, reload (the demo replays the copies) and export. Check that `in` operations work when the duplicated section sits inside a wrapper the page re-renders.
- [ ] **P2** Show the copy, not the original, in the preview eye for operations with `in`; let `move` take `refIn` so a copy can be placed next to another copy.
- [ ] **P2** `set_text` replaces everything inside an element, including icons and nested spans (`textContent`). A text-preserving variant (write the text into the first text node and keep child elements) would protect icon buttons and labels; not built because no breakage was seen yet.
- [ ] **P2** Reasoning models (gpt-5 / o-series style deployments) spend output tokens on thinking. If empty or cut-off replies keep happening on long pages, add a per-provider setting for reasoning effort (`reasoning_effort` on OpenAI/Azure; check that the deployment accepts it first, and drop it on a 400 like `temperature`). Not built: the parameter is unverified for the deployments in use.
- [ ] **P2** Pseudo-element backgrounds (`::before`/`::after`): new operation with a property whitelist that tags the element with a `data-revamp-*` attribute and injects a `<style>` rule; must be undoable, persisted in the demo, kept in the export (attribute stripped). See "Images and backgrounds" in ARCHITECTURE.md.
- [ ] **P2** Show the new image in the preview before Apply. (Large uploads are now re-encoded to WebP, 1600 px at most, before they are applied; the 2,000,000-character cap is checked after that.)
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
- [ ] **P1** Manual pass of per-tab state in the loaded extension: a second tab (same and different URL) shows an empty chat and Demo tab; reload and reopening the panel keep a tab's own state; Clear chat in one tab leaves another tab's attachments; after closing a tab `chrome.storage.session.get(null)` has none of its keys; `GET_TAB_ID` returns an id for the panel iframe (if not, fall back to `chrome.tabs.query` as in `withActiveTab`).
- [ ] **P2** Attachment databases of closed tabs are deleted when a panel opens, but only those in that site's IndexedDB partition; databases of tabs on other sites wait until a panel opens there. A reused tab id after a browser restart can reopen an old database (its files are unreachable, not shown).
- [ ] **P2** Legacy `demo:<origin><pathname>` entries in `chrome.storage.local` are no longer read; remove them or offer an import. Saved versions (`demoVersions:`) are still per page, shared by all tabs.
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
