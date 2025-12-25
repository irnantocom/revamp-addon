# Quick Start Guide

## Prerequisites

- Node.js 18+ and npm
- Google Chrome browser

## Installation (5 minutes)

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Build the Extension

```bash
npm run build
```

Or use the build script:
```bash
chmod +x build.sh
./build.sh
```

### Step 3: Add Icons (Optional for Testing)

Place PNG icons in `public/icons/`:
- icon-16.png
- icon-32.png
- icon-48.png
- icon-128.png

*You can skip this for development testing.*

### Step 4: Load in Chrome

1. Open Chrome → `chrome://extensions/`
2. Toggle **Developer mode** ON (top right)
3. Click **Load unpacked**
4. Select the `dist` folder

## First Use

### Test the Inspector

1. Navigate to any website (try https://example.com)
2. Click the **Revamp** extension icon
3. Click **Start Inspector**
4. Hover over elements (they'll highlight)
5. Click an element to select it

### Edit an Element

1. After selecting, go to **Editor** tab
2. Modify the text in the textarea
3. Click **Update Text**
4. Check the page - text should change!

### Export the Page

1. Go to **Export** tab
2. Click **Export HTML**
3. A ZIP file downloads with the page HTML

## Development Workflow

### Watch Mode

Terminal 1:
```bash
npm run dev
```

### After Making Changes

1. Chrome → `chrome://extensions/`
2. Click refresh icon on the Revamp extension
3. Reload the test page
4. Test your changes

## Troubleshooting

### "Content script not responding"

**Solution**: Reload the page after loading the extension

### "Export button does nothing"

**Solution**: Check the browser console (F12) for errors

### "Inspector doesn't start"

**Solution**: 
1. Check extension is loaded in `chrome://extensions/`
2. Ensure page has finished loading
3. Try refreshing the page

### Build fails

**Solution**:
```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

## File Structure at a Glance

```
dist/                      ← Built extension (load this)
├── manifest.json
├── background/
│   └── service-worker.js
├── content/
│   └── content-script.js
└── popup/
    ├── index.html
    ├── index.js
    └── index.css

src/                       ← Source code (edit this)
├── background/
├── content/
├── popup/
└── utils/
```

## Next Steps

✅ Extension working? Great!

Now you can:
1. Customize the UI in `src/popup/`
2. Enhance selector logic in `src/utils/selector-generator.ts`
3. Add features to `src/content/content-script.ts`
4. Prepare for Phase 2 (AI integration)

## Common Tasks

### Change Extension Name
Edit `public/manifest.json`:
```json
{
  "name": "Your Extension Name"
}
```

### Change Popup Size
Edit `src/popup/index.css`:
```css
#root {
  width: 500px;  /* Change this */
  min-height: 600px;
}
```

### Add New Permissions
Edit `public/manifest.json`:
```json
{
  "permissions": [
    "activeTab",
    "storage",
    "scripting",
    "your-new-permission"
  ]
}
```

## Production Deployment

Before publishing to Chrome Web Store:

1. ✅ Add proper icons
2. ✅ Update version in manifest.json
3. ✅ Test on multiple websites
4. ✅ Run production build: `npm run build`
5. ✅ Zip the `dist` folder
6. ✅ Upload to Chrome Web Store

---

**🎉 You're ready to go!**

For detailed documentation, see [README.md](README.md)
For development notes, see [DEVELOPMENT.md](DEVELOPMENT.md)

use context7
