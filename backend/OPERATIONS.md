# Paidar backend: operations runbook

Covers the operations side of the Paidar spec: BE-17 (staging/production baseline), BE-14 (reconciliation alerts) and BE-19 (live Kora cutover). The code side is already built. This file lists what someone has to set up, rehearse or decide.

Status key: **Built** = in the code and covered by tests · **To do** = a person has to do it once · **Blocked** = waiting on an open decision (D1–D7 in the spec).

---

## 1. Environments (BE-17)

| | Staging | Production |
|---|---|---|
| Worker | `kobo-exact-staging` | `kobo-exact` |
| Kora | sandbox keys (`KORA_MODE=sandbox`) | live keys (`KORA_MODE=live`) |
| Database | its own Postgres + Hyperdrive (caching **disabled**) | its own Postgres + Hyperdrive (caching **disabled**) |
| Dev login, simulate-payment | allowed | refused at startup (`loadConfig` throws); tested in `test/integration/v1-1.test.ts` (T16) |
| Follow-up reminder (`REMINDER_FOLLOW_UP_TIME`) | `08:00` | off until product agrees |

**Secrets** (each environment separately: `npx wrangler secret put <NAME> --env <env>`): `KORA_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_SECRET`. Never reuse a value across environments.

**Cookies and CORS:** use one origin (the frontend proxies `/api` and `/p` to the Worker) or sibling subdomains of one registered domain (`app.example.com` + `api.example.com`), always HTTPS. The cookie is `Secure` whenever `PUBLIC_BASE_URL` is https. Set `FRONTEND_ORIGINS` (plural, comma-separated) to the exact frontend origin. `COOKIE_SAMESITE=Lax` for one origin or sibling subdomains; `None` only if the domains are unrelated (not recommended).

**To do:** fill in the real hostnames and Hyperdrive ids in `wrangler.jsonc`, and add the GitHub secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `STAGING_DATABASE_URL` and `PRODUCTION_DATABASE_URL`.

## 2. Rate limits (BE-17): Built

One Cloudflare rate-limit binding (`PUBLIC_RATE_LIMITER`, 60 per minute) keyed per scope and IP:

- `public:<ip>`: the payment page and its status JSON
- `claim:<ip>`: "I've paid", plus a database limit of 3 claims per request per 10 minutes
- `signin:<ip>`: `/api/auth/exchange` and `/api/auth/dev-login`

If sign-in needs a tighter limit than 60 per minute, add a second binding and pass it in `src/index.ts`.

## 3. Monitoring and alerts (BE-14, BE-17)

**Built:**

- `GET /api/admin/health` (header `X-Admin-Secret`) returns `ok`, `alerts[]` and the backlog numbers. The thresholds live in `src/services/health.ts`.
- While `ok` is false, the cron sweep logs **`monitor.alert`** at error level every 5 minutes. It covers:
  - unprocessed webhooks (count and oldest age)
  - unsent notifications
  - the reconciliation backlog
  - dead-lettered verifications
- Dead-lettered queue messages never disappear silently:
  - a failed payment verification becomes a `VERIFICATION_FAILED` review item
  - a failed Telegram send is marked `failedAt` and counted in `failedNotifications24h`
- Logs are JSON with `requestId`, `koraReference`, `requestId`/`jobId`/`providerId`. They never include session tokens, login tokens, account secrets or customer phone numbers.

**To do:**

1. In Workers Logs / Observability, create an alert on `evt = "monitor.alert"`, and one on `evt = "queue.dead_letter"`.
2. Create an alert on the Worker's error rate, for example 5xx above 2% over 5 minutes.
3. Point an uptime check at `GET /health` (it returns 503 when the database is unreachable). Optionally also point one at `/api/admin/health` with the secret, alerting when `ok` is false.
4. Watch the `*-dlq` queue depth in the Cloudflare dashboard.

## 4. Backups and restore (BE-17): To do

