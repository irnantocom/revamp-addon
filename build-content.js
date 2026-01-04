import { build } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Build content script separately with inlineDynamicImports
async function buildContent() {
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/content/content-script.ts'),
        formats: ['iife'],
        name: 'ContentScript',
        fileName: () => 'content/content-script.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
      minify: false,
      sourcemap: true,
    },
  });
}

// Build background script separately with inlineDynamicImports
async function buildBackground() {
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/background/service-worker.ts'),
        formats: ['iife'],
        name: 'BackgroundScript',
        fileName: () => 'background/service-worker.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
      minify: false,
      sourcemap: true,
    },
  });
}

buildContent().then(() => {
  console.log('✓ Content script built');
  return buildBackground();
}).then(() => {
  console.log('✓ Background script built');
}).catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
