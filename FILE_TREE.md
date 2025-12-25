# Project File Tree

```
revamp-addon/
│
├── 📁 .github/
│   └── copilot-instructions.md         # AI assistant project guidelines
│
├── 📁 .vscode/
│   └── mcp.json                        # VS Code MCP configuration
│
├── 📁 public/                          # Static assets for extension
│   ├── manifest.json                   # Chrome Extension Manifest V3
│   └── 📁 icons/
│       └── README.md                   # Icon requirements guide
│
├── 📁 src/                             # Source code
│   ├── 📁 background/
│   │   └── service-worker.ts           # Background service worker (message routing, AI hub)
│   │
│   ├── 📁 content/
│   │   └── content-script.ts           # Content script (inspector, DOM manipulation)
│   │
│   ├── 📁 popup/                       # Popup UI (React + Tailwind)
│   │   ├── index.html                  # Popup HTML entry point
│   │   ├── index.tsx                   # React app entry
│   │   ├── index.css                   # Tailwind CSS imports
│   │   ├── App.tsx                     # Main app component (tab navigation)
│   │   └── 📁 components/
│   │       ├── Inspector.tsx           # Inspector controls UI
│   │       ├── ElementEditor.tsx       # Element editing UI
│   │       └── ExportPanel.tsx         # Export controls UI
│   │
│   └── 📁 utils/                       # Shared utilities
│       ├── selector-generator.ts       # Selector generation logic
│       └── highlight-overlay.ts        # Visual overlay system
│
├── 📁 dist/                            # Build output (generated, not in repo)
│   ├── manifest.json
│   ├── 📁 background/
│   │   └── service-worker.js
│   ├── 📁 content/
│   │   └── content-script.js
│   └── 📁 popup/
│       ├── index.html
│       ├── index.js
│       └── index.css
│
├── 📄 Configuration Files
│   ├── package.json                    # Dependencies and scripts
│   ├── tsconfig.json                   # TypeScript configuration
│   ├── tsconfig.node.json              # TypeScript config for build tools
│   ├── vite.config.ts                  # Vite build configuration
│   ├── tailwind.config.js              # Tailwind CSS configuration
│   ├── postcss.config.js               # PostCSS configuration
│   └── .gitignore                      # Git ignore rules
│
├── 📄 Scripts
│   └── build.sh                        # Build script for extension
│
├── 📄 Documentation
│   ├── README.md                       # Main documentation
│   ├── QUICKSTART.md                   # Quick start guide
│   ├── DEVELOPMENT.md                  # Development notes
│   └── IMPLEMENTATION_SUMMARY.md       # Implementation summary
│
└── 📄 Data Files
    ├── context.json                    # Project context
    └── mcp.json                        # MCP configuration

```

## File Descriptions

### 🔧 Core Extension Files

| File | Purpose | Lines | Critical |
|------|---------|-------|----------|
| `public/manifest.json` | Extension configuration, permissions, entry points | 50 | ✅ |
| `src/background/service-worker.ts` | Background worker, message routing, AI hub | 150 | ✅ |
| `src/content/content-script.ts` | Inspector, DOM manipulation, edit history | 250 | ✅ |

### 🎨 UI Components

| File | Purpose | Lines | Critical |
|------|---------|-------|----------|
| `src/popup/App.tsx` | Main popup component, tab navigation | 80 | ✅ |
| `src/popup/components/Inspector.tsx` | Inspector start/stop controls | 70 | ✅ |
| `src/popup/components/ElementEditor.tsx` | Text and attribute editing UI | 180 | ✅ |
| `src/popup/components/ExportPanel.tsx` | HTML export functionality | 120 | ✅ |

### 🛠️ Utilities

| File | Purpose | Lines | Critical |
|------|---------|-------|----------|
| `src/utils/selector-generator.ts` | Priority-based selector generation | 180 | ✅ |
| `src/utils/highlight-overlay.ts` | Visual element highlighting | 130 | ✅ |

### ⚙️ Configuration

| File | Purpose | Critical |
|------|---------|----------|
| `tsconfig.json` | TypeScript compiler options | ✅ |
| `vite.config.ts` | Build configuration, entry points | ✅ |
| `tailwind.config.js` | Tailwind CSS customization | ⚠️ |
| `postcss.config.js` | PostCSS plugins | ⚠️ |
| `package.json` | Dependencies, scripts | ✅ |

### 📚 Documentation

| File | Purpose |
|------|---------|
| `README.md` | Complete project documentation |
| `QUICKSTART.md` | 5-minute setup guide |
| `DEVELOPMENT.md` | Architecture decisions, issues, plans |
| `IMPLEMENTATION_SUMMARY.md` | Phase 1 completion summary |

## Build Process

```
Source Files (src/)
    ↓
Vite Build (vite.config.ts)
    ↓
TypeScript Compilation (tsconfig.json)
    ↓
Tailwind Processing (tailwind.config.js)
    ↓
Bundle Generation
    ↓
Output (dist/)
```

## Critical Dependencies

```json
{
  "dependencies": {
    "react": "^18.2.0",           // UI framework
    "react-dom": "^18.2.0",       // React DOM renderer
    "jszip": "^3.10.1"            // ZIP generation for export
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",  // Chrome API types
    "@vitejs/plugin-react": "^4.2.1",
    "typescript": "^5.3.3",
    "tailwindcss": "^3.4.1",
    "vite": "^5.0.11"
  }
}
```

## File Size Estimates

### Source Code
- TypeScript files: ~1,500 lines
- React components: ~450 lines
- Utilities: ~310 lines
- Configuration: ~150 lines

### Build Output
- service-worker.js: ~10 KB
- content-script.js: ~15 KB
- popup/index.js: ~150 KB (includes React)
- popup/index.css: ~5 KB
- Total: ~180 KB

## Entry Points

1. **Extension Load** → `public/manifest.json`
2. **Background Process** → `src/background/service-worker.ts`
3. **Page Injection** → `src/content/content-script.ts`
4. **Popup UI** → `src/popup/index.html` → `src/popup/index.tsx`

## Import Graph

```
content-script.ts
    ├── selector-generator.ts
    └── highlight-overlay.ts

App.tsx
    ├── Inspector.tsx
    ├── ElementEditor.tsx
    └── ExportPanel.tsx
        └── jszip (npm)

service-worker.ts
    └── (no dependencies)
```

## Phase 2 Additions (Planned)

```
src/
├── ai/
│   ├── providers/
│   │   ├── openai.ts
│   │   ├── claude.ts
│   │   ├── gemini.ts
│   │   └── index.ts
│   ├── adapter.ts
│   └── types.ts
│
├── export/
│   ├── css-extractor.ts
│   ├── asset-downloader.ts
│   └── url-rewriter.ts
│
└── popup/components/
    └── AIChat.tsx
```

## Maintenance Notes

- Update `manifest.json` version before each release
- Keep `package.json` versions in sync with `manifest.json`
- Run `npm run type-check` before commits
- Update documentation when adding features
- Keep build output under 200 KB

---

**Last Updated**: Phase 1 MVP Complete  
**Total Files**: 23 source files + config  
**Lines of Code**: ~1,500  
**Build Size**: ~180 KB

use context7
