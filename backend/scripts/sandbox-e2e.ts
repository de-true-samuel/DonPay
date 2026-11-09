/**
 * Kora sandbox end-to-end check (EXECUTION_PLAN.md M3), run against a deployed Worker with
 * KORA_MODE=sandbox and DEV_LOGIN_ENABLED=true (staging):
 *
 *   WORKER_URL=https://kobo-exact-staging.<you>.workers.dev npm run kora:sandbox-e2e
 *
 * Creates a job, sends the request (real Kora sandbox account), then polls until Kora's sandbox
 * completes the payment (~2 minutes) and the webhook → verify → PAID path has run.
 */
import 'dotenv/config';

const base = process.env.WORKER_URL?.replace(/\/+$/, '');
if (!base) {
  console.error('Set WORKER_URL');
  process.exit(1);
}
const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'kobo-exact' };

async function call<T = any>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json as T;
}

const login = await call('POST', '/api/auth/dev-login', undefined, { businessName: 'Sandbox E2E' });
const token: string = login.sessionToken;
const job = await call('POST', '/api/jobs', token, {
  customer: { name: 'Sandbox Customer', phone: '08000000001' },
  service: `Sandbox check ${new Date().toISOString()}`,
  totalKobo: '100000',
  plan: 'FULL',
});
const sent = await call('POST', `/api/requests/${job.requests[0].id}/send`, token);
console.log(`Kora sandbox account: ${sent.request.bankName} ${sent.request.accountNumber}, expires ${sent.request.expiresAt}`);
console.log('Waiting for the sandbox to complete the payment (about 2 minutes)…');

const started = Date.now();
while (Date.now() - started < 6 * 60_000) {
  await new Promise((r) => setTimeout(r, 10_000));
  const detail = await call('GET', `/api/jobs/${job.id}`, token);
  const status = detail.requests[0].status;
  process.stdout.write(`  ${Math.round((Date.now() - started) / 1000)}s: ${status}\n`);
  if (status === 'PAID') {
    console.log(`PASS: paid ${detail.paidKobo} kobo, verified ${detail.verifiedPaidKobo}, payer ${detail.payments[0]?.payerName ?? 'unknown'}`);
    process.exit(0);
  }
}
console.error('FAIL: request not PAID after 6 minutes. Check Workers logs for kora.webhook_* and payment.* events.');
process.exit(1);
