import path from 'node:path';
import { defineConfig } from 'vite';

const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:4180';

export default defineConfig({
  root: 'web',
  base: process.env.VITE_BASE || '/',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/samples': { target: apiTarget, changeOrigin: true },
      '/assets/vehicles': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: path.resolve('dist'),
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});
