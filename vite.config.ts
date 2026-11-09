import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Optional: forward /api to the backend in dev, so the browser sees ONE origin (no CORS, cookies just work).
  const proxy = env.VITE_DEV_PROXY
    ? { '/api': { target: env.VITE_DEV_PROXY, changeOrigin: false } }
    : undefined;
  return {
    plugins: [react()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: proxy ? { proxy } : undefined,
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            query: ['@tanstack/react-query'],
            zod: ['zod'],
          },
        },
      },
    },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  };
});
