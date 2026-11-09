<<<<<<< HEAD
# Paidar web: Phases 1–5 (complete)

React + TypeScript (strict) + Vite. Built against **Backend ↔ Frontend Contract v1.0.0**.
Everything runs on a built-in mock API too, so you can open it without the backend.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # money helpers
npm run typecheck
```

In development with no `.env`, the app uses the mock API. In a **production build the mock is off**, so a deploy can't silently fall back to demo data.

To use the real backend in development, the simplest setup is the built-in proxy (one origin, so no CORS and no cookie trouble):

```bash
cp .env.example .env
# in .env:  VITE_MOCK=false   VITE_DEV_PROXY=http://127.0.0.1:8790
# backend:  FRONTEND_ORIGIN=http://localhost:5173
npm run dev
```

Other setups (direct API calls, production) are in `LAUNCH_CHECKLIST.md`.

## Phase 1 smoke test (about 3 minutes)

1. Open `/auth`. Enter a business name, tap **Continue with demo**.
2. Onboarding, 3 steps: name, "ready to start" rule, Telegram plus evening summary. Tap **Connect** (the mock marks Telegram linked after ~5 seconds).
3. Land on **Today**: empty state plus an example ticket with the radar countdown.
4. Tap each tab (Today, Jobs, People, Search). **New request** is visible on every screen except itself.
5. **Settings** (avatar, top right): change the name, the rule, the summary time. **Save changes** enables only when something changed.
6. Dev-only: Settings → "Open the design kit" (`/kit`) shows every component.
7. `/auth?t=demo` signs in through the token path. `/auth?t=anything-else` shows the "expired or used" state.
8. Sign out returns to `/auth`.

## Phase 2 smoke test (about 5 minutes)

1. **New request** → type `Tolu 0803 123 4567 bridal makeup 50k, 25k deposit, balance friday`. The fields below fill in. Edit any one and it stops following your text.
2. Tap **Create and get payment details**. You land on the job page and the share sheet opens with the exact message, a countdown ring, and WhatsApp / Telegram / Copy.
3. **Today** now shows the request under *Waiting for payment*, with the radar countdown. It refreshes every 15 s.
4. Tap **Simulate payment** (demo only). A dark ping drops from the top: "Tolu paid ₦25,000 · Ready to start". The row moves to *Just paid* with the dotted "Simulated" trust line.
5. On the job page, **Request balance** → share sheet → simulate again. The job turns Fully paid.
6. Also try: **Remind me later** (wording is a reminder, not a scheduled send), **Cancel**, and **Send receipt** on a payment.
7. In mock mode, **Expire now (demo)** on a waiting request makes it expire. It moves to *Expired, send again*; **Send again** creates a new request with a new account and opens the share sheet.

## Phase 3 smoke test (about 6 minutes)

1. **People** → **Add customer** (name + phone) → you land on their page. Try adding the same number again: you get "already saved" with a **View** button.
2. **People → Import a list** → **Use an example** → **Import**. Run it again: the people are skipped. Paste a bad phone number to see the line-by-line fix list.
3. On a customer page, **New request** opens `/new` with the customer already chosen (no name/phone fields).
4. Open a job. **Edit** (service, notes, ready rule, balance due date), then **Record a payment** (cash). It appears in the **Timeline** with a dashed "Not verified" dot, and the job shows "Includes payments you entered by hand". It never turns the job "Ready to start".
5. Simulate a payment on the open request: that timeline dot is dotted (simulated); verified payments (real backend) are solid.
6. **Jobs**: filter chips (All, Not started, Part-paid, Fully paid, Cancelled) and **Show more**.
7. **Cancel job** (bottom of the job page): open requests are cancelled, payments stay.

## Phase 4 smoke test (about 6 minutes)

1. Create two jobs (e.g. `Tolu 0803 123 4567 makeup 50k, 25k deposit` and `Ada 0809 999 8888 fitting 15k`), send both, simulate one payment.
2. **Search**: type `tolu`, then `0803`, then `25k`. The "Looking for" chips show what Paidar understood. Try the saved views and the status chips (you can pick several), and the Dates section. Refresh the page: the same search is still there (it's in the address bar).
3. A result with money still owed has one button (Share details again / Send now / Request balance). Tap it: the share sheet opens.
4. **Needs review** (mock only, to see the flow): on a waiting request tap **Wrong amount (demo)**. Today shows a "Needs review" row. Tap **Resolve**, choose what you did, add a note, **Mark as dealt with**. It moves to *Resolved* on `/review`.
5. For the "paid after expiry" case: tap **Expire now (demo)**, then **Send again** (new request, new account), then **Late payment (demo)** on the expired row. Resolve it with "Accept the late payment": the checkbox also cancels the open replacement.
6. **Search → Export CSV** → pick dates → **Download CSV**. Open it in a spreadsheet: one row per payment.

## Phase 5 smoke test (about 8 minutes)

1. **Wide screen** (browser at least 960 px): a left rail replaces the bottom tabs. **Jobs** and **People** show the list on the left and the open item on the right. Narrow the window: back to one screen at a time with a Back link.
2. **Theme**: Settings → Appearance → Match device / Light / Dark. Refresh: no flash of the wrong theme.
3. **Offline**: DevTools → Network → Offline. A banner says you're offline, Today keeps the last data (with "updated 4m ago"), and any action shows "No connection". Go back online: "Back online. Refreshing…".
4. **Session ended** (mock mode): DevTools → Application → Local Storage → open `paidar.mock.v2` → change `"signedIn":true` to `false`, then tap any tab. You land on sign-in with "Your session ended", and after signing in you return to the screen you were on.
5. **Install / offline shell** (needs a production build): `VITE_MOCK=true npm run build && npm run preview`, open http://localhost:4173. DevTools → Application shows the manifest and the service worker. Install it, go offline, reload: the app still opens. (The red "Not safe for real use" banner is expected here, because this build has demo mode on. A real build never shows it.)
6. **Keyboard**: press Tab once on any screen: "Skip to content" appears. Open a dialog: focus stays inside; Escape closes it and focus returns to the button you used.
7. **Reduced motion**: turn on "Reduce motion" in your OS: the radar sweep and the paid ping stop animating.
8. **Safety**: a plain `npm run build` (no env) must show **no** dev login and **no** simulate buttons.

Then work through `LAUNCH_CHECKLIST.md` before real customers use it.

## What's here

```
src/contract/   Zod schemas = types for the whole contract
src/api/        client (cookie, CSRF header, error mapping), endpoints, mock server
src/auth/       session provider and route guards
src/lib/        money (BigInt), Lagos time, labels, onboarding flag, hooks
src/ui/         primitives, TicketCard, CountdownRing, TrustBadge, Money, Logo
src/shell/      app frame: header, four tabs, New request button
src/pages/      auth, onboarding, today, sections, settings, kit
src/styles/     tokens, base, ui, pages (plain CSS, `pd-` prefix)
```

## Things to know

- **Wire format keeps the old name.** The contract requires `X-Requested-With: kobo-exact` and the cookie is `ke_session`. Don't rename these on the frontend alone.
- **Onboarding is remembered per device** (the contract has no `onboardedAt`). A new device shows onboarding once.
- **Cookies and CORS.** The backend allows one frontend origin with credentials. Host the frontend and API under the same parent domain (or proxy `/api`) so browsers keep the cookie.
- **Dev builds throw** when a response doesn't match the schema (`CONTRACT_MISMATCH`); production builds warn and continue.
- Fonts load from Google Fonts: Bricolage Grotesque (headings, amounts) and Figtree (body). Check amounts align in your browser; if not, tell me and I'll switch the amount font.
- Styling is plain CSS files, not CSS Modules, to keep Phase 1 simple. Sheets and dialogs use the browser's native `<dialog>` (focus trap and Escape for free), so Radix isn't needed.

## Done

All five phases are built. Next steps are in `LAUNCH_CHECKLIST.md`.
=======
# Kobo-Exact

Payment coordination for chat-based service providers. **Agree in chat. Pay exact. Know instantly. Get on with the work.**

Each payment request gets its own single-use Kora bank account. The provider shares the details in WhatsApp or Telegram, Kora confirms the payment, and the provider sees every customer, job, balance and payment on one screen.

| Path | What it is |
| --- | --- |
| [`Kobo-Exact_Project_Description (1).md`](./Kobo-Exact_Project_Description%20(1).md) | Product description |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System design |
| [`EXECUTION_PLAN.md`](./EXECUTION_PLAN.md) | Build plan and milestones |
| [`contract.md`](./contract.md) | Backend ↔ frontend API contract |
| [`backend/`](./backend) | Cloudflare Worker (Hono, Prisma, Postgres via Hyperdrive, Queues, Cron). See its [README](./backend/README.md). |
| [`frontend/`](./frontend) | Provider web app (not started) |

Quick start for the backend: see [`backend/README.md`](./backend/README.md#quick-start-local-no-kora-or-telegram-account-needed).
>>>>>>> 7e45b97980988f1b041f8e4fac00e05f992b6d49
