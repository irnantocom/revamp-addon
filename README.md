# Revamp - AI Page Editor Chrome Extension

Production-ready Chrome Extension (Manifest V3) for visual page inspection, editing, and export.

## Tech Stack

- **TypeScript** - Type-safe development
- **React** - UI framework
- **Tailwind CSS** - Styling
- **Vite** - Build tool
- **JSZip** - Export functionality
- **Manifest V3** - Chrome Extension

## Features (Phase 1 MVP)

### ✅ Element Inspector
- Visual element highlighting on hover
- Click-to-select functionality
- Stable selector generation (data-* > ID > CSS path > XPath)

### ✅ Element Editor
- Edit text content
- Edit element attributes
- Undo functionality
- Real-time updates

### ✅ HTML Export
- Export full page HTML
- ZIP package generation
- Includes README documentation

## Project Structure

```
revamp-addon/
├── public/
│   ├── manifest.json          # Extension manifest (V3)
│   └── icons/                 # Extension icons (add your own)
├── src/
│   ├── background/
│   │   └── service-worker.ts  # Background service worker
│   ├── content/
│   │   └── content-script.ts  # Content script (inspector)
│   ├── popup/
│   │   ├── index.html         # Popup HTML
│   │   ├── index.tsx          # Popup entry point
│   │   ├── index.css          # Tailwind styles
│   │   ├── App.tsx            # Main popup component
│   │   └── components/        # React components
│   │       ├── Inspector.tsx
│   │       ├── ElementEditor.tsx
│   │       └── ExportPanel.tsx
│   └── utils/
│       ├── selector-generator.ts   # Selector generation logic
│       └── highlight-overlay.ts    # Visual overlay system
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
└── postcss.config.js
```

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Extension

```bash
npm run build
```

Or use the build script:

```bash
chmod +x build.sh
./build.sh
```

### 3. Load in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `dist` directory

## Development

### Watch Mode

```bash
npm run dev
```

This will rebuild the extension automatically when you make changes. You'll need to:
1. Reload the extension in `chrome://extensions/`
2. Refresh the page you're testing on

### Type Checking

```bash
npm run type-check
```

## Usage

### Inspector Mode

1. Click the extension icon to open the popup
2. Go to the **Inspector** tab
3. Click **Start Inspector**
4. Hover over elements on the page to highlight them
5. Click an element to select it

### Editing Elements

1. After selecting an element, go to the **Editor** tab
2. **Edit Text**: Modify the text content and click "Update Text"
3. **Edit Attributes**: Select an attribute from the dropdown, modify its value, and click "Update Attribute"
4. **Undo**: Click "Undo Last Edit" to revert the most recent change

### Exporting

1. Go to the **Export** tab
2. Click **Export HTML**
3. A ZIP file will download containing:
   - `index.html` - The current page HTML
   - `README.md` - Export documentation

## Architecture

### Manifest V3 Compliance

- ✅ No `eval()` or inline scripts
- ✅ CSP compliant
- ✅ Background service worker (not persistent background page)
- ✅ Message passing for communication
- ✅ Proper permissions declaration

### Selector Generation Priority

1. **data-* attributes** (highest priority, most stable)
2. **Unique IDs** (high priority, if not auto-generated)
3. **CSS path** (medium priority, structural)
4. **XPath** (fallback, most fragile)

### Message Flow

```
Popup (React) <-> Background Service Worker <-> Content Script
```

- Popup initiates commands
- Background worker routes messages
- Content script executes DOM operations

## Phase 2 Roadmap (Not Implemented)

- [ ] AI chatbox integration
- [ ] Multi-provider AI support (OpenAI, Claude, Gemini, etc.)
- [ ] Mapping engine for bulk edits
- [ ] CSS extraction and generation
- [ ] Live preview system
- [ ] Asset downloader (images, videos, fonts)
- [ ] URL rewriting for local assets

## Phase 3 Roadmap (Not Implemented)

- [ ] SPA resilience (MutationObserver)
- [ ] Route change handling
- [ ] Diff export (show changes only)
- [ ] CMS connectors (WordPress, etc.)
- [ ] Component extraction

## Known Limitations (Phase 1)

1. **CSS Not Extracted**: External stylesheets remain as `<link>` references
2. **Assets Not Downloaded**: Images, fonts use original URLs
3. **No Computed Styles**: Inline styles are captured, but not computed ones
4. **JavaScript May Break**: Exported pages may not function identically
5. **Single Element Selection**: Cannot select multiple elements at once

## Production Checklist

Before deploying:

- [ ] Add proper extension icons (16x16, 32x32, 48x48, 128x128)
- [ ] Update version in `manifest.json` and `package.json`
- [ ] Test on multiple websites (SPA, static, complex layouts)
- [ ] Test selector stability across page reloads
- [ ] Verify CSP compliance
- [ ] Add error boundary in React components
- [ ] Implement proper error logging
- [ ] Add user settings persistence

## Security

- All AI requests routed through background service worker
- No external scripts loaded
- Content Security Policy enforced
- No inline event handlers
- Shadow DOM isolation (optional, can be added)

## Contributing

When adding features:

1. Maintain Manifest V3 compliance
2. Use TypeScript with strict mode
3. Follow modular architecture
4. Add proper error handling
5. Update this README

## License

MIT

## Support

For issues or questions, please refer to the project documentation.

---

**Built with production quality and agency workflows in mind.**

use context7
