/**
 * The Hono HTTP app. Routes are thin: validate input, call a service, shape the response.
 * Every /api route except auth/public/admin requires a session and is scoped to that provider.
 */
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env } from '../config';
import type { Deps } from '../deps';
import { InvalidTransitionError } from '../domain/request-state';
import { MoneyError } from '../domain/money';
import { parseHHMM } from '../domain/time';
import { randomToken } from '../domain/tokens';
import { AppError } from '../errors';
import type { Provider as ProviderRow } from '../generated/prisma/client';
import * as auth from '../services/auth';
import * as customers from '../services/customers';
import { simulatePayment } from '../services/dev';
import { exportPaymentsCsv } from '../services/export';
import * as jobs from '../services/jobs';
import { recordManualPayment } from '../services/payments';
import { getPublicRequest } from '../services/public';
import * as requests from '../services/requests';
import * as review from '../services/review';
import { search } from '../services/search';
import { toProvider } from '../services/serialize';
import { createTelegramLink, handleTelegramUpdate } from '../services/telegram-bot';
import { getToday } from '../services/today';
import { receiveKoraWebhook } from '../services/webhooks';
import type { ApiError } from '../shared/contract';
import { renderNotFoundPage, renderPayPage } from './pay-page';
import {
  hhmm,
  isoDate,
  jobStatus,
  kobo,
  pageQuery,
  paymentPlan,
  phone,
  positiveKobo,
  readyRule,
  savedView,
  searchStatus,
  validate,
} from './validation';

export const SESSION_COOKIE = 'ke_session';
export const CSRF_HEADER_VALUE = 'kobo-exact';

export type AppEnv = {
  Bindings: Env;
  Variables: { deps: Deps; provider: ProviderRow; sessionToken: string; requestId: string };
};

export interface AppOptions {
  /** Build per-request dependencies. In the Worker this creates a fresh Prisma client. */
  makeDeps: (c: Context<AppEnv>) => Deps;
  /** Called after the response is ready (Worker: disconnect Prisma via waitUntil). */
  afterRequest?: (c: Context<AppEnv>, deps: Deps) => void;
  /** Optional per-IP rate limit for public endpoints. Return false to reject. */
  rateLimit?: (c: Context<AppEnv>, key: string) => Promise<boolean>;
}

const PUBLIC_API_PREFIXES = ['/api/auth/exchange', '/api/auth/dev-login', '/api/public/', '/api/admin/'];

