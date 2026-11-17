# Paidar: changes made and deployment status

Last updated 2026-11-18. This file summarises what has changed and what's left to connect the deployed app to the real backend. The command-by-command runbook is in [DEPLOY.md](DEPLOY.md). Running the backend after launch (alerts, backups, rollback, the live Kora cutover) is covered in [backend/OPERATIONS.md](backend/OPERATIONS.md).

| | Address |
|---|---|
| Frontend (live) | https://paidar.detruesamuel.workers.dev, Cloudflare Worker `paidar` on *Detruesamuel@gmail.com's Account* |
| Backend (to deploy) | https://kobo-exact-staging.detruesamuel.workers.dev, Worker `kobo-exact-staging` on the same account. It returns 404 today because it isn't deployed yet. |
| Database | Neon project `old-art-33870905`, branch `production` (AWS us-east-2) |

---

## 1. Why the live site still uses the demo

1. **The backend Worker isn't deployed.** The frontend is live, but nothing is running at `kobo-exact-staging.detruesamuel.workers.dev`.
2. **The live site is built from the copy at the repo root, not `frontend/`.** Samuel's commit `a767229` (Nov 17) copied the latest frontend code into it: Clerk, the account menu, contract 1.1.1. But the root copy has **no forwarding Worker** (`frontend/worker/`) and **no `.env.production`**. So the built app can't reach a backend, and it falls back to the in-browser demo. Nothing is saved.

---

## 2. The plan for connecting it, step by step

| # | Step | Status |
|---|---|---|
| 1 | **Hosted Postgres:** connection string, Prisma migrations, bound to Hyperdrive | Database **done**: Neon is created, all 4 migrations are applied, and it was tested end to end. Hyperdrive is **blocked** (see section 3). |
| 2 | **Cloudflare Queues** `kobo-exact-staging` and `kobo-exact-staging-dlq` | **Blocked** (see section 3) |
| 3 | **Deploy the backend Worker:** `npx wrangler deploy --env staging` | **Blocked** (see section 3). Config and script ready. |
| 4 | **Point the frontend at the backend** | **Ready, done differently from setting `VITE_API_URL`** (see below). It goes live once the build uses `frontend/`. |

### Why not `VITE_API_URL` (step 4)

Setting `VITE_API_URL=https://kobo-exact-staging.detruesamuel.workers.dev` makes the browser call a **second** address. That means:
- CORS must allow it.
- The sign-in cookie becomes a cross-site cookie (`SameSite=None`), which **Safari and iPhones block**, so developer and Telegram sign-in break for most Nigerian iPhone users.
- It only takes effect if set **at build time**, not as a Worker variable after the build.

**Instead, the frontend Worker forwards the backend's routes** (`frontend/worker/index.js`). It passes `/api/*`, `/p/:token/status` and `/p/:token/claim-paid` to the backend Worker through a **service binding** (`BACKEND` in `frontend/wrangler.jsonc`). The browser only ever sees `paidar.detruesamuel.workers.dev`:
- no CORS
- first-party cookies (`COOKIE_SAMESITE=Lax`)
- Clerk's token reaches the backend unchanged

So **leave `VITE_API_URL` empty.** `frontend/.env.production` already sets `VITE_MOCK=false`, so the deployed app never falls back to the demo.

If you really want separate addresses instead, the settings are: `VITE_API_URL` at build time; on the backend, `FRONTEND_ORIGINS=https://paidar.detruesamuel.workers.dev` and `COOKIE_SAMESITE=None`; and remove the `services` entry from `frontend/wrangler.jsonc`. Clerk sign-in still works that way, because it sends a token rather than a cookie.

---

## 3. What still needs to be done, in order

