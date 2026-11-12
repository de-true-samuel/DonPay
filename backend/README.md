# Paidar backend (formerly Kobo-Exact)

Implements **contract 1.1.0** ([`../Paidar_Backend_Implementation_Spec.md`](../Paidar_Backend_Implementation_Spec.md)). Operations, monitoring, backups, rollback and the live Kora cutover: [`OPERATIONS.md`](OPERATIONS.md).

One Cloudflare Worker (Hono + TypeScript) with three entry points (HTTP, queue consumer, per-minute cron), backed by Postgres through Hyperdrive and Prisma. Design: [`../ARCHITECTURE.md`](../ARCHITECTURE.md). API: [`../contract.md`](../contract.md). The frontend lives in `../frontend` and talks to this backend only through the contract.

## Quick start (local, no Kora or Telegram account needed)

Requirements: Node 24+, Docker.

```bash
cd backend
npm install                 # also runs `prisma generate` and `wrangler types`
cp .env.example .env
cp .dev.vars.example .dev.vars
npm run db:up               # Postgres 17 on localhost:54329 (+ a kobo_exact_test database)
npm run db:deploy           # apply migrations
npm run db:seed             # demo provider "Tolu's Glam Studio" with a week of jobs
npm run dev                 # Worker on http://127.0.0.1:8790
```

Then log in and look around:

```bash
curl -s -X POST http://127.0.0.1:8790/api/auth/dev-login \
  -H 'X-Requested-With: kobo-exact' -H 'Content-Type: application/json' \
  -d '{"businessName":"Tolu'"'"'s Glam Studio"}'
# → { "sessionToken": "...", "provider": {...} }   use it as  Authorization: Bearer <token>
```

Locally `KORA_MODE=fake`: sending a request allocates a fake account, and `POST /api/dev/simulate-payment/:requestId` completes a payment through the real verification code. Telegram messages are printed to the Worker log when no bot token is set. Trigger the cron sweep by hand with `curl "http://127.0.0.1:8790/__scheduled?cron=*+*+*+*+*"` (start dev with `npx wrangler dev --test-scheduled`).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | `wrangler dev` on port 8790 (Hyperdrive → local Postgres, queues and cron simulated locally) |
| `npm test` | Unit and integration tests (Vitest, real Postgres from `TEST_DATABASE_URL`; migrations applied automatically) |
| `npm run test:unit` | Pure domain tests only, no database |
| `npm run test:e2e` | End-to-end: starts mock Kora + Telegram (real API formats), runs the real Worker in `wrangler dev` with `KORA_MODE=live` pointed at them, and drives the whole product flow over HTTP. Every response is validated against `contract.md`. Uses its own `kobo_exact_e2e` database and writes `e2e/last-run.md`. Needs `npm run db:up` first. |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Create a new migration in development (`prisma migrate dev`) |
| `npm run db:deploy` | Apply migrations (`prisma migrate deploy`) to `DATABASE_URL` |
| `npm run db:seed` | Reset and reseed the demo provider |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` |
| `npm run telegram:set-webhook` | Point the bot at `WORKER_URL/webhooks/telegram` |
| `npm run kora:sandbox-e2e` | Real Kora sandbox check against a deployed Worker (EXECUTION_PLAN M3) |

## Layout

```
src/
  index.ts              export default { fetch, queue, scheduled }
  config.ts             bindings + config parsing (fails fast on unsafe production config)
  deps.ts               per-invocation dependency container (db, kora, telegram, queue, clock, log)
  domain/               pure logic, no I/O: money, job maths, state machine, messages, time, search parsing
  services/             business operations; every query is scoped by providerId
  integrations/kora/    HTTP client, webhook signature, fake client. All Kora field names live here.
  integrations/telegram outbound sender
  http/                 Hono app, validation, customer payment page
  queue/                message schema + consumer (retries, dead-letter handling)
  shared/contract.ts    response types: the frontend can copy this file verbatim
prisma/
  schema.prisma         two generators: cloudflare runtime (Worker) and nodejs (tests, scripts)
  migrations/           incl. hand-written constraints (partial unique index, CHECKs, pg_trgm)
  seed.ts
