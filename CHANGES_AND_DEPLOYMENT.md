# Paidar: changes made and deployment status

Last updated 2026-11-18. The command-by-command runbook is in [DEPLOY.md](DEPLOY.md). Running the backend after launch (alerts, backups, rollback, the live Kora cutover) is covered in [backend/OPERATIONS.md](backend/OPERATIONS.md).

## 1. Where things stand: live on the real backend (staging)

| Part | Where | Status |
|---|---|---|
| **Frontend** | https://paidar.detruesamuel.workers.dev, Worker `paidar` on *Detruesamuel@gmail.com's Account* (`fccd1cb5…`) | **Live, connected to the backend.** The demo is gone. |
| **Backend** | https://kobo-exact-staging.theibukunjames.workers.dev, Worker `kobo-exact-staging` on *Theibukunjames@gmail.com's Account* (`8c5ab614…`) | **Live.** `/health` returns `{"ok":true,"db":true}`. Kora **sandbox**, Clerk development keys. |
| **Database** | Neon `old-art-33870905`, branch `production` (AWS us-east-2), reached through Hyperdrive `26b219a1…` (caching off) | **Live.** All 4 migrations are applied. |
| **Queues** | `kobo-exact-staging`, `kobo-exact-staging-dlq` (backend account) | Live |

**Verified on 2026-11-18 in a real browser on the live site:**
1. The site opens on the Clerk sign-in page, with no demo.
2. Sign-in works.
3. "Create and get payment details" returns a real Kora sandbox account (Test Bank 7100913098).
4. The Kora sandbox paid it, and the job turned **Fully paid / Ready to start**.
5. Sign-out returns to the sign-in page and ends the session.

`/api` on the live site answers with `x-contract-version: 1.1.1`.

### How it fits together

```
browser ──► paidar.detruesamuel.workers.dev            (frontend Worker, Samuel's account)
              │ /api/*, /p/:token/status, /p/:token/claim-paid
              ▼ HTTPS, with the visitor's IP + shared PROXY_SECRET
            kobo-exact-staging.theibukunjames.workers.dev   (backend Worker, your account)
              │ Hyperdrive
              ▼
            Neon Postgres
Kora sandbox ── webhooks ──► kobo-exact-staging.theibukunjames.workers.dev/webhooks/kora   (to set up)
Customer payment links   ──► kobo-exact-staging.theibukunjames.workers.dev/p/:token
```

**The two Workers are on different Cloudflare accounts,** because your login can't create Hyperdrive or Queues on Samuel's account. So the frontend Worker forwards over HTTPS instead of a service binding. The browser still only talks to `paidar.detruesamuel.workers.dev`: no CORS, first-party cookies, and Clerk works.

**Visitor IP:** the frontend sends the visitor's IP as `x-paidar-client-ip` together with `PROXY_SECRET`. The backend trusts that IP only when the secret matches, so rate limits and "I've paid" records use real visitor IPs, and nobody can fake them.

---

## 2. What still needs to be done

| # | Who | Step | Why |
|---|---|---|---|
| 1 | You | **Kora sandbox dashboard:** set the webhook URL to `https://kobo-exact-staging.theibukunjames.workers.dev/webhooks/kora` | Payments are then confirmed within seconds. Without it, the backend's background check with Kora (every 2 minutes) still catches them, which is how the test payment was confirmed. |
| 2 | Samuel | **Cloudflare → `paidar` → Settings → Build:** set **Root directory** to `frontend`, then retry the build | Builds currently come from the **repo root copy**. It's kept identical for now (same `worker/`, `wrangler.jsonc` and `.env.production`), so pushes still deploy the connected app. Switching removes the need for the duplicate. |
| 3 | Dev | After step 2: **delete the root copy** (`src/`, `public/`, `worker/`, `index.html`, root `package*.json`, `vite.config.ts`, `tsconfig.json`, `wrangler.jsonc`, `.env.production`) and push | One frontend, no drift. **Until then, any frontend change must be made in both `frontend/` and the root copy.** |
| 4 | You | **Telegram payment alerts:**<br>1. Create the bot with BotFather.<br>2. `cd backend && CLOUDFLARE_ACCOUNT_ID=8c5ab6140b2fdce073ce553d0ba6805f npx wrangler secret put TELEGRAM_BOT_TOKEN --env staging`<br>3. Set `TELEGRAM_BOT_USERNAME` in `backend/wrangler.jsonc` (staging) and redeploy.<br>4. Point the bot's webhook at `https://kobo-exact-staging.theibukunjames.workers.dev/webhooks/telegram` with the `TELEGRAM_WEBHOOK_SECRET` from `backend/.env.staging`. | Without it, providers get no instant "you've been paid" pings. |
| 5 | Optional | **Automatic backend deploys:** add the GitHub secrets `CLOUDFLARE_API_TOKEN` (your account: Workers, Hyperdrive and Queues edit), `CLOUDFLARE_ACCOUNT_ID=8c5ab6140b2fdce073ce553d0ba6805f` and `STAGING_DATABASE_URL` (the Neon **direct** string) | CI then migrates and deploys the backend on every push to `main`. Until then, redeploy with `scripts/deploy-staging.sh` (below). |
| 6 | Optional | **One account for both Workers:** move the backend to Samuel's account (needs the Administrator role) or the frontend to yours | The forwarding could then use a service binding (no public hop, no proxy secret). The current setup works fine as is. |
| 7 | Optional | **Neon region:** move to eu-central-1 (Frankfurt) while the data is small | Every query from Nigeria currently crosses the Atlantic (us-east-2). |

### Redeploying

