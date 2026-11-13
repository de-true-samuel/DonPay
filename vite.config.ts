import { loadEnv } from 'vite';
import { defineConfig } from 'vite';
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
          manualChunks(id: string) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
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
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  } as any;
});
