/**
 * Clerk website sign-in (optional). The Clerk JWT check itself is Clerk's code (@clerk/hono);
 * these tests cover our side: config, provider linking, and that our own sessions keep working.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig, type Env } from '../../src/config';
import { providerForClerkUser, type ClerkUserLookup } from '../../src/services/auth';
import { json, setupHarness } from '../helpers';

const h = setupHarness();
const users = (u: Partial<{ firstName: string | null; lastName: string | null; username: string | null }> | Error): ClerkUserLookup => ({
  getUser: async () => {
    if (u instanceof Error) throw u;
    return { firstName: null, lastName: null, username: null, ...u };
  },
});
const uid = () => `user_test_${Math.random().toString(36).slice(2, 12)}`;

describe('Clerk sign-in', () => {
  it('first sign-in creates one provider named after the person; later sign-ins reuse it', async () => {
    const id = uid();
    const a = await providerForClerkUser(h.deps, id, users({ firstName: 'Ada', lastName: 'Obi' }));
    expect(a.businessName).toBe('Ada Obi');
    expect(a.clerkUserId).toBe(id);
    const b = await providerForClerkUser(h.deps, id, users(new Error('should not be called')));
    expect(b.id).toBe(a.id);
  });

  it('two first requests at the same time still create a single provider', async () => {
    const id = uid();
    const [a, b] = await Promise.all([
      providerForClerkUser(h.deps, id, users({ firstName: 'Bola' })),
      providerForClerkUser(h.deps, id, users({ firstName: 'Bola' })),
    ]);
    expect(a.id).toBe(b.id);
    expect(await h.db.provider.count({ where: { clerkUserId: id } })).toBe(1);
  });

  it('falls back to "My business" when Clerk has no name or the lookup fails', async () => {
    expect((await providerForClerkUser(h.deps, uid(), users({}))).businessName).toBe('My business');
    expect((await providerForClerkUser(h.deps, uid(), users(new Error('Clerk down')))).businessName).toBe('My business');
  });

  it('config: Clerk is off without keys, on with both, and refuses only one of the pair', () => {
    const base: Env = {
      HYPERDRIVE: { connectionString: '' },
      QUEUE: { send: async () => {}, sendBatch: async () => {} },
      APP_ENV: 'local',
      PUBLIC_BASE_URL: 'http://localhost',
      FRONTEND_URL: 'http://localhost:5173',
      FRONTEND_ORIGINS: 'http://localhost:5173',
      KORA_MODE: 'fake',
    };
    expect(loadConfig(base).clerk).toBeNull();
    expect(loadConfig({ ...base, CLERK_PUBLISHABLE_KEY: 'pk_test_x', CLERK_SECRET_KEY: 'sk_test_x' }).clerk).toEqual({
      publishableKey: 'pk_test_x',
      secretKey: 'sk_test_x',
    });
    expect(() => loadConfig({ ...base, CLERK_SECRET_KEY: 'sk_test_x' })).toThrow(/both/);
  });

  it('with Clerk off, our own sessions work exactly as before', async () => {
    const login = await json(await h.api('POST', '/api/auth/dev-login', { body: { businessName: 'No Clerk Shop' } }));
    const me = await h.api('GET', '/api/me', { token: login.sessionToken });
    expect(me.status).toBe(200);
    expect((await h.api('GET', '/api/me')).status).toBe(401);
  });
});
