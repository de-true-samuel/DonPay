import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The Worker's Prisma client imports a .wasm module only Wrangler can bundle. Tests run in Node,
    // so they use the Node-runtime client generated from the same schema.
    alias: [{ find: /^(.*)\/generated\/prisma\/(client|enums)$/, replacement: '$1/generated/prisma-node/$2' }],
  },
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one database; run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
