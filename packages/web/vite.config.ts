import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@p2p-drop/core': resolve(__dirname, '../core/src'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
});
