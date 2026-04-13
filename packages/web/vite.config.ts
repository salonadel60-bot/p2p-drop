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
    port: 5000,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/signaling': {
        target: 'ws://127.0.0.1:3001',
        ws: true,
      },
    },
  },
});
