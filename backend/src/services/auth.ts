/**
 * Provider auth: Telegram magic links (ARCHITECTURE.md §6.7), dev login, and Clerk website sign-in.
 * Only hashes of login tokens and session tokens are stored. Clerk sessions are verified by Clerk, not stored here.
 */
import type { Deps } from '../deps';
import { hashToken, randomToken } from '../domain/tokens';
import { AppError } from '../errors';
import { toProvider } from './serialize';
import type * as C from '../shared/contract';

const LOGIN_TOKEN_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function issueLoginLink(deps: Deps, providerId: string): Promise<string> {
  const raw = randomToken(32);
  await deps.db.loginToken.create({
    data: { tokenHash: await hashToken(raw), providerId, expiresAt: new Date(deps.now().getTime() + LOGIN_TOKEN_TTL_MS) },
  });
  return `${deps.config.frontendUrl}/auth?t=${encodeURIComponent(raw)}`;
}

async function createSession(deps: Deps, providerId: string): Promise<string> {
  const raw = randomToken(32);
  await deps.db.session.create({
    data: { providerId, tokenHash: await hashToken(raw), expiresAt: new Date(deps.now().getTime() + SESSION_TTL_MS) },
  });
  return raw;
}

export async function exchangeLoginToken(deps: Deps, rawToken: string): Promise<C.AuthResponse> {
  const tokenHash = await hashToken(rawToken);
  const now = deps.now();
  // Single use: only one concurrent exchange can flip usedAt from null.
  const { count } = await deps.db.loginToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (count === 0) throw new AppError('UNAUTHENTICATED', 'This login link is invalid or has expired. Send /login to the bot for a new one.');
  const token = await deps.db.loginToken.findUniqueOrThrow({ where: { tokenHash }, include: { provider: true } });
  const sessionToken = await createSession(deps, token.providerId);
  deps.log.info('auth.login', { providerId: token.providerId });
  return { sessionToken, provider: toProvider(token.provider) };
}

export async function devLogin(deps: Deps, businessName: string): Promise<C.AuthResponse> {
  if (!deps.config.devLoginEnabled) throw new AppError('FORBIDDEN', 'Dev login is disabled');
  const key = businessName.trim().toLowerCase();
  const provider = await deps.db.provider.upsert({
    where: { devLoginKey: key },
    create: { businessName: businessName.trim(), devLoginKey: key },
    update: {},
  });
  return { sessionToken: await createSession(deps, provider.id), provider: toProvider(provider) };
}

export async function providerForSession(deps: Deps, rawToken: string) {
  const session = await deps.db.session.findUnique({ where: { tokenHash: await hashToken(rawToken) }, include: { provider: true } });
  if (!session || session.expiresAt <= deps.now()) return null;
  return session.provider;
}

export async function logout(deps: Deps, rawToken: string): Promise<void> {
  await deps.db.session.deleteMany({ where: { tokenHash: await hashToken(rawToken) } });
}

/** What we need from a Clerk user to open a provider account (kept minimal so tests can stub it). */
export interface ClerkUserLookup {
  getUser(userId: string): Promise<{ firstName: string | null; lastName: string | null; username: string | null }>;
}

/**
 * Clerk website sign-in: the provider linked to this Clerk user, created on first sign-in.
 * The business name starts as the person's name (or "My business") and is set properly in onboarding.
 */
export async function providerForClerkUser(deps: Deps, clerkUserId: string, users: ClerkUserLookup) {
  const existing = await deps.db.provider.findUnique({ where: { clerkUserId } });
  if (existing) return existing;
  let businessName = 'My business';
  try {
    const u = await users.getUser(clerkUserId);
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username?.trim() || '';
    if (name.length >= 2) businessName = name.slice(0, 80);
  } catch (err) {
    deps.log.warn('auth.clerk_user_lookup_failed', { error: (err as Error).message });
  }
  // upsert: two first requests at once must not create two providers.
  const provider = await deps.db.provider.upsert({ where: { clerkUserId }, create: { clerkUserId, businessName }, update: {} });
  if (provider.createdAt.getTime() > deps.now().getTime() - 5_000) deps.log.info('auth.clerk_signup', { providerId: provider.id });
  return provider;
}
