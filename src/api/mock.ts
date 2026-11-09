/**
 * In-browser stand-in for the backend, following contract v1.0.0.
 * Phase 1 covers auth + /api/me. Later phases add the rest.
 * Demo sign-in tokens: anything starting with "demo" works; other tokens fail like an expired link.
 */
import { z } from 'zod';
import type { Provider } from '../contract/contract';
import { emptyDomain, fail, handleDomain, json } from './mockDomain';
import type { DomainDb } from './mockDomain';

const KEY = 'paidar.mock.v2';
interface Db { provider: Provider | null; signedIn: boolean; tgRequestedAt: number | null; domain: DomainDb }

function load(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const db = JSON.parse(raw) as Db;
      return { ...db, domain: db.domain ?? emptyDomain() };
    }
  } catch { /* fall through */ }
  return { provider: null, signedIn: false, tgRequestedAt: null, domain: emptyDomain() };
}
function save(db: Db): void {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage unavailable */ }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeProvider(name: string, linked: boolean): Provider {
  return {
    id: 'mock_provider', businessName: name, telegramLinked: linked,
    defaultReadyRule: 'AFTER_DEPOSIT', digestTime: null, createdAt: new Date().toISOString(),
  };
}

const PatchMe = z.object({
  businessName: z.string().trim().min(1, 'Enter your business name').max(80, 'Keep it under 80 characters').optional(),
  defaultReadyRule: z.enum(['AFTER_DEPOSIT', 'AFTER_FULL']).optional(),
  digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 19:30').nullable().optional(),
});

export async function mockFetch(url: string, init: RequestInit): Promise<Response> {
  await sleep(150 + Math.random() * 250);
  const { pathname: path } = new URL(url, window.location.origin);
  const method = (init.method ?? 'GET').toUpperCase();
  let body: unknown;
  try { body = init.body ? JSON.parse(String(init.body)) : undefined; } catch { body = undefined; }

  if (method !== 'GET' && new Headers(init.headers).get('X-Requested-With') !== 'kobo-exact') {
    return fail(403, 'CSRF_HEADER_MISSING', 'Missing X-Requested-With header.');
  }

  const db = load();
  const needSession = () => (db.signedIn && db.provider ? null : fail(401, 'UNAUTHENTICATED', 'Sign in required.'));

  if (method === 'POST' && path === '/api/auth/exchange') {
    const token = String((body as { token?: string } | undefined)?.token ?? '');
    if (!token.startsWith('demo')) return fail(401, 'UNAUTHENTICATED', 'This link is invalid, expired or already used.');
    db.provider = db.provider ?? makeProvider('Tolu’s Glam Studio', true);
    db.provider.telegramLinked = true;
    db.signedIn = true;
    save(db);
    return json(200, { sessionToken: 'mock-session', provider: db.provider });
  }

  if (method === 'POST' && path === '/api/auth/dev-login') {
    const name = String((body as { businessName?: string } | undefined)?.businessName ?? '').trim();
    if (!name) return fail(400, 'VALIDATION_ERROR', 'Invalid body.', { fieldErrors: { businessName: ['Enter a business name'] }, formErrors: [] });
    if (db.provider?.businessName !== name) db.domain = emptyDomain();
    db.provider = makeProvider(name, false);
    db.signedIn = true;
    db.tgRequestedAt = null;
    save(db);
    return json(200, { sessionToken: 'mock-session', provider: db.provider });
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    db.signedIn = false;
    save(db);
    return new Response(null, { status: 204 });
  }

  if (method === 'GET' && path === '/api/me') {
    const denied = needSession();
    if (denied) return denied;
    if (db.provider && !db.provider.telegramLinked && db.tgRequestedAt && Date.now() - db.tgRequestedAt > 5000) {
      db.provider.telegramLinked = true; // pretend the provider tapped Start in the bot
      save(db);
    }
    return json(200, db.provider);
  }

  if (method === 'PATCH' && path === '/api/me') {
    const denied = needSession();
    if (denied) return denied;
    const parsed = PatchMe.safeParse(body);
    if (!parsed.success) return fail(400, 'VALIDATION_ERROR', 'Invalid body.', parsed.error.flatten());
    db.provider = { ...db.provider!, ...parsed.data } as Provider;
    save(db);
    return json(200, db.provider);
  }

  if (method === 'POST' && path === '/api/me/telegram-link') {
    const denied = needSession();
    if (denied) return denied;
    db.tgRequestedAt = Date.now();
    save(db);
    return json(200, { url: 'https://t.me/paidar_demo_bot?start=link_demo', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
  }

  if (path.startsWith('/api/')) {
    const denied = needSession();
    if (denied) return denied;
    const sp = new URL(url, window.location.origin).searchParams;
    const res = handleDomain(method, path, sp, body, db.provider!, db.domain);
    if (res) { save(db); return res; }
  }

  return fail(404, 'NOT_FOUND', `Mock API has no ${method} ${path}.`);
}
