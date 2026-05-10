import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: path.resolve(__dirname, 'postcss.config.cjs')
  },
  root: path.resolve(__dirname, 'src/renderer'),
  build: {
    outDir: path.resolve(__dirname, '.vite/renderer/main_window'),
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@components': path.resolve(__dirname, 'src/renderer/components'),
      '@styles': path.resolve(__dirname, 'src/renderer/styles')
    }
  },
  server: {
    port: 3000,
    /** Listen on all local interfaces so both http://localhost:3000 and http://127.0.0.1:3000 resolve (avoids blank page when localhost maps to ::1 only). */
    host: true,
    strictPort: true
  }
});
