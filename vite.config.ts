import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-popup-html',
      writeBundle() {
        // Copy and fix popup HTML paths
        const srcPath = resolve(__dirname, 'dist/src/popup/index.html');
        const destDir = resolve(__dirname, 'dist/popup');
        const destPath = resolve(destDir, 'index.html');
        
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }
        
        if (existsSync(srcPath)) {
          let html = readFileSync(srcPath, 'utf-8');
          
          // Fix paths from absolute to relative
          html = html.replace(/src="\/popup\//g, 'src="./');
          html = html.replace(/href="\/popup\//g, 'href="./');
          
          writeFileSync(destPath, html);
          console.log('✓ Copied and fixed popup HTML to dist/popup/index.html');
        }
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
      },
      output: {
        entryFileNames: '[name]/[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';
          if (name.endsWith('.css')) {
            return '[name]/[name][extname]';
          }
          return 'assets/[name][extname]';
        },
      },
    },
    minify: false,
    sourcemap: true,
  },
});
