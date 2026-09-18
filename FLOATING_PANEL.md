# 🎯 Floating Panel Implementation

## Architecture Overview

Implementasi menggunakan **Injected Floating Panel (Content Script UI)** - best practice untuk Chrome Extension yang membutuhkan UI persistent saat berinteraksi dengan halaman.

## 🏗️ How It Works

### 1. User Clicks Extension Icon
```
User → Clicks Revamp Icon
  ↓
Background Worker → Receives chrome.action.onClicked
  ↓
Sends TOGGLE_PANEL message → Content Script
```

### 2. Content Script Injects Panel
```javascript
Content Script:
  ↓
Creates <div id="revamp-floating-panel">
  ↓
Creates <iframe src="popup/index.html">
  ↓
Injects into page DOM
```

### 3. Panel Stays Open
```
✅ Panel tetap terbuka saat:
  - User klik element di halaman
  - Scroll page
  - Navigate (SPA routing)
  - Inspector mode active

❌ Panel hanya tertutup saat:
  - User klik tombol close (✕)
  - User klik icon extension lagi (toggle)
  - Page reload/navigation
```

## 📁 File Changes

### 1. manifest.json
```json
{
  "action": {
    // ❌ Removed: "default_popup": "popup/index.html"
    // Sekarang hanya icon, no default popup
  },
  "web_accessible_resources": [
    {
      // ✅ Added: popup/* untuk iframe access
      "resources": ["content/*", "popup/*"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

### 2. background/service-worker.ts
```typescript
// ✅ Added: Toggle panel handler
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
});
```

### 3. content/content-script.ts
```typescript
class RevampInspector {
  private panelOpen = false;
  private panelElement: HTMLIFrameElement | null = null;

  // ✅ Added: Panel creation
  private createFloatingPanel(): void { ... }
  
  // ✅ Added: Drag functionality
  private makeDraggable(): void { ... }
  
  // ✅ Added: Toggle logic
  togglePanel(): void { ... }
}
```

## 🎨 Panel Features

### ✅ Draggable
- Drag handle di bagian atas panel
- User bisa reposition ke mana saja
- Cursor: `move` on drag handle

### ✅ Resizable (corner drag)
- Resize handle di pojok kanan-bawah panel
- Drag untuk mengubah width & height (min 320x300)
- Ukuran tersimpan di localStorage, dipakai lagi saat panel dibuka

### Default Position & Size
```javascript
Top: 80px (default)
Right: 20px (default)
Width: 420px (default, resizable)
Height: 600px (default, resizable)
Z-index: 2147483647 (maximum)
```

### ✅ Close Button
- Button ✕ di kanan atas
- Hover effect: red background
- Click → panel hilang

### ✅ Event Isolation
```javascript
// Panel clicks tidak trigger inspector
container.addEventListener('mousedown', (e) => e.stopPropagation(), true);
container.addEventListener('click', (e) => e.stopPropagation(), true);
```

## 🚀 User Flow

### Scenario 1: First Time Use
```
1. User install extension
2. User buka website (contoh: example.com)
3. User klik icon Revamp di toolbar
4. ✨ Floating panel muncul di kanan atas
5. Panel berisi full React app (tabs: Inspector, Editor, AI Chat, etc)
6. User bisa drag panel ke posisi lain
7. User klik "Start Inspector"
8. User hover & click element di halaman
9. ✅ Panel TETAP TERBUKA
10. Element info muncul di panel
11. User bisa switch ke tab Editor/AI Chat
12. User edit element via panel
13. Changes applied real-time
```

### Scenario 2: Panel Persistence
```
Panel open → User klik element → Panel tetap open ✅
Panel open → User scroll → Panel tetap open ✅
Panel open → User switch tab → Panel tetap open ✅
Panel open → User klik inspector element → Panel tetap open ✅
```

### Scenario 3: Closing Panel
```
Option 1: Klik button ✕ → Panel close
Option 2: Klik icon extension lagi → Panel toggle off
Option 3: Refresh page → Panel hilang (new page load)
```

## 🔧 Technical Details

### IFrame Communication
```javascript
// Popup HTML di-load dalam iframe
<iframe src="chrome-extension://[id]/popup/index.html">

// React app berjalan normal di dalam iframe
// Message passing tetap work via chrome.runtime.sendMessage
```

### Z-Index Strategy
```css
Panel: z-index: 2147483647 (maximum)
Inspector overlay: z-index: 2147483646
Page content: z-index: < 2147483646
```

### Click Event Priority
```javascript
1. Panel click → stopPropagation() → tidak trigger inspector
2. Page click → handleClick() → inspector mode
3. Inspector active → prevent default → select element
```

## 🐛 Debugging

### Check Panel Injection
```javascript
// Open DevTools Console
document.getElementById('revamp-floating-panel')
// Should return: <div id="revamp-floating-panel">...</div>
```

### Check IFrame Load
```javascript
// Check iframe src
const iframe = document.querySelector('#revamp-floating-panel iframe');
console.log(iframe.src);
// Should: chrome-extension://[id]/popup/index.html
```

### Check React App
```javascript
// Right click iframe → Inspect (opens iframe DevTools)
// Check React components loaded
```

## ⚡ Performance

### Bundle Size
```
content-script.js: 23.35 KB (was 19.35 KB)
  + 4 KB for floating panel logic

popup.js: 407.32 KB (unchanged)
  React app bundle
```

### Memory Usage
```
Panel closed: ~5 MB
Panel open: ~15 MB (React app + iframe)
```

## 🎯 Advantages vs Standard Popup

| Feature | Standard Popup | Floating Panel |
|---------|---------------|----------------|
| Stay open on click | ❌ | ✅ |
| Draggable | ❌ | ✅ |
| Custom position | ❌ | ✅ |
| Inspector mode | ❌ | ✅ |
| Multi-tab switch | ❌ | ✅ |
| Real-time editing | ❌ | ✅ |

## 🔮 Future Enhancements

- [ ] Minimize/maximize button
- [ ] Snap to edges
- [ ] Keyboard shortcuts (Ctrl+Shift+E)
- [ ] Multiple panel instances
- [ ] Dark mode

## 📚 References

- Chrome Extension Best Practices: Injected UI
- React DevTools Architecture
- Vue DevTools Architecture
- Elementor Editor Pattern
