#!/bin/bash

# Build script for Chrome Extension
echo "Building Revamp Chrome Extension..."

# Clean dist directory
rm -rf dist

# Run build
npm run build

# Copy manifest and assets
cp public/manifest.json dist/
cp -r public/icons dist/ 2>/dev/null || echo "Note: Add icon files to public/icons/"
cp -r public/mic-permission dist/

# Move popup HTML to correct location
if [ -f dist/src/popup/index.html ]; then
  mv dist/src/popup/index.html dist/popup/index.html
  rm -rf dist/src
fi

echo "Build complete! Extension is ready in ./dist"
echo ""
echo "To load the extension:"
echo "1. Open Chrome and go to chrome://extensions/"
echo "2. Enable 'Developer mode'"
echo "3. Click 'Load unpacked'"
echo "4. Select the ./dist directory"
