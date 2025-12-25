# Installation & Build Instructions

## Prerequisites

Ensure you have:
- **Node.js 18+** (`node --version`)
- **npm** (`npm --version`)
- **Google Chrome** (latest version)

## Step-by-Step Installation

### 1. Install Dependencies

```bash
cd /media/project/project/revamp-addon
npm install
```

This will install:
- React & React DOM
- TypeScript
- Vite
- Tailwind CSS
- JSZip
- Chrome types
- All dev dependencies

**Expected install time**: 30-60 seconds

### 2. Verify Installation

```bash
npm run type-check
```

If dependencies are installed correctly, you should see TypeScript compilation complete (may show some warnings, but no blocking errors).

### 3. Build the Extension

```bash
npm run build
```

Or use the build script:
```bash
./build.sh
```

**Expected output**:
```
Building Revamp Chrome Extension...
✓ built in 3.45s
Build complete! Extension is ready in ./dist
```

### 4. Verify Build Output

```bash
ls -la dist/
```

You should see:
```
dist/
├── manifest.json
├── background/
│   └── service-worker.js
├── content/
│   └── content-script.js
└── popup/
    ├── index.html
    ├── index.js
    └── index.css
```

### 5. Load Extension in Chrome

1. Open Chrome
2. Navigate to `chrome://extensions/`
3. Toggle **Developer mode** ON (top right corner)
4. Click **Load unpacked**
5. Navigate to and select the `dist` folder
6. Extension should appear with Revamp icon

### 6. Test the Extension

1. Navigate to any website (e.g., https://example.com)
2. Click the Revamp extension icon
3. Click **Start Inspector**
4. Hover over elements (should highlight)
5. Click an element (should select)
6. Go to **Editor** tab (should show element info)
7. Go to **Export** tab
8. Click **Export HTML** (should download ZIP)

## Development Workflow

### Watch Mode (Auto-rebuild on changes)

```bash
npm run dev
```

Keep this running in a terminal. When you edit source files:
1. Save the file
2. Go to `chrome://extensions/`
3. Click the refresh icon on Revamp extension
4. Reload the test page
5. Test your changes

### Type Checking

```bash
npm run type-check
```

Run this before committing code to catch TypeScript errors.

## Troubleshooting

### Error: "Cannot find module 'react'"

**Solution**: Dependencies not installed
```bash
rm -rf node_modules package-lock.json
npm install
```

### Error: "chrome is not defined"

**Solution**: This is expected before build. Run:
```bash
npm run build
```

TypeScript errors will resolve during build with proper Chrome types.

### Error: "Permission denied: build.sh"

**Solution**: Make script executable
```bash
chmod +x build.sh
```

### Error: "Vite build failed"

**Solution**: Clean and rebuild
```bash
rm -rf dist node_modules
npm install
npm run build
```

### Extension not showing in Chrome

**Solution**: Check Developer mode is ON and dist folder contains manifest.json

### "Content script not responding"

**Solution**: After loading extension, refresh the test page

## Adding Extension Icons

Before production, add PNG icons to `public/icons/`:

```bash
# Required sizes
public/icons/icon-16.png   # 16x16 pixels
public/icons/icon-32.png   # 32x32 pixels
public/icons/icon-48.png   # 48x48 pixels
public/icons/icon-128.png  # 128x128 pixels
```

Then rebuild:
```bash
npm run build
```

## Environment Setup Checklist

- [ ] Node.js 18+ installed
- [ ] npm available
- [ ] Chrome installed
- [ ] Dependencies installed (`npm install`)
- [ ] Build successful (`npm run build`)
- [ ] dist/ folder created
- [ ] Extension loaded in Chrome
- [ ] Inspector working
- [ ] Editor working
- [ ] Export working

## Next Steps

Once installation is complete:

1. ✅ Test all features thoroughly
2. ✅ Review [README.md](README.md) for full documentation
3. ✅ Check [DEVELOPMENT.md](DEVELOPMENT.md) for architecture
4. ✅ See [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) for Phase 1 status
5. ⏭️ Begin Phase 2 development when ready

## Build Scripts Reference

```bash
npm run dev          # Watch mode (auto-rebuild)
npm run build        # Production build
npm run preview      # Preview build
npm run type-check   # TypeScript type checking
```

## File Permissions

Ensure scripts are executable:
```bash
chmod +x build.sh
```

## Clean Install

If you encounter persistent issues:

```bash
# Remove all generated files
rm -rf node_modules package-lock.json dist

# Reinstall from scratch
npm install

# Rebuild
npm run build
```

---

**Installation Time**: ~2 minutes  
**First Build Time**: ~5 seconds  
**Rebuild Time**: ~2 seconds

use context7
