import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Migrations run from a developer machine or CI against the DIRECT database URL — never from the Worker.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/kobo_exact',
  },
});