test/unit, test/integration
```

## How the money path works

1. `POST /api/requests/:id/send` saves our Kora reference **before** calling Kora, allocates the single-use account, and marks the request SENT. Retrying is safe.
2. Kora calls `POST /webhooks/kora`. We check the signature, store the event under a unique key (duplicates are no-ops), enqueue `kora.verify`, and return 200.
3. The queue consumer **queries Kora itself**. Only on `success` does it record the payment with Kora's *amount accepted*, in one transaction that also sets the request to PAID, flags anything odd for review, and writes the provider alert to the outbox.
4. The alert is sent from the outbox. If an enqueue is lost, the cron sweep resends it. If a webhook is never processed, the sweep re-verifies it.
5. Expiry: the cron asks Kora before marking a request EXPIRED. A verified payment always wins, even after expiry.
6. Reconciliation (1.1.0): every waiting request, and every request until 30 minutes after its expiry, is re-queried with Kora at most every 2 minutes (`request.recheck` queue messages). The provider's "Recheck" button and the customer's "I've paid" button use the same path (`src/services/reconcile.ts`). A late webhook, or one that never arrives, is still caught, and a payment is never credited twice.

Integration tests cover each of these steps, including concurrent duplicate deliveries and the expiry race.

## Environments and deployment

| | Local | Staging | Production |
| --- | --- | --- | --- |
| Wrangler env | (top level) | `--env staging` | `--env production` |
| Kora | `fake` | `sandbox` | `live` |
| Dev login | on | on | **refused at startup** |

One-time setup per environment (staging shown):

```bash
npx wrangler hyperdrive create kobo-exact-staging --connection-string="<neon staging url>" --caching-disabled
#   → put the id in wrangler.jsonc env.staging.hyperdrive. Caching MUST stay disabled.
npx wrangler queues create kobo-exact-staging
npx wrangler queues create kobo-exact-staging-dlq
npx wrangler secret put KORA_SECRET_KEY --env staging
npx wrangler secret put TELEGRAM_BOT_TOKEN --env staging
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env staging
npx wrangler secret put ADMIN_SECRET --env staging
# set PUBLIC_BASE_URL / FRONTEND_URL / FRONTEND_ORIGINS / TELEGRAM_BOT_USERNAME in wrangler.jsonc
```

Deploy: migrations first, then the Worker:

```bash
DATABASE_URL=<direct staging url> npm run db:deploy
npm run deploy:staging
WORKER_URL=https://<staging url> TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... npm run telegram:set-webhook
```

Then set the Kora webhook URL in the Kora dashboard to `https://<staging url>/webhooks/kora`.

CI: [`../.github/workflows/backend.yml`](../.github/workflows/backend.yml) runs typecheck, tests (with a Postgres service) and a bundle dry run, then deploys staging on `main`. The deploy jobs need the repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `STAGING_DATABASE_URL` and `PRODUCTION_DATABASE_URL`, plus GitHub environments named `staging` and `production`.

## Pinned versions and measurements

- Prisma **7.10.1** (CLI, client and adapter pinned exactly). `npm install prisma` picked up an 8.0 release candidate during setup; keep the pin. Workers client: `prisma-client` generator, `runtime = "cloudflare"`, `@prisma/adapter-pg`.
- Bundle: about **1.46 MB gzipped** (`wrangler deploy --dry-run`), under the 3 MB Workers Free limit.
- Checked in the real `workerd` runtime via `wrangler dev`: health, login, Today, create, send, simulate payment, receipt page, search, CSRF and the cron trigger.

## Deviations from ARCHITECTURE.md (deliberate)

- **No grammY.** The bot handles four commands (`/start`, `/login`, `/today`, `/help`), so a small parser plus a `fetch`-based sender is lighter on Workers. It needs no `getMe` call per cold start and is testable without network mocks.
- **The frontend is a separate app** (`../frontend`), not Workers Static Assets. That means CORS with credentials and `COOKIE_SAMESITE=None` when it is on a different site. A Bearer token is also accepted.
- **Today and search derive balances in application code** over indexed candidate sets (at most 1,000 jobs for search), rather than one hand-written SQL query. That is plenty at provider scale. Move it to SQL if a provider ever outgrows it.
- **Customer receipts**: the payment link turns into the receipt, and the provider's alert includes a one-tap "Send receipt on WhatsApp" button. We never message customers directly.

## Contract 1.1.0 at a glance

| Spec item | Where |
|---|---|
| BE-01/02/07/08/12: short template, `details`, nudge, start message, Pidgin | `src/domain/messages.ts` |
| BE-03/04: `dueReminders`, reminders link to the job page, optional next-morning follow-up (`REMINDER_FOLLOW_UP_TIME`) | `src/services/today.ts`, `src/services/background.ts` |
| BE-05/06: copied marker, "I've paid" claim, recheck | `src/services/requests.ts`, `src/services/public.ts`, `src/services/reconcile.ts` |
| BE-09: `Idempotency-Key` | `src/http/idempotency.ts` |
| BE-10/11/16: `onboardedAt`, `phone`, export, delete, sign out everywhere | `src/http/app.ts`, `src/services/account.ts` |
| BE-13: customer payment page | `src/http/pay-page.ts` |
| BE-14/17: reconciliation, backlog alerts, rate limits, security headers | `src/services/background.ts`, `src/services/health.ts`, `src/http/app.ts` |
| BE-15: `messageConsent` deprecated (accepted, ignored) | `src/services/customers.ts`, `serialize.ts` |
| BE-18: support view | `src/services/support.ts` |
| BE-20: contract tests | `e2e/contract-schemas.ts`, run in CI |
| Duplicate-account guard (spec 5.3) | partial unique index `one_live_request_per_account` in the `v1_1_paidar` migration |

Tests: `test/integration/v1-1.test.ts` maps to the spec's acceptance tests T6, T7, T9, T10, T11, T14–T17.

## Still to confirm with Kora (⚠ in the code)

All in `src/integrations/kora/`: endpoint paths and response fields (`http-client.ts`), what the webhook signature covers (`signature.ts`, currently HMAC-SHA256 of `JSON.stringify(payload.data)`), whether a customer email is required (a per-request placeholder address is sent for now), max expiry window, and whether static IPs are required. Each answer only changes that folder.