| # | Who | Step |
|---|---|---|
| 1 | **Samuel** | **Unblock the deploy.** Go to dash.cloudflare.com → *Detruesamuel@gmail.com's Account* → **Manage Account → Members**. Give `theibukunjames@gmail.com` the **Administrator** role for the whole account. Today that login can only manage Worker scripts there; creating Hyperdrive and Queues is refused with "Authentication error". Product-limited roles such as "Workers Admin" are not enough. *Or Samuel runs step 2 himself while logged in as his own user.* |
| 2 | Dev | **Deploy the backend** (plan steps 1 to 3 in one go):<br>`cd backend`<br>`CLOUDFLARE_ACCOUNT_ID=fccd1cb5e20fd50137934e271aee9af6 bash scripts/deploy-staging.sh detruesamuel`<br>The script, in order:<br>1. Creates Hyperdrive to Neon over the **direct** connection string, with caching off.<br>2. Creates both queues.<br>3. Fills the Hyperdrive id and the Clerk publishable key into `wrangler.jsonc`.<br>4. Uploads the secrets (`KORA_SECRET_KEY`, `CLERK_SECRET_KEY`, `ADMIN_SECRET`, `TELEGRAM_WEBHOOK_SECRET`) from local git-ignored files without printing them.<br>5. Runs migrations, deploys, and checks health.<br>**Expect:** `Health: {"ok":true,"db":true,…}`. Then commit the updated `backend/wrangler.jsonc` (the Hyperdrive id isn't a secret). |
| 3 | You | **Kora sandbox dashboard:** set the webhook URL to `https://kobo-exact-staging.detruesamuel.workers.dev/webhooks/kora`. |
| 4 | **Samuel** | **Switch the frontend build to `frontend/`** (plan step 4). Go to Workers & Pages → `paidar` → Settings → **Build**:<br>- **Root directory:** `frontend`<br>- Build command `npm run build`, deploy command `npx wrangler deploy` (both unchanged)<br>- Build **Variables:** add `VITE_CLERK_PUBLISHABLE_KEY=pk_test_…` (the same key as in `frontend/.env.local`). **Don't** add `VITE_API_URL`.<br>Then retry the build. **Do this only after step 2,** because the service binding needs the backend Worker to exist. |
| 5 | Dev | **Remove the old root copy:** `src/`, `public/`, `index.html`, root `package.json` and `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `wrangler.jsonc`. Then push, so only `frontend/` remains. |
| 6 | You | **Check the live site:**<br>1. Open https://paidar.detruesamuel.workers.dev.<br>2. Sign up with Clerk.<br>3. Create a job, then "Create and get payment details". A Kora **sandbox** account appears.<br>4. Within about 2 minutes the sandbox pays it, and the job shows **Paid**.<br>5. Sign out lands on the sign-in page.<br>Also check: `curl https://kobo-exact-staging.detruesamuel.workers.dev/health` |

### Optional but recommended

- **Telegram payment alerts:**
  1. Create the bot with BotFather.
  2. `npx wrangler secret put TELEGRAM_BOT_TOKEN --env staging`.
  3. Set `TELEGRAM_BOT_USERNAME` in `backend/wrangler.jsonc` (staging).
  4. Point the bot's webhook at `https://kobo-exact-staging.detruesamuel.workers.dev/webhooks/telegram` with the `TELEGRAM_WEBHOOK_SECRET` from `backend/.env.staging`.

  Until then, providers get no instant "you've been paid" pings.
- **Automatic backend deploys:** add the GitHub repo secrets `CLOUDFLARE_API_TOKEN` (Workers, Hyperdrive and Queues edit), `CLOUDFLARE_ACCOUNT_ID=fccd1cb5e20fd50137934e271aee9af6`, and `STAGING_DATABASE_URL` (the Neon **direct** string). CI then migrates and deploys staging on every push to `main`.
- **Neon region:** the database is in us-east-2 (Ohio), so every query from Nigeria crosses the Atlantic. Consider a new Neon project in eu-central-1 (Frankfurt) while it's still empty. The region can't be changed later without moving the data.

---

## 4. Changes already pushed to GitHub (`main`)

### `4c7c7d1`: Paidar backend, contract 1.1.0
- **Paidar spec items BE-01 to BE-18 and BE-20:**
  - short payment message in English and Pidgin, plus a payment-details block
  - nudge and start messages, due reminders, the "details copied" marker
  - the customer's "I've paid" button, provider recheck, and background Kora reconciliation every 2 minutes
  - `Idempotency-Key` support, so a double tap never creates two accounts
  - account export, account deletion, and sign-out everywhere
  - rebuilt customer payment page
  - health alerts, rate limits, security headers, support lookup
- Database migration `20261111162007_v1_1_paidar`, with `down.sql` to reverse it.
- `contract.md` 1.1.0, `backend/OPERATIONS.md`.
- An end-to-end test suite against the real Worker with mocked Kora and Telegram, run in CI.

### `2eead4e`: Clerk sign-in, sign-out, fixes, frontend connected
**Backend:**
- **Clerk website sign-in** (`@clerk/hono`):
  - On when `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set.
  - Linked to providers through a new `Provider.clerkUserId` column (migration `20261117090000_clerk_user`).
  - Telegram and developer sign-in still work.
  - Deleting an account also deletes the Clerk user.
- **Fix:** a new job's unsent request is now included in `openRequest`. Before this, "Create and get payment details" never created a bank account, and asking for a balance was refused with 409. Contract bumped to **1.1.1**.

**Frontend:**
- **Points at the real backend:**
  - `vite.config.ts` reads `VITE_DEV_PROXY` from `.env` files again.
  - It forwards `/api` and the payment page's status and "I've paid" calls.
  - The demo-data fallback now only applies when no backend is configured.
- **`remindersDue` renamed to `dueReminders`,** to match the backend.
- **Clerk sign-in card** styled to the app's design.
- **Account menu on the avatar** (Settings, Sign out), now also visible on laptop screens. Sign-out is also on the onboarding screen.
- **Every sign-out lands on the sign-in page.**

**Docs:** `differences.md`, a review of the frontend's assumptions against the real backend.

### Deployment preparation (this push)

| File | What it does |
|---|---|
| `frontend/worker/index.js` (new) | Serves the app and forwards the backend routes over the service binding. |
| `frontend/wrangler.jsonc` | Uses that Worker, binds `BACKEND` to `kobo-exact-staging`, and runs the Worker only for `/api/*` and `/p/*`. |
| `frontend/.env.production` (new) | The deployed build uses the real backend (`VITE_MOCK=false`), never the demo. |
| `backend/wrangler.jsonc` | Staging: real addresses (`kobo-exact-staging.detruesamuel.workers.dev`, `paidar.detruesamuel.workers.dev`), `COOKIE_SAMESITE=Lax`, Telegram bot name empty until the bot exists. |
| `backend/neon.ts`, `backend/package.json` | Neon project config from `neon init` (`@neon/config`, `@neon/env`). |
| `backend/.gitignore` | Ignores `.env.*` and `.dev.vars.*` (except the examples) and `.neon`. |
| `backend/scripts/deploy-staging.sh` (new) | One-shot, re-runnable staging deploy (section 3, step 2). |
| `DEPLOY.md`, this file | Runbook and status. |

**Local only, never committed** (git ignores them):

| File | Contents |
|---|---|
| `backend/.env` | Local database URL and Kora sandbox key |
| `backend/.dev.vars` | Clerk keys for local dev |
| `backend/.env.staging` | Neon `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct), plus generated `ADMIN_SECRET` and `TELEGRAM_WEBHOOK_SECRET`. **The deploy script needs it, so run step 2 on this machine,** or copy the file securely. |
| `frontend/.env.local` | Local dev settings and the Clerk publishable key |

---

## 5. Before a real (production) launch

- **Live Kora** is blocked on decisions D1 to D3: merchant model, account behaviour, fees. Then a ₦100 real-money test. See OPERATIONS.md §7.
- **Clerk production instance** (`pk_live_` / `sk_live_` keys) needs **your own domain**. workers.dev only works with Clerk development keys, which have usage limits.
- **Backups, restore test, rollback rehearsal, alert rules, security review:** see OPERATIONS.md §3 to §5 and §8.
- **Production environment:** fill in `env.production` in `backend/wrangler.jsonc` the same way as staging, with its own Neon branch, Hyperdrive, Queues and secrets.

---

## 6. Known gaps (not deployment blockers)

| Gap | Note |
|---|---|
| Onboarding is remembered per browser | The same account sees onboarding again on a new device. The backend already has `onboardedAt`; the frontend should use it. |
| No "Connect Telegram" prompt after Clerk sign-up | Providers who sign up with Clerk get no payment alerts until they connect Telegram in Settings. |
| Account number not on the job's ticket | After closing the copy sheet it's shown again through "Copy details again". Can be added to the ticket if wanted. |
| Frontend contract version still says 1.0.0 | The backend is at 1.1.1. The newer features (nudge, start message, export, delete, …) aren't used by the frontend yet. See `differences.md`. |
| Telegram and Clerk sign-in both exist | Remove Telegram link sign-in (`/api/auth/exchange`) once Clerk is confirmed, if it's not wanted. |
