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

echo "Build complete! Extension is ready in ./dist"
echo ""
echo "To load the extension:"
echo "1. Open Chrome and go to chrome://extensions/"
echo "2. Enable 'Developer mode'"
echo "3. Click 'Load unpacked'"
echo "4. Select the ./dist directory"
