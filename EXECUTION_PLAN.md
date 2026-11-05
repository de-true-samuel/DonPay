# Kobo-Exact: Execution Plan

*How we go from an empty repo to a working demo at the Kora hackathon. Read with `ARCHITECTURE.md`. The plan assumes a team of 2–4 and about 10 working days. If the hackathon is shorter, use the **cut line** in §5.*

---

## 1. Guiding principles

1. **Prove the risky parts first.** Kora single-use accounts and Prisma on Workers with Hyperdrive are the two things that could sink us. Both get tested on days 0–1, before we write any feature.
2. **Build the payment path end to end before the UI.** One real sandbox payment that flips a request to PAID and sends a Telegram alert is worth more than polished screens.
3. **Make it demo-able every day.** From day 3, staging should always show *something* working, and each day adds to it.
4. **Work on vertical slices, not layers.** Each milestone runs from the database to the API to the UI to the alert.
5. **Use the feature test from §14 of the description.** Does it save the provider time, prevent a mistake, or build trust? If not, it waits.

---

## 2. Day 0: things to start *before* writing code

These have lead times we don't control, so send them out immediately.

| # | Action | Owner | Why it's urgent |
| --- | --- | --- | --- |
| 0.1 | Email Kora: ask them to **enable the single-use bank-transfer API** on our sandbox account. Also ask about max expiry, account-name display, the webhook signature details, IP allow-listing, sandbox under/overpayment simulation, and the merchant model for the demo. | Lead | Everything depends on it. Ask for the answers in writing (description §15). |
| 0.2 | Create Kora sandbox account; get test keys | Lead | |
| 0.3 | Create Cloudflare account; check that the plan covers Queues, Hyperdrive and Cron Triggers (upgrade to Workers Paid if needed) | Backend | Plan limits change. Find out now, not mid-build. |
| 0.4 | Create the Neon (or Supabase) project with `main` and `staging` branches; pick the region closest to Nigeria | Backend | |
| 0.5 | Create the Telegram bots (dev and staging) with BotFather | Backend | |
| 0.6 | Talk to 3–5 real providers (caterer, tailor, makeup artist…), using the questions in description §15 "Demand" | Product/pitch | Fills in description §3. It is also our strongest pitch material. |
| 0.7 | Set up the GitHub repo, branch protection and a CI skeleton | Backend | |

---

## 3. Team roles

The work splits into three tracks so people aren't blocked on each other:

| Track | Owns | Main milestones |
| --- | --- | --- |
| **A. Payments core** | Kora client, webhook, queue verification, state machine, expiry, outbox | M1, M3, M5 |
| **B. Product API and data** | Schema, jobs/customers/requests API, Today query, search, auth, export | M1, M2, M4, M6 |
| **C. Web and chat** | SPA screens, payment page, Telegram bot messages, demo script and pitch | M2 (UI), M4, M6, M7 |

With only two people, merge B and C. Track A stays one person's focus: that is where correctness matters most.

**Shared contract:** Zod schemas in `src/shared/` are written **first** for each slice. Track C builds against them, using mocked responses, while Track B implements them.

---

## 4. Milestones

Each milestone ends with a **demo-able outcome** and a **definition of done**. Day numbers are targets, not promises.

### M0: Foundation spike (Day 1). *Go/no-go on the stack.*

**Goal:** a deployed Worker that reads and writes Postgres through Prisma and Hyperdrive, with a queue and a cron that both fire.

- [ ] `npm create hono` with the Cloudflare Workers template; TypeScript strict; ESLint + Prettier
- [ ] `wrangler.jsonc`: Hyperdrive binding (**caching disabled**), queue producer/consumer + DLQ, cron `* * * * *`, static assets dir, `nodejs_compat`
- [ ] Prisma + `@prisma/adapter-pg`; a one-table schema; `prisma migrate deploy` from a laptop
- [ ] `GET /health` writes and reads a row; queue handler logs; cron handler logs
- [ ] `wrangler deploy --env staging` succeeds; **record the bundle size**
- [ ] Vitest + `@cloudflare/vitest-pool-workers` running one trivial test in CI

