import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main/bootstrap.ts'),
      formats: ['cjs'],
      fileName: () => 'bootstrap.js'
    },
    rollupOptions: {
      external: ['electron', 'node-pty', 'fs', 'path', 'os', 'child_process', 'crypto', 'util', 'events', 'stream']
    },
    outDir: '.vite/build',
    emptyOutDir: false
  },
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main'),
      '@preload': path.resolve(__dirname, 'src/preload')
    }
  }
});