export function createApp(opts: AppOptions) {
  const app = new Hono<AppEnv>();

  // --- request id + per-request deps -------------------------------------------------------
  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') || randomToken(9);
    c.set('requestId', requestId);
    const deps = opts.makeDeps(c);
    deps.log = withRequestId(deps.log, requestId);
    c.set('deps', deps);
    try {
      await next();
    } finally {
      c.header('x-request-id', requestId);
      opts.afterRequest?.(c, deps);
    }
  });

  // --- errors ------------------------------------------------------------------------------
  app.onError((err, c) => {
    const deps = c.get('deps');
    let appErr: AppError;
    if (err instanceof AppError) appErr = err;
    else if (err instanceof InvalidTransitionError) appErr = new AppError('INVALID_STATE', err.message);
    else if (err instanceof MoneyError) appErr = new AppError('VALIDATION_ERROR', err.message);
    else {
      deps?.log.error('http.unhandled', { error: (err as Error).message, stack: (err as Error).stack?.slice(0, 2000), path: c.req.path });
      appErr = new AppError('INTERNAL', 'Something went wrong. Please try again.');
    }
    const body: ApiError = { error: { code: appErr.code, message: appErr.message, ...(appErr.details !== undefined ? { details: appErr.details } : {}) } };
    c.header('x-request-id', c.get('requestId') ?? '');
    return c.json(body, appErr.status as 400);
  });
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } } satisfies ApiError, 404));

  // --- CORS for the separate frontend ----------------------------------------------------
  app.use(
    '/api/*',
    cors({
      origin: (origin, c) => (c.get('deps').config.frontendOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'],
      exposeHeaders: ['x-request-id', 'Content-Disposition'],
      maxAge: 600,
    }),
  );

  // --- CSRF + auth ---------------------------------------------------------------------------
  app.use('/api/*', async (c, next) => {
    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && c.req.header('x-requested-with') !== CSRF_HEADER_VALUE) {
      throw new AppError('CSRF_HEADER_MISSING', `Send the header "X-Requested-With: ${CSRF_HEADER_VALUE}" on every change request`);
    }
    if (method === 'OPTIONS' || PUBLIC_API_PREFIXES.some((p) => c.req.path.startsWith(p))) return next();
    const bearer = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = bearer ?? getCookie(c, SESSION_COOKIE);
    if (!token) throw new AppError('UNAUTHENTICATED', 'Please log in');
    const provider = await auth.providerForSession(c.get('deps'), token);
    if (!provider) throw new AppError('UNAUTHENTICATED', 'Your session has expired. Please log in again.');
    c.set('provider', provider);
    c.set('sessionToken', token);
    return next();
  });

  const publicRateLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (opts.rateLimit) {
      const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
      if (!(await opts.rateLimit(c, ip))) throw new AppError('RATE_LIMITED', 'Too many requests. Please wait a moment.');
    }
    return next();
  };

  const pid = (c: Context<AppEnv>) => c.get('provider').id;
  const d = (c: Context<AppEnv>) => c.get('deps');

  const setSessionCookie = (c: Context<AppEnv>, token: string) => {
    const cfg = d(c).config;
    const secure = cfg.cookieSameSite === 'None' || !cfg.publicBaseUrl.startsWith('http://');
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: cfg.cookieSameSite,
      path: '/',
      maxAge: Math.floor(auth.SESSION_TTL_MS / 1000),
    });
  };

  // --- health ------------------------------------------------------------------------------
  app.get('/health', async (c) => {
    let db = false;
    try {
      await d(c).db.$queryRaw`SELECT 1`;
      db = true;
    } catch (err) {
      d(c).log.error('health.db_failed', { error: (err as Error).message });
    }
    return c.json({ ok: db, db, time: d(c).now().toISOString() }, db ? 200 : 503);
  });

  // --- auth --------------------------------------------------------------------------------
  app.post('/api/auth/exchange', validate('json', z.object({ token: z.string().min(10) })), async (c) => {
    const res = await auth.exchangeLoginToken(d(c), c.req.valid('json').token);
    setSessionCookie(c, res.sessionToken);
    return c.json(res);
  });
  app.post('/api/auth/dev-login', validate('json', z.object({ businessName: z.string().trim().min(2).max(80) })), async (c) => {
    const res = await auth.devLogin(d(c), c.req.valid('json').businessName);
    setSessionCookie(c, res.sessionToken);
    return c.json(res);
  });
  app.post('/api/auth/logout', async (c) => {
    await auth.logout(d(c), c.get('sessionToken'));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.body(null, 204);
  });

  // --- me ----------------------------------------------------------------------------------
  app.get('/api/me', (c) => c.json(toProvider(c.get('provider'))));
  app.patch(
    '/api/me',
    validate(
      'json',
      z.object({
        businessName: z.string().trim().min(2).max(80).optional(),
        defaultReadyRule: readyRule.optional(),
        digestTime: hhmm.nullable().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid('json');
      const updated = await d(c).db.provider.update({
        where: { id: pid(c) },
        data: {
          ...(body.businessName !== undefined ? { businessName: body.businessName } : {}),
          ...(body.defaultReadyRule !== undefined ? { defaultReadyRule: body.defaultReadyRule } : {}),
          ...(body.digestTime !== undefined ? { digestMinuteOfDay: body.digestTime === null ? null : parseHHMM(body.digestTime) } : {}),
        },
      });
      return c.json(toProvider(updated));
    },
  );
  app.post('/api/me/telegram-link', async (c) => {
    if (!d(c).config.telegramBotUsername) throw new AppError('FORBIDDEN', 'Telegram is not configured on this server');
    return c.json(await createTelegramLink(d(c), pid(c)));
  });

  // --- today -------------------------------------------------------------------------------
  app.get('/api/today', async (c) => c.json(await getToday(d(c), pid(c))));

  // --- customers ---------------------------------------------------------------------------
  app.get('/api/customers', validate('query', pageQuery.extend({ q: z.string().max(100).optional() })), async (c) =>
    c.json(await customers.listCustomers(d(c), pid(c), c.req.valid('query'))),
  );
  app.post(
    '/api/customers',
    validate('json', z.object({ name: z.string().trim().min(1).max(100), phone, messageConsent: z.boolean().optional() })),
    async (c) => c.json(await customers.createCustomer(d(c), pid(c), c.req.valid('json')), 201),
  );
  app.post('/api/customers/import', validate('json', z.object({ csv: z.string().min(1).max(1_000_000) })), async (c) =>
    c.json(await customers.importCustomers(d(c), pid(c), c.req.valid('json').csv)),
  );
  app.get('/api/customers/:id', async (c) => c.json(await customers.getCustomerPage(d(c), pid(c), c.req.param('id'))));
  app.patch(
    '/api/customers/:id',
    validate('json', z.object({ name: z.string().trim().min(1).max(100).optional(), phone: phone.optional(), messageConsent: z.boolean().optional() })),
    async (c) => c.json(await customers.updateCustomer(d(c), pid(c), c.req.param('id'), c.req.valid('json'))),
  );

  // --- jobs --------------------------------------------------------------------------------
  const createJobSchema = z
    .object({
      customerId: z.string().min(1).optional(),
      customer: z.object({ name: z.string().trim().min(1).max(100), phone, messageConsent: z.boolean().optional() }).optional(),
      service: z.string().trim().min(1).max(120),
      totalKobo: positiveKobo,
      plan: paymentPlan,
      depositKobo: positiveKobo.optional(),
      balanceDueAt: isoDate.nullable().optional(),
      readyRule: readyRule.optional(),
      notes: z.string().max(2000).optional(),
    })
    .refine((v) => Boolean(v.customerId) !== Boolean(v.customer), { message: 'Provide either customerId or customer', path: ['customerId'] });
  app.post('/api/jobs', validate('json', createJobSchema), async (c) => c.json(await jobs.createJob(d(c), pid(c), c.req.valid('json')), 201));
  app.get('/api/jobs', validate('query', pageQuery.extend({ status: jobStatus.optional() })), async (c) =>
    c.json(await jobs.listJobs(d(c), pid(c), c.req.valid('query'))),
  );
  app.get('/api/jobs/:id', async (c) => c.json(await jobs.getJobDetail(d(c), pid(c), c.req.param('id'))));
  app.patch(
    '/api/jobs/:id',
    validate(
      'json',
      z.object({
        service: z.string().trim().min(1).max(120).optional(),
        notes: z.string().max(2000).nullable().optional(),
        balanceDueAt: isoDate.nullable().optional(),
        readyRule: readyRule.optional(),
      }),
    ),
    async (c) => c.json(await jobs.updateJob(d(c), pid(c), c.req.param('id'), c.req.valid('json'))),
  );
  app.post('/api/jobs/:id/cancel', async (c) => c.json(await jobs.cancelJob(d(c), pid(c), c.req.param('id'))));
  app.post('/api/jobs/:id/requests/balance', validate('json', z.object({ send: z.boolean().optional() }).default({})), async (c) =>
    c.json(await requests.createBalanceRequest(d(c), pid(c), c.req.param('id'), { send: c.req.valid('json').send ?? false }), 201),
  );
  app.post(
    '/api/jobs/:id/payments/manual',
    validate('json', z.object({ amountKobo: positiveKobo, note: z.string().max(500).optional(), receivedAt: isoDate.optional() })),
    async (c) => c.json(await recordManualPayment(d(c), pid(c), c.req.param('id'), c.req.valid('json')), 201),
  );

  // --- requests ----------------------------------------------------------------------------
  app.post('/api/requests/:id/send', async (c) => c.json(await requests.sendRequest(d(c), pid(c), c.req.param('id'))));
  app.post('/api/requests/:id/schedule', validate('json', z.object({ scheduledFor: isoDate })), async (c) =>
    c.json(await requests.scheduleRequest(d(c), pid(c), c.req.param('id'), c.req.valid('json').scheduledFor)),
  );
  app.post('/api/requests/:id/cancel', async (c) => c.json(await requests.cancelRequest(d(c), pid(c), c.req.param('id'))));
  app.post('/api/requests/:id/resend', async (c) => c.json(await requests.resendRequest(d(c), pid(c), c.req.param('id'))));
  app.get('/api/requests/:id/message', async (c) => c.json(await requests.getRequestMessage(d(c), pid(c), c.req.param('id'))));
  app.get('/api/payments/:id/receipt-message', async (c) => c.json(await requests.getReceiptMessage(d(c), pid(c), c.req.param('id'))));

  // --- search, review, export --------------------------------------------------------------
  app.get(
    '/api/search',
    validate(
      'query',
      pageQuery.extend({
        q: z.string().max(100).optional(),
        status: z
          .string()
          .optional()
          .transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined))
          .pipe(z.array(searchStatus).optional()),
        from: z.string().optional(),
        to: z.string().optional(),
        view: savedView.optional(),
      }),
    ),
    async (c) => c.json(await search(d(c), pid(c), c.req.valid('query'))),
  );
  app.get('/api/review', validate('query', pageQuery.extend({ state: z.enum(['open', 'resolved']).default('open') })), async (c) =>
    c.json(await review.listReview(d(c), pid(c), c.req.valid('query'))),
  );
  app.post(
    '/api/review/:id/resolve',
    validate('json', z.object({ resolution: z.string().trim().min(1).max(500), cancelRequestId: z.string().min(1).optional() })),
    async (c) => c.json(await review.resolveReview(d(c), pid(c), c.req.param('id'), c.req.valid('json'))),
  );
  app.get('/api/export.csv', validate('query', z.object({ from: z.string().optional(), to: z.string().optional() })), async (c) => {
    const csv = await exportPaymentsCsv(d(c), pid(c), c.req.valid('query'));
    return c.body(csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kobo-exact-payments-${d(c).now().toISOString().slice(0, 10)}.csv"`,
    });
  });

  // --- dev (KORA_MODE=fake only) -----------------------------------------------------------
  app.post(
    '/api/dev/simulate-payment/:requestId',
    validate('json', z.object({ amountKobo: kobo.optional(), payerName: z.string().max(100).nullable().optional() }).default({})),
    async (c) => c.json(await simulatePayment(d(c), pid(c), c.req.param('requestId'), c.req.valid('json'))),
  );

  // --- admin -------------------------------------------------------------------------------
  app.get('/api/admin/health', async (c) => {
    const secret = d(c).config.adminSecret;
    if (!secret || c.req.header('x-admin-secret') !== secret) throw new AppError('FORBIDDEN', 'Admin secret required');
    const db = d(c).db;
    const [unprocessedWebhooks, oldest, unsentNotifications, openReviewItems, unattributedReviewItems] = await Promise.all([
      db.webhookEvent.count({ where: { processedAt: null, signatureOk: true } }),
      db.webhookEvent.findFirst({ where: { processedAt: null, signatureOk: true }, orderBy: { receivedAt: 'asc' }, select: { receivedAt: true } }),
      db.notification.count({ where: { sentAt: null, failedAt: null } }),
      db.reviewItem.count({ where: { resolvedAt: null } }),
      db.reviewItem.count({ where: { resolvedAt: null, providerId: null } }),
    ]);
    return c.json({
      deadLetterHint: 'Check the kobo-exact-dlq queue depth in the Cloudflare dashboard',
      unprocessedWebhooks,
      unsentNotifications,
      openReviewItems,
      unattributedReviewItems,
      oldestUnprocessedWebhookAt: oldest?.receivedAt.toISOString() ?? null,
    });
  });

  // --- public: customer payment page ------------------------------------------------------
  const tokenParam = (c: Context<AppEnv>) => {
    const t = c.req.param('token') ?? '';
    return /^[A-Za-z0-9_-]{16,64}$/.test(t) ? t : null;
  };
  const publicJson = async (c: Context<AppEnv>) => {
    const t = tokenParam(c);
    if (!t) throw new AppError('NOT_FOUND', 'Payment request not found');
    c.header('Cache-Control', 'no-store');
    return c.json(await getPublicRequest(d(c), t));
  };
  app.get('/p/:token/status', publicRateLimit, publicJson);
  app.get('/api/public/requests/:token', publicRateLimit, publicJson);
  app.get('/p/:token', publicRateLimit, async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    const t = tokenParam(c);
    if (!t) return c.html(renderNotFoundPage(), 404);
    try {
      return c.html(renderPayPage(t, await getPublicRequest(d(c), t)));
    } catch (err) {
      if (err instanceof AppError && err.code === 'NOT_FOUND') return c.html(renderNotFoundPage(), 404);
      throw err;
    }
  });

  // --- webhooks ----------------------------------------------------------------------------
  app.post('/webhooks/kora', async (c) => {
    const raw = await c.req.text();
    const result = await receiveKoraWebhook(d(c), raw, c.req.header('x-korapay-signature') ?? null);
    return c.json(result.body, result.status);
  });
  app.post('/webhooks/telegram', async (c) => {
    const expected = d(c).config.telegramWebhookSecret;
    if (!expected || c.req.header('x-telegram-bot-api-secret-token') !== expected) {
      return c.json({ ok: false }, 401);
    }
    const update = await c.req.json().catch(() => null);
    try {
      await handleTelegramUpdate(d(c), update);
    } catch (err) {
      // Always 200 to Telegram, or it redelivers the same update forever.
      d(c).log.error('telegram.update_failed', { error: (err as Error).message });
    }
    return c.json({ ok: true });
  });

  return app;
}

function withRequestId(log: Deps['log'], requestId: string): Deps['log'] {
  return {
    info: (e, f) => log.info(e, { requestId, ...f }),
    warn: (e, f) => log.warn(e, { requestId, ...f }),
    error: (e, f) => log.error(e, { requestId, ...f }),
  };
}