**Done when:** staging `/health` returns a DB timestamp, and the logs show a queue message and a cron tick.
**If it fails:** time-box Prisma-on-Workers problems to **half a day**. After that, raise it with the team. Moving the ORM is a bigger decision than this plan should make alone.

### M1: Domain core and schema (Days 1–2)

**Goal:** the full data model and the pure logic everything else relies on.

- [ ] Full Prisma schema from ARCHITECTURE §4.2, plus a hand-written SQL migration (partial unique index, CHECKs, `pg_trgm`)
- [ ] `domain/money.ts`: kobo/naira parsing and formatting, with exhaustive unit tests
- [ ] `domain/job.ts`: paid, balance, status, readyToStart, with unit tests for every rule combination
- [ ] `domain/request-state.ts`: allowed transitions (including `EXPIRED → PAID`), tested
- [ ] `domain/messages.ts`: prepared customer message, paid alert, receipt, digest text
- [ ] `integrations/kora/`: typed client (create account, query transaction) and Zod response schemas; **the signature check is written once Kora confirms the header**
- [ ] Seed script: one provider, five customers, a mix of jobs

**Done when:** `npm test` covers the domain at ~100% line coverage, and the seed loads on staging.

### M2: Jobs, requests and the "send" flow (Days 2–4)

**Goal:** a provider can create a job and get a real Kora account number in a message ready to share.

- [ ] Auth, simplest version first: a dev-only login route behind an env flag, so UI work isn't blocked (Telegram magic link arrives in M4)
- [ ] `POST /api/customers`, `POST /api/jobs` (creates the first request in DRAFT based on the plan)
- [ ] `POST /api/requests/:id/send`: the reference is generated before the Kora call, duplicate-reference recovery, SENT transition (ARCHITECTURE §6.1)
- [ ] `GET /p/:token` customer payment page: business name, amount, bank, account number, copy buttons, countdown, status polling
- [ ] SPA: create-job form (customer, phone, service, total, plan, deposit, ready rule) and a "Share" sheet with WhatsApp / Telegram / Copy
- [ ] Integration tests: send is idempotent; the second open request on a job is rejected

**Done when:** on staging, we create a job, tap Send, open the WhatsApp share link, and the payment page shows a **real Kora sandbox account** with a countdown.

### M3: Payment confirmation pipeline (Days 3–5). *The heart of the product.*

**Goal:** a sandbox payment turns into a verified Payment and a Telegram alert, with no duplicates.

- [ ] `POST /webhooks/kora`: signature, `WebhookEvent` with unique `eventKey`, enqueue, fast `200`
- [ ] Queue `kora.verify`: Kora query, then the single transaction from ARCHITECTURE §6.2 (Payment + PAID + ReviewItems + Notification outbox rows)
- [ ] Queue `notify.send` and the Telegram sender; DLQ consumer writes `VERIFICATION_FAILED`
- [ ] The payment page flips to **receipt** when PAID
- [ ] Integration tests (Kora mocked): bad signature, duplicate webhook, two concurrent `kora.verify` messages, unknown reference → review, amount mismatch → review, overpaid job → review
- [ ] Sandbox E2E script: send → wait for auto-complete (~2 min) → assert PAID and the alert was sent
- [ ] Local webhook testing through a `cloudflared` tunnel

**Done when:** a real sandbox payment shows *"Paid ✔ ₦25,000 from Tolu for Bridal makeup. Deposit received. Ready to start."* in Telegram within seconds of Kora's webhook, and replaying that webhook changes nothing.

### M4: Telegram login, Today view and balances (Days 5–7)

**Goal:** the screen a provider actually lives in.