- **Backend:**
  ```
  cd backend
  CLOUDFLARE_ACCOUNT_ID=8c5ab6140b2fdce073ce553d0ba6805f FRONTEND_ORIGIN=https://paidar.detruesamuel.workers.dev bash scripts/deploy-staging.sh theibukunjames
  ```
  It's safe to re-run. It needs the git-ignored `backend/.env.staging`, `.env` and `.dev.vars` on this machine.
- **Frontend:** push to `main`, and Samuel's Cloudflare Git build deploys it. To deploy by hand: `CLOUDFLARE_ACCOUNT_ID=fccd1cb5e20fd50137934e271aee9af6 npm run build && npx wrangler deploy` from the root copy (from `frontend/` once step 2 is done).
- **Secrets** stay across deploys:
  - Backend: `KORA_SECRET_KEY`, `CLERK_SECRET_KEY`, `ADMIN_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `PROXY_SECRET`
  - Frontend Worker `paidar`: `PROXY_SECRET`, which must match the backend's

---

## 3. Changes pushed to GitHub (`main`)

### `4c7c7d1`: Paidar backend, contract 1.1.0
- **Paidar spec items BE-01 to BE-18 and BE-20:**
  - short payment message in English and Pidgin, plus a payment-details block
  - nudge and start messages, due reminders, the "details copied" marker
  - the customer's "I've paid" button, provider recheck, and background Kora reconciliation every 2 minutes
  - `Idempotency-Key` support, so a double tap never creates two accounts
  - account export, account deletion, and sign-out everywhere
  - rebuilt customer payment page
  - health alerts, rate limits, security headers, support lookup
- Migration `20261111162007_v1_1_paidar` (with `down.sql`), `contract.md` 1.1.0, `backend/OPERATIONS.md`, an end-to-end test suite in CI.

### `2eead4e`: Clerk sign-in, sign-out, fixes, frontend connected
- **Backend:**
  - Optional Clerk sign-in (`@clerk/hono`), with `Provider.clerkUserId` (migration `20261117090000_clerk_user`).
  - Fix: a new job's unsent request is included in `openRequest`, so "Create and get payment details" creates the account. Contract **1.1.1**.
- **Frontend:**
  - Connected to the real backend in dev (`vite.config.ts` loads `.env`, and proxies `/api` and the payment page's calls).
  - `dueReminders` naming.
  - Clerk sign-in card styled to the app.
  - Account menu with Sign out (phone and laptop), sign-out on onboarding, and every sign-out lands on the sign-in page.
- `differences.md`: frontend vs backend review.

### `18a067e`: deployment preparation
Frontend forwarding Worker, Neon link (`neon.ts`), `.gitignore` for env files, `scripts/deploy-staging.sh`, `DEPLOY.md`, this file.

### This push: live deployment
| File | Change |
|---|---|
| `backend/src/config.ts`, `backend/src/http/app.ts` | `PROXY_SECRET`: trust `x-paidar-client-ip` only with the shared secret. Tested in `test/integration/proxy-ip.test.ts` (205/205 backend tests pass). |
| `backend/wrangler.jsonc` | Staging: backend address on `theibukunjames.workers.dev`, frontend origin `paidar.detruesamuel.workers.dev`, Hyperdrive id, Clerk publishable key |
| `backend/scripts/deploy-staging.sh` | `FRONTEND_ORIGIN` override for a frontend on another account; generates and uploads `PROXY_SECRET` |
| `frontend/worker/index.js`, `worker/index.js` | Forward over HTTPS to `BACKEND_ORIGIN` (cross-account), with the visitor's IP and proxy secret. A service binding is still used if present. |
| `frontend/wrangler.jsonc`, `wrangler.jsonc` | `BACKEND_ORIGIN=https://kobo-exact-staging.theibukunjames.workers.dev`; Worker runs only for `/api/*` and `/p/*` |
| `frontend/.env.production`, `.env.production` | `VITE_MOCK=false`, plus the Clerk publishable key (public by design) |

**Local only, never committed** (git ignores them):

| File | Contents |
|---|---|
| `backend/.env` | Local database URL and Kora sandbox key |
| `backend/.dev.vars` | Clerk keys for local dev |
| `backend/.env.staging` | Neon `DATABASE_URL` and `DATABASE_URL_UNPOOLED`, plus `ADMIN_SECRET`, `TELEGRAM_WEBHOOK_SECRET` and `PROXY_SECRET` |
| `frontend/.env.local` | Local dev settings |

---

## 4. Before a real (production) launch

- **Live Kora** is blocked on decisions D1 to D3: merchant model, account behaviour, fees. Then a ₦100 real-money test. See OPERATIONS.md §7.
- **Clerk production instance** (`pk_live_` / `sk_live_`) needs **your own domain**. Clerk development keys have usage limits.
- **Backups, restore test, rollback rehearsal, alert rules, security review:** see OPERATIONS.md §3 to §5 and §8.
- **Production environment:** fill in `env.production` in `backend/wrangler.jsonc` the same way, with its own Neon branch, Hyperdrive, Queues and secrets.
- **Developer sign-in** is allowed on staging (`DEV_LOGIN_ENABLED=true`, backend only; the live frontend doesn't show it). It's refused automatically in production.

---

## 5. Known gaps (not blockers)

| Gap | Note |
|---|---|
| Onboarding is remembered per browser | The backend already has `onboardedAt`; the frontend should use it. |
| No "Connect Telegram" prompt after Clerk sign-up | And no bot yet (step 4). |
| Faint buttons on a fully-paid job page | Seen in the live test screenshot: the "Next payment" area and the timeline. Styling check needed. |
| Account number not on the job's ticket | Shown again through "Copy details again". |
| Frontend contract says 1.0.0 | The backend is 1.1.1. The newer features aren't used by the frontend yet (see `differences.md`). |
| Telegram and Clerk sign-in both exist | Remove Telegram link sign-in once Clerk is confirmed, if not wanted. |
