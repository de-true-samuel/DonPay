# Deploying Paidar (Cloudflare Workers)

Paidar deploys as a root frontend Worker (`paidar`) serving the built Vite SPA and proxying API/public payment status calls to the backend Hono Worker (`backend/`).

---

## 1. Topology

```
Browser ──► paidar.<account>.workers.dev   (Root Wrangler Worker: ./dist + worker/index.js)
              │  forwards /api/*, /p/:token/status, /p/:token/claim-paid
              ▼  via BACKEND_ORIGIN
            backend.<account>.workers.dev  (backend/ Cloudflare Worker: Hono + Prisma)
              │  Hyperdrive (caching disabled)
              ▼
            PostgreSQL (Neon)
```

---

## 2. Backend Worker Setup (`backend/`)

1. Authenticate Wrangler:
   ```bash
   cd backend
   npx wrangler login
   npx wrangler whoami
   ```
2. Provision Hyperdrive (pointing at direct Postgres connection string, caching disabled) and Queues:
   ```bash
   npx wrangler hyperdrive create paidar-staging --connection-string="$DATABASE_URL_UNPOOLED" --caching-disabled
   npx wrangler queues create kobo-exact-staging
   npx wrangler queues create kobo-exact-staging-dlq
   ```
3. Configure secrets for the target environment (`--env staging` or `--env production`):
   ```bash
   npx wrangler secret put KORA_SECRET_KEY --env staging
   npx wrangler secret put ADMIN_SECRET --env staging
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env staging
   npx wrangler secret put CLERK_SECRET_KEY --env staging
   ```
4. Apply Prisma migrations against the direct database URL (`DATABASE_URL_UNPOOLED`), then deploy:
   ```bash
   npm run db:deploy
   npm run deploy:staging
   ```
5. Verify database health:
   ```bash
   curl https://<backend-host>/health
   # Expected: {"ok":true,"db":true,...}
   ```
6. Point the Kora dashboard webhook URL to `https://<backend-host>/webhooks/kora`.

---

## 3. Frontend Worker Setup (Repository Root)

1. Confirm `wrangler.jsonc` sets `BACKEND_ORIGIN` (and `.env.production` configures any required build-time variables such as `VITE_MOCK=false`).
2. Run typechecks, tests, build, and deploy from the repository root:
   ```bash
   npm run typecheck
   npm test
   npm run build
   npx wrangler deploy
   ```

---

## 4. CI/CD Automation

`.github/workflows/backend.yml` runs backend typechecks, tests, bundle checks, and deployments when repository secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `STAGING_DATABASE_URL`, `PRODUCTION_DATABASE_URL`) are configured.
