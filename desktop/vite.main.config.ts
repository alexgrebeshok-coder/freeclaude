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
      external: [
        'electron',
        'node-pty',
        // Native + filesystem-heavy modules must remain external so they load
        // from the on-disk node_modules tree at runtime. Pure-JS deps such as
        // electron-updater can be bundled by Vite.
        'fs',
        'fs/promises',
        'path',
        'os',
        'child_process',
        'crypto',
        'util',
        'events',
        'stream',
        'http',
        'https',
        'url',
        'tls',
        'net',
        'zlib',
        'assert',
        'buffer'
      ]
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