1. Turn on point-in-time recovery on the production Postgres (Neon or Supabase both offer it), keeping at least 7 days.
2. Restore test, done once before launch and then every quarter:
   - restore into a new branch or database
   - run `npx prisma migrate status` against it
   - spot-check that `SELECT count(*) FROM "Payment"` matches production at the restore point
   - point a staging Worker at it and open a known `/p/<token>`
   - write down how long it took
3. Migrations are reversible:
   - each 1.1.0 migration folder has a `down.sql`
   - test it on a copy of production data before deploying, with `psql -f migration.sql`, then `psql -f down.sql`, then `migration.sql` again

## 5. Deploys and rollback (BE-17)

- CI (`.github/workflows/backend.yml`) runs on every push: typecheck, unit and integration tests, **contract and e2e tests**, then a bundle check. Main deploys to staging. Production is a manual dispatch.
- Order is always **migrate first, then deploy the Worker**. Every 1.1.0 column is nullable, so the old Worker keeps working on the new schema.
- **Rollback the Worker:** `npx wrangler rollback --env production` (or pick a version in the dashboard). Leave the database alone: the new columns are ignored by the old code.
- **Rollback the schema** only if the migration itself is faulty: run that migration's `down.sql`, then delete its row from `_prisma_migrations`.
- **To do:** rehearse one Worker rollback on staging and note the time.

## 6. Incidents

| Symptom | First checks |
|---|---|
| Customer paid, provider not pinged | `GET /api/admin/support/requests/<reference>`: was a webhook received and processed? Is the notification sent or failed? Then `POST /api/requests/:id/recheck` as the provider, or wait: reconciliation re-queries every 2 minutes. |
| Many `monitor.alert` events | `/api/admin/health` → which backlog. Kora down: the reconciliation and verify queues retry with backoff on their own. Telegram down: notifications retry, then fail visibly. |
| Webhook signature failures | Check `KORA_SECRET_KEY` matches the Kora dashboard for this environment. |
| Duplicate-account log (`request.duplicate_account_number`) | Kora returned an account number already live on another request. The second request stayed a draft. Report to Kora with both references. |

For every incident, record what happened, the customer and provider impact, and the fix.

## 7. Live Kora cutover (BE-19): Blocked on D1, D2, D3

1. **D1:** decide the merchant model (each provider their own Kora merchant, or one Paidar account collecting for many; the second needs Kora approval and may have licensing implications).
2. **D2:** confirm with Kora:
   - the default single-use account validity and whether it can be chosen
   - whether the displayed account name can be the business name
   - whether account numbers are ever recycled. The duplicate guard is a partial unique index on *live* requests only, which assumes they can be recycled after expiry.
3. **D3:** confirm fees, who bears them, and settlement timing. Show none of these to providers until confirmed.
4. Production secrets: the live `KORA_SECRET_KEY`. In the Kora dashboard, set the live webhook URL to `https://<production host>/webhooks/kora`. Make sure the bank-transfer API is enabled on the live account.
5. Make one **real small payment** (e.g. ₦100) end to end:
   - the provider ping arrives within seconds
   - the job shows Paid
   - the customer page shows the receipt
   - the amount matches the bank statement
6. Then test against real banks, using `npm run kora:sandbox-e2e` as the script outline:
   - a short payment: reversed, the request stays open
   - an overpayment: the correct paid amount shows and the job is flagged for review
   - an expired account
   - a late payment: it becomes a "Paid after the account expired" review item
7. **Definition of usable:**
   - 20 real payments, every amount matching the bank
   - a backup restored once
   - a rollback rehearsed
   - a person watching the first live payments

## 8. Security review before opening to more people (BE-17): To do

Check:

- the payment page CSP (`PAY_PAGE_CSP` in `src/http/pay-page.ts`), `X-Frame-Options: DENY`, `noindex`, `no-store`
- cookie flags (`HttpOnly`, `Secure`, `SameSite`)
- the CSRF header on every mutating route and on `claim-paid`
- that admin routes require `ADMIN_SECRET`
- that no dev endpoints are reachable in production (T16)
- that `/p/:token` reveals only the customer's first name