- [ ] Telegram bot `/start` and `/login` → magic link → session cookie (ARCHITECTURE §6.7); remove the dev login from staging
- [ ] `GET /api/today`, one SQL query returning the five buckets: Just paid, Waiting, Balances due, Expired (send again), Needs review
- [ ] SPA Today view with "Ready to start ✔" badges and live countdowns
- [ ] Job page: running totals (paid so far, balance, next due), request timeline, "Create balance request" (exact remainder)
- [ ] "Send again" on expired → new request (never reuses the old account)
- [ ] Needs-review screen with resolve actions (including "cancel the replacement request" for paid-after-expiry)
- [ ] Manual payment entry, clearly labelled "not verified by Kora"; it never counts towards Ready-to-start

**Done when:** the full deposit → balance → fully paid story from description §4 runs on staging from the Today view.

### M5: Cron: expiry, prompts, digest (Days 6–8)

- [ ] Expiry sweep → `request.checkExpiry` (asks Kora before marking EXPIRED; a payment wins the race)
- [ ] Scheduled-send prompts and balance-due prompts as Telegram messages with deep-link buttons
- [ ] Daily digest at the provider's chosen Lagos time (sent once per day, guaranteed)
- [ ] Outbox recovery sweep for unsent notifications
- [ ] Integration tests: expiry vs late payment; digest sends once even across two cron ticks

**Done when:** an unpaid sandbox request expires on its own and appears under "Expired, send again", and the digest arrives at the configured minute.

### M6: Search, customer pages, history, export (Days 7–9)

- [ ] `GET /api/search`: token parsing for phone, amount, date and text; filter chips; saved views ("Unpaid balances", "This week", "Needs follow-up")
- [ ] Customer page: every job and payment on one timeline
- [ ] Row quick actions: resend, balance request, share receipt
- [ ] CSV export; CSV customer import (dedupe by phone)
- [ ] Tenant-isolation tests across every list and search endpoint

**Done when:** typing "tolu", "25k" or "0803…" each finds the right job in under a second on seeded data.

### M7: Hardening, demo and pitch (Days 9–10)

- [ ] Sentry wired up; structured payment log lines checked in Workers Logs
- [ ] `/api/admin/health` (DLQ depth, stuck webhooks, unsent notifications, open reviews)
- [ ] Demo seed: a believable provider ("Tolu's Glam Studio") with a week of history
- [ ] **Demo script rehearsed at least three times on staging**, timed, with a fallback recording in case the venue Wi-Fi fails
- [ ] Pitch slides: the problem (with interview quotes from 0.6), the live demo, honest limits (description §8), which merchant model the demo uses, what's next
- [ ] Mobile pass on the payment page and Today view (providers live on phones)
- [ ] README: setup, environments, the pinned Prisma version, the data region

---

## 5. Cut line: what goes if time runs short

Cut from the **bottom up**. Everything above the line is the minimum demo.

| Priority | Feature | Milestone |
| --- | --- | --- |
| **Must** | Create job → send → real Kora account → payment page | M2 |
| **Must** | Webhook → verify → PAID → Telegram alert, idempotent | M3 |
| **Must** | Deposit + balance with derived totals and the Ready-to-start badge | M4 |
| **Must** | Today view (at least Just paid / Waiting / Balances due) | M4 |
| **Must** | Expiry → "Send again" | M5 |
| ─ ─ ─ | **cut line for a 48-hour build** | ─ ─ ─ |
| Should | Telegram magic-link login (fallback: dev login on the demo account) | M4 |
| Should | Needs-review screen | M4 |
| Should | Search + filter chips | M6 |
| Should | Daily digest | M5 |
| Could | Customer page timeline, saved views | M6 |
| Could | Balance-due and scheduled prompts | M5 |
| Could | CSV import/export, manual entries | M4/M6 |
| Later | Everything in description §14 "Strong additions" and "Later" | — |

---

## 6. Day-by-day overview (about 10 days)

