import { execSync } from 'node:child_process';
import 'dotenv/config';

/** Apply migrations to the test database once per run. Unit-only runs skip this. */
export default function setup() {
  if (process.argv.some((a) => a.includes('test/unit'))) return;
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://kobo:kobo@localhost:54329/kobo_exact_test';
  process.env.TEST_DATABASE_URL = url;
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
