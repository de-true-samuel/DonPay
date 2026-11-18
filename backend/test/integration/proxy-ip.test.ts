/**
 * The frontend Worker forwards /api and the pay page's calls here. It passes the visitor's IP in
 * x-paidar-client-ip, which must be trusted ONLY with the shared proxy secret (x-paidar-proxy).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/integrations/kora/signature';
import { createDepositJob, json, setupHarness } from '../helpers';

const h = setupHarness();
afterEach(() => {
  h.deps.config.proxySecret = null;
});

async function sentRequest() {
  const login = await json(await h.api('POST', '/api/auth/dev-login', { body: { businessName: 'Proxy IP Shop' } }));
  const job = await createDepositJob(h, login.sessionToken);
  const reqId = job.requests[0].id as string;
  const sent = await json(await h.api('POST', `/api/requests/${reqId}/send`, { token: login.sessionToken }));
  return { reqId, publicToken: sent.request.payLink.split('/p/')[1] as string };
}

async function claimIpHash(headers: Record<string, string>) {
  const { reqId, publicToken } = await sentRequest();
  const res = await h.app.request(`/p/${publicToken}/claim-paid`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'kobo-exact', 'cf-connecting-ip': '198.51.100.9', ...headers },
  });
  expect(res.status).toBe(202);
  const ev = await h.db.claimEvent.findFirstOrThrow({ where: { requestId: reqId } });
  return { hash: ev.ipHash, reqId };
}

describe('client IP behind the frontend Worker', () => {
  it('uses the forwarded IP when the proxy secret matches', async () => {
    h.deps.config.proxySecret = 'proxy-secret';
    const { hash, reqId } = await claimIpHash({ 'x-paidar-proxy': 'proxy-secret', 'x-paidar-client-ip': '203.0.113.7' });
    expect(hash).toBe((await sha256Hex(`${reqId}:203.0.113.7`)).slice(0, 32));
  });

  it('ignores a forwarded IP with a wrong secret (no spoofing)', async () => {
    h.deps.config.proxySecret = 'proxy-secret';
    const { hash, reqId } = await claimIpHash({ 'x-paidar-proxy': 'guess', 'x-paidar-client-ip': '203.0.113.7' });
    expect(hash).toBe((await sha256Hex(`${reqId}:198.51.100.9`)).slice(0, 32));
  });

  it('ignores the header entirely when no proxy secret is configured', async () => {
    const { hash, reqId } = await claimIpHash({ 'x-paidar-proxy': '', 'x-paidar-client-ip': '203.0.113.7' });
    expect(hash).toBe((await sha256Hex(`${reqId}:198.51.100.9`)).slice(0, 32));
  });
});
