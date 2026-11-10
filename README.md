# Revamp: AI Page Editor

A Chrome extension (Manifest V3) for project managers and agencies. Open any website, describe changes in plain language or edit elements by hand, and show the result live in your browser. Then export the page as a static copy (HTML, CSS, assets) or hand the changes over to designers and developers.

Changes are temporary and local to your browser. The real website is never modified.

## Features

| Area | What it does |
|------|--------------|
| **Editor** | Start the inspector (hover to highlight, click to select an element), then edit its text, attributes and CSS, with undo. Works inside a floating, draggable, resizable panel. |
| **AI Chat** | Ask for changes ("make the hero heading shorter, hide the second section"). The AI returns structured operations that you preview, tick or untick, and apply. Page-level or element-level scope. Attach images, PDFs, videos (sent as frames) or documents (TXT, MD, CSV, JSON, HTML, DOCX) as context with the paperclip, drag and drop or paste. |
| **Demo mode** | Applied changes are saved per page and re-applied after reload. Section list (hide, show, move up/down, duplicate, remove), per-change revert, reset, on/off switch. |
| **Notes** | Pin notes to elements. "Ask AI to apply open notes" turns them into an AI request. |
| **Versions and sharing** | Save named versions, compare them, share a demo as a JSON file or a text code (no server). |
| **Presentation** | Hide the extension UI, take viewport or full-page screenshots. |
| **Handoff package** | ZIP with a change list (Markdown and HTML), before/after screenshots and the demo JSON. |
| **Tokens** | Token usage of every AI request (input, output, reasoning, total) per model and per request, for today, the last 7 days or all kept history. |
| **Static export** | ZIP with `index.html`, one `css/styles.css`, downloaded images and fonts, URLs rewritten to local paths. Tracking scripts, chat widgets and cookie banners are removed. |

AI providers with a working adapter: **OpenAI**, **Azure OpenAI**, **Anthropic Claude**, **Google Gemini**. Settings also lists Perplexity, Mistral, Cohere, Groq and OpenRouter, but those return "not yet implemented".

Attachments: OpenAI, Claude and Gemini accept images and PDFs; Azure OpenAI accepts images only for now. Documents are sent as text to every provider. Attached files are sent to the provider you selected. An attached image can replace an image on the page ("replace the hero image with the one I uploaded"); very large images are refused, and pages with a strict Content Security Policy may block them.

## Quick start

Requirements: Node.js 18+ and Chrome.

```bash
npm install
./build.sh          # clean build, copies manifest and icons into dist/
```

Load it in Chrome:

1. Open `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select the `dist` folder.
3. Open a regular `http(s)` page and click the Revamp icon. The panel appears on the page.
4. In **Settings**, add an API key for a provider (Azure also needs the endpoint, the API version and one or more deployment names separated by commas; each deployment shows up as a model in AI Chat).

If the page was open before you installed or reloaded the extension, the icon click injects the content script on demand. Browser pages such as `chrome://` are not supported.

## Basic workflow

1. **Inspector** (in the Editor or AI Chat tab): start it and click an element (optional; without a selection the AI works on the whole page).
2. **AI Chat**: describe the change, review the previewed operations (the eye icon highlights the target), apply the selected ones.
3. **Demo**: check the change list, reorder or hide sections, add notes, save a version.
4. **Export**: pick **Export** for a static site ZIP, or **Demo → Handoff** for the change package.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Type-check, build content script and service worker, build popup. Does **not** copy `manifest.json` or icons; use `./build.sh` for a loadable `dist/`. |
| `npm run dev` | Watch build of the popup bundle (reload the extension and the tab after changes). |
| `npm run type-check` | `tsc --noEmit`. |
| `npm test` | Vitest with jsdom. |

## Documentation

| File | Contents |
|------|----------|
| [PRD.md](PRD.md) | Product goals, users, requirements, scope |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, message flow, data model, build pipeline |
| [design.md](design.md) | UI layout, interaction design, visual conventions |
| [TASKS.md](TASKS.md) | Delivered work and open backlog |
| [CLAUDE.md](CLAUDE.md) | Working rules and gotchas for AI coding assistants |

## Known limitations

- Static export has no JavaScript by default: menus, sliders and forms do not run.
- Pages that re-render aggressively (React/Vue SPAs) may overwrite edits; Revamp re-applies saved changes with retries but cannot guarantee it.
- Iframes and Shadow DOM content are not indexed or exported.
- API keys are stored in `chrome.storage.local`, unencrypted.
- Images from another site: name a page in the chat ("use the pictures from https://example.com") and the AI chooses from the images listed in that page's HTML. Pages that build images with JavaScript give nothing, sites with hotlink protection may show a broken image, and the AI picks without seeing the pictures.
- Replacing page content from a document: sections the document does not cover are offered for hiding (never removed), but only for page-wide requests that carry an attached document. A page with more than 400 indexed elements is only partly visible to the AI; select a section and repeat for the rest.
- Uploaded images can replace an `<img>` or a CSS background image, with limits: no pseudo-element backgrounds (`::before`/`::after`), no icons under 100 × 50 px, one image is capped at about 1.5 MB, and pages whose Content Security Policy blocks `data:` images will not show them (use an image URL there). Details in [ARCHITECTURE.md](ARCHITECTURE.md#images-and-backgrounds).

## License

MIT
