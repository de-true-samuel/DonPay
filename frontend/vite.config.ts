import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Vite only exposes .env files to app code, not to this config, so load them here. Shell variables still win.
// Kept as a plain object export (no function form) for Cloudflare's build.
const fileEnv = loadEnv(process.env.NODE_ENV === 'production' ? 'production' : 'development', process.cwd(), 'VITE_');
const DEV_PROXY = process.env.VITE_DEV_PROXY || fileEnv.VITE_DEV_PROXY;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Dev only: forward the backend's routes so the browser sees ONE origin (no CORS, the session cookie just works).
  // /p/:token itself stays a frontend page; only its JSON calls go to the backend.
  server: DEV_PROXY
    ? {
        proxy: {
          '/api': { target: DEV_PROXY, changeOrigin: false },
          '^/p/[^/]+/(status|claim-paid)$': { target: DEV_PROXY, changeOrigin: false },
        },
      }
    : undefined,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react-router-dom')
          ) {
            return 'react';
          }
          if (id.includes('node_modules/@tanstack/react-query')) {
            return 'query';
          }
          if (id.includes('node_modules/zod')) {
            return 'zod';
          }
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as any);
