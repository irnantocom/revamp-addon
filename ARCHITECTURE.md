# Architecture Diagrams

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CHROME EXTENSION                         │
│                   (Manifest V3)                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   POPUP UI (React)                          │
│  ┌────────────┬────────────┬────────────┐                  │
│  │ Inspector  │   Editor   │   Export   │                  │
│  │   Tab      │    Tab     │    Tab     │                  │
│  └────────────┴────────────┴────────────┘                  │
│  - Start/Stop Inspector                                     │
│  - Edit text/attributes                                     │
│  - Export HTML as ZIP                                       │
└─────────────────────────────────────────────────────────────┘
                       ↕ (chrome.runtime.sendMessage)
┌─────────────────────────────────────────────────────────────┐
│            BACKGROUND SERVICE WORKER                        │
│  - Message routing                                          │
│  - Settings management                                      │
│  - AI request hub (Phase 2)                                 │
└─────────────────────────────────────────────────────────────┘
                       ↕ (chrome.tabs.sendMessage)
┌─────────────────────────────────────────────────────────────┐
│                  CONTENT SCRIPT                             │
│  ┌─────────────────────────────────────────────────┐       │
│  │ Inspector Engine                                 │       │
│  │ - Element highlighting                          │       │
│  │ - Click interception                            │       │
│  │ - Selector generation                           │       │
│  └─────────────────────────────────────────────────┘       │
│  ┌─────────────────────────────────────────────────┐       │
│  │ DOM Manipulator                                 │       │
│  │ - Text editing                                  │       │
│  │ - Attribute editing                             │       │
│  │ - Edit history (undo)                           │       │
│  └─────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
                       ↕ (Direct DOM access)
┌─────────────────────────────────────────────────────────────┐
│                  TARGET WEBPAGE                             │
│  - HTML elements                                            │
│  - CSS styles                                               │
│  - JavaScript state                                         │
└─────────────────────────────────────────────────────────────┘
```

## Component Hierarchy

```
App (Root)
├── Header (Branding)
├── TabNavigation
│   ├── Inspector Tab
│   ├── Editor Tab
│   └── Export Tab
├── TabContent
│   ├── <Inspector />
│   │   ├── InspectorControls
│   │   ├── StatusDisplay
│   │   └── Instructions
│   ├── <ElementEditor />
│   │   ├── ElementInfo
│   │   ├── TextEditor
│   │   ├── AttributeEditor
│   │   └── ActionButtons
│   └── <ExportPanel />
│       ├── ExportButton
│       ├── StatusMessage
│       └── LimitationsInfo
└── Footer
```

## Data Flow - Inspector Mode

```
1. User Action
   └→ Click "Start Inspector" in Popup

2. Message to Background
   └→ chrome.runtime.sendMessage({ type: 'START_INSPECTOR' })

3. Background Routes to Content
   └→ chrome.tabs.sendMessage(tabId, { type: 'START_INSPECTOR' })

4. Content Script Activates
   ├→ Add event listeners (mouseover, mouseout, click)
   ├→ Set cursor to crosshair
   └→ Create highlight overlay

5. User Hovers Element
   └→ mouseover event
       ├→ Get element under cursor
       ├→ Generate selector
       └→ Show highlight + label

6. User Clicks Element
   └→ click event (captured)
       ├→ Prevent default
       ├→ Store selected element
       ├→ Generate selector info
       ├→ Stop inspector mode
       └→ Send selection to popup
           └→ chrome.runtime.sendMessage({
                 type: 'ELEMENT_SELECTED',
                 payload: { selector, tagName, attributes, ... }
              })

7. Popup Receives Selection
   ├→ Update state with element info
   └→ Switch to Editor tab
```

## Data Flow - Text Editing

```
1. User Action
   └→ Edit text in textarea, click "Update Text"

2. Popup Sends Edit Command
   └→ chrome.tabs.sendMessage(tabId, {
        type: 'EDIT_TEXT',
        payload: { selector, value }
      })

3. Content Script Receives
   ├→ Resolve element from selector
   ├→ Save original value to history
   ├→ Update element.textContent
   └→ Send success response

4. Page Updates
   └→ Text content changes immediately
```

## Data Flow - Export

```
1. User Action
   └→ Click "Export HTML" in Popup

2. Popup Requests HTML
   └→ chrome.tabs.sendMessage(tabId, {
        type: 'GET_PAGE_HTML'
      })

3. Content Script Extracts
   └→ Return document.documentElement.outerHTML

4. Popup Processes
   ├→ Create new JSZip()
   ├→ Add index.html
   ├→ Add README.md
   └→ Generate blob

5. Download Triggered
   └→ Create download link
       └→ User receives ZIP file