```
Day   0    1    2    3    4    5    6    7    8    9    10
      │Kora│    │    │    │    │    │    │    │    │    │
A     prep M0───M1───────M3─────────────M5───────M7───────
B     prep M0───M1──M2───────────M4─────────M6───────M7───
C     interviews ─── M2 UI ──────M4 UI──────M6 UI──demo/pitch
                         ▲              ▲              ▲
                    first real     full deposit     feature
                    account on     → balance        freeze
                    staging (D4)   story (D7)       (end D9)
```

**Feature freeze at the end of Day 9.** Day 10 is only for bug fixes, rehearsal and the pitch.

---

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Kora doesn't enable single-use accounts in time | Medium | **Critical** | Ask on Day 0 and follow up daily. Build against the mocked client meanwhile. The fallback is Kora's standard bank-transfer charge for the demo, labelled as such. |
| Prisma on Workers/Hyperdrive bundle or compatibility trouble | Medium | High | M0 spike on Day 1; pin a known-good version; half-day time box, then escalate |
| Kora requires IP allow-listing | Low | High | Ask on Day 0. Fallback: a tiny static-IP proxy for Kora calls only. |
| Webhook signature format unclear | Medium | Medium | Isolated in one file. Test with a real sandbox webhook as soon as M2 works. |
| Sandbox can't simulate under/overpayment | High | Low | Cover with mocked integration tests; say so openly in the demo |
| Double alerts or double payments from retries | Medium | High | Three-layer idempotency (ARCHITECTURE §6.2), covered by concurrency tests in M3 |
| Hyperdrive caching returns a stale status | Medium | Medium | Caching disabled on the config (M0 checklist) |
| Venue Wi-Fi fails during the demo | Medium | High | Pre-recorded fallback video plus phone hotspot |
| Scope creep (voice notes, team roles…) | High | Medium | Cut line in §5. Anything new goes to a "post-hackathon" list, not the board. |
| Judges ask "who is the merchant?" | High | Medium | A slide that answers it: the demo uses one platform sandbox account; production options and Kora's approval needs are listed |

---

## 8. Definition of done (any task)

- Typed end to end; no `any` on money or status fields
- Money handled as `bigint` kobo; any new Kora/naira conversion goes through `money.ts`
- Every DB query in a provider route is scoped by `providerId`
- Tests added for new domain logic and any payment-path change
- CI green, deployed to staging, checked there by hand
- Payment-path changes reviewed by a second person (Track A pairs with B on M3)

---

## 9. Demo script (target: 4 minutes)

1. **The problem (30 s).** A real interview quote, and a screenshot of a messy WhatsApp payment thread.
2. **Create the job (30 s).** "Tolu, Bridal makeup, ₦50,000, deposit ₦25,000, ready after deposit."
3. **Send (30 s).** Tap Send → share sheet → WhatsApp message with the exact account and amount. Open the payment page on a second phone and show the copy buttons and countdown.
4. **Pay (60 s).** Trigger the sandbox payment. The Telegram alert pops up on the provider's phone, the payment page turns into a receipt, and the Today view shows **Ready to start ✔**.
5. **The fake screenshot (20 s).** Show an edited "transfer successful" screenshot: nothing changes in the app.
6. **Balance (30 s).** Job shows "Balance ₦25,000 due Friday". One tap creates the exact balance request.
7. **Expiry (20 s).** A pre-seeded expired request → "Send again" → a new account.
8. **Search (20 s).** Type "25k" or "tolu" and it's found instantly.
9. **Close (20 s).** Honest limits, the merchant model, and the pitch line: *Agree in chat. Pay exact. Know instantly. Get on with the work.*

Pre-seed everything you can. Only steps 2–4 need live sandbox calls. Start a sandbox payment about 2 minutes before step 4 as a backup, in case the manual trigger is slow.

---

## 10. After the hackathon

1. Production Kora merchant model, agreed in writing with Kora
2. Live keys, a production database and an NDPA compliance review
3. The "Strong additions" from description §14, in this order: balance reminders, chat shortcuts (`/request …`), slot holds, customer trust page, team roles
4. Pilot with the interviewed providers; measure the time saved per day
