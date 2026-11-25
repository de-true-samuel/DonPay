# Deploying Paidar (staging, on workers.dev)

How the deployed app fits together, and the steps to get there, in order. Operations after launch (alerts, backups, rollback, the live Kora cutover) are in `backend/OPERATIONS.md`.

## How it fits together

```
browser ──► paidar.<sub>.workers.dev  (frontend Worker "paidar", built from frontend/)
              │  /api/*, /p/:token/status, /p/:token/claim-paid
              ▼  service binding "BACKEND" (Worker to Worker, never leaves Cloudflare)
            kobo-exact-staging.<sub>.workers.dev  (backend Worker, backend/ env "staging")
              │  Hyperdrive (caching off)
              ▼
            Neon Postgres (staging database)

Kora sandbox ──webhooks──► kobo-exact-staging.<sub>.workers.dev/webhooks/kora
Customers' payment links ► kobo-exact-staging.<sub>.workers.dev/p/:token
```

The browser only talks to the frontend's address. That means no CORS, the session cookie is first-party (`COOKIE_SAMESITE=Lax`), and Clerk's token reaches the backend unchanged.

## Steps

| # | Who | Step |
|---|---|---|
| 1 | Owner of the Cloudflare account that hosts `paidar` | `cd backend && npx wrangler login` on the machine that deploys. Check with `npx wrangler whoami`, which also shows the account id. |
| 2 | **Done 2026-11-17** | Neon project `old-art-33870905`, branch `production`, in AWS us-east-2. It is linked in `backend/` (`neon.ts`, `.neon`). `backend/.env.staging` (ignored by git) holds `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct). All 4 migrations are applied, and it was tested end to end. |
| 3 | Deploy (scripted) | Create Hyperdrive with the **direct** string (Hyperdrive pools by itself; Neon's guidance is node-postgres + Hyperdrive on Cloudflare): `npx wrangler hyperdrive create kobo-exact-staging --connection-string="$DATABASE_URL_UNPOOLED" --caching-disabled`. Put the id in `wrangler.jsonc`, `env.staging.hyperdrive`. |
| 4 | Deploy (scripted) | Create the queues: `npx wrangler queues create kobo-exact-staging` and `npx wrangler queues create kobo-exact-staging-dlq`. |
| 5 | Deploy (scripted) | Fill the hostnames in `wrangler.jsonc`, `env.staging.vars`: `PUBLIC_BASE_URL=https://kobo-exact-staging.<sub>.workers.dev`, and `FRONTEND_URL` / `FRONTEND_ORIGINS=https://paidar.<sub>.workers.dev`. Also set `CLERK_PUBLISHABLE_KEY`. |
| 6 | Deploy (scripted) | Secrets (each prompts for the value): `npx wrangler secret put <NAME> --env staging` for `KORA_SECRET_KEY` (sandbox `sk_test_…`), `CLERK_SECRET_KEY`, `ADMIN_SECRET` and `TELEGRAM_WEBHOOK_SECRET` (both random). Add `TELEGRAM_BOT_TOKEN` once the bot exists. |
| 7 | Deploy (scripted) | Migrate over the **direct** string (never the `-pooler` one), then deploy: `DATABASE_URL="$DATABASE_URL_UNPOOLED" npx prisma migrate deploy`, then `npx wrangler deploy --env staging`. Check: `curl https://kobo-exact-staging.<sub>.workers.dev/health` should return `{"ok":true,"db":true}`. |
| 8 | Owner, Cloudflare dashboard | Workers & Pages → `paidar` → Settings → Build: set **Root directory** to `frontend`, keep build command `npm run build` and deploy command `npx wrangler deploy`. Under build **Variables**, add `VITE_CLERK_PUBLISHABLE_KEY=pk_test_…`. Then retry the latest build. |
| 9 | Deploy | After step 8 builds from `frontend/`: delete the duplicate frontend at the repo root (`src/`, `public/`, `index.html`, root `package*.json`, `vite.config.ts`, `tsconfig.json`, `wrangler.jsonc`), then push. |
| 10 | You, Kora dashboard (sandbox) | Webhook URL: `https://kobo-exact-staging.<sub>.workers.dev/webhooks/kora`. |
| 11 | Check | Open `https://paidar.<sub>.workers.dev`: sign up with Clerk, create a job, get payment details. The Kora sandbox pays it within about 2 minutes, and the job turns Paid. Or run `WORKER_URL=https://kobo-exact-staging.<sub>.workers.dev npm run kora:sandbox-e2e`. |

**Order matters:** deploy the backend (step 7) before the frontend builds from `frontend/` (step 8). The frontend's service binding points at `kobo-exact-staging`.

## Automatic deploys afterwards (optional)

`.github/workflows/backend.yml` runs migrations and `wrangler deploy --env staging` on every push to `main`, once these GitHub secrets exist:

- `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers", plus Hyperdrive and Queues edit)
- `CLOUDFLARE_ACCOUNT_ID`
- `STAGING_DATABASE_URL`: the Neon **direct** (`DATABASE_URL_UNPOOLED`) string, because CI runs `prisma migrate deploy` with it

The frontend redeploys on its own through Cloudflare's Git build.