```

## Selector Generation Algorithm

```
generateSelector(element)
│
├─→ [Priority 1] Check data-* attributes
│   ├─→ data-testid="..."  ✓ Use this (HIGH confidence)
│   ├─→ data-id="..."      ✓ Use this (HIGH confidence)
│   ├─→ data-cy="..."      ✓ Use this (HIGH confidence)
│   └─→ Any other data-*   → Check uniqueness
│
├─→ [Priority 2] Check for unique ID
│   ├─→ Has valid ID?
│   ├─→ Not auto-generated? (no react123, ember456)
│   └─→ Unique in document? → Use #id (HIGH confidence)
│
├─→ [Priority 3] Generate CSS path
│   ├─→ Build path from element to root
│   ├─→ Add :nth-child() for siblings
│   └─→ Check uniqueness → Use path (MEDIUM confidence)
│
└─→ [Priority 4] Generate XPath (fallback)
    └─→ Always works but fragile (LOW confidence)
```

## Undo System

```
Edit History Stack (max 50 operations)
│
├─→ [Operation 1] { selector, type: 'text', originalValue, newValue }
├─→ [Operation 2] { selector, type: 'attribute', attribute, originalValue, newValue }
├─→ [Operation 3] { selector, type: 'text', originalValue, newValue }
└─→ ...

Undo:
├─→ Pop last operation
├─→ Resolve element
└─→ Restore originalValue
```

## Message Types

```
Popup → Background → Content
├─→ START_INSPECTOR
├─→ STOP_INSPECTOR
├─→ GET_SELECTED_ELEMENT
├─→ EDIT_TEXT
├─→ EDIT_ATTRIBUTE
├─→ UNDO_EDIT
└─→ GET_PAGE_HTML

Content → Background → Popup
├─→ ELEMENT_SELECTED
└─→ (Response messages)

Popup ↔ Background
├─→ GET_SETTINGS
└─→ UPDATE_SETTINGS
```

## Build Process Flow

```
Source Files (src/)
│
├─→ TypeScript Compilation
│   └─→ tsconfig.json (strict mode)
│
├─→ React JSX Transform
│   └─→ @vitejs/plugin-react
│
├─→ Tailwind CSS Processing
│   ├─→ postcss.config.js
│   └─→ tailwind.config.js
│
├─→ Vite Bundling
│   └─→ vite.config.ts
│       ├─→ background/service-worker.js
│       ├─→ content/content-script.js
│       └─→ popup/index.js + index.css
│
└─→ Output (dist/)
    ├─→ manifest.json (copied)
    └─→ Bundled files
```

## Security Boundaries

```
┌─────────────────────────────────────────┐
│         ISOLATED CONTEXTS               │
└─────────────────────────────────────────┘

Extension Context (Privileged)
├─→ Background Service Worker
│   └─→ Access to Chrome APIs
└─→ Popup
    └─→ Access to Chrome APIs

Web Page Context (Restricted)
└─→ Content Script
    ├─→ Limited Chrome APIs
    ├─→ Full DOM access
    └─→ Must message background for privileged operations

Communication: Message Passing Only
(No shared state, no eval, no inline scripts)
```

## Phase 2 Architecture (Planned)

```
┌─────────────────────────────────────────┐
│         NEW COMPONENTS                  │
└─────────────────────────────────────────┘

AI Provider Layer
├─→ OpenAI Adapter
├─→ Claude Adapter
├─→ Gemini Adapter
└─→ [Other providers]

Export Engine
├─→ CSS Extractor
├─→ Asset Downloader
└─→ URL Rewriter

Popup UI
├─→ AI Chat Component
└─→ Mapping Engine UI

Content Script
└─→ MutationObserver (SPA resilience)
```

## Technology Stack

```
Runtime
├─→ Chrome Extension (Manifest V3)
└─→ Service Worker API

Frontend
├─→ React 18
├─→ TypeScript 5.3
└─→ Tailwind CSS 3.4

Build
├─→ Vite 5
├─→ PostCSS
└─→ Autoprefixer

Libraries
└─→ JSZip 3.10

Types
├─→ @types/chrome
├─→ @types/react
└─→ @types/node
```

---

## Key Design Principles

1. **Modularity** - Each component has single responsibility
2. **Type Safety** - TypeScript strict mode throughout
3. **Security** - No eval, no inline scripts, proper CSP
4. **Stability** - Priority-based selector generation
5. **Extensibility** - Architecture ready for Phase 2
6. **User Feedback** - Visual highlights, status messages
7. **Error Handling** - Try-catch blocks, error messages
8. **Documentation** - Comprehensive inline and external docs

use context7
