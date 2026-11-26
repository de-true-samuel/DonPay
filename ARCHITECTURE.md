# Paidar — System Architecture

Companion to the Paidar Product Scope & Execution Blueprint. This document describes how the five Paidar modules map onto the live codebase in `src/`, `worker/`, and `backend/`.

---

## 1. High-Level Topology

Paidar runs as two cooperating Cloudflare Workers over HTTPS with same-origin browser routing:

```
Browser (Owner Workspace & Public Client Pay/Receipt Pages)
  │
  ├──► Paidar Edge Worker (`wrangler.jsonc`, `worker/index.js`)
  │      ├─ Static SPA assets (`./dist`, Obsidian Signal UI)
  │      └─ Proxies `/api/*`, `/p/:token/status`, `/p/:token/claim-paid`
  │            (via HTTPS to BACKEND_ORIGIN, forwarding real client IP)
  │
  ▼
Backend Worker (`backend/`, Hono + TypeScript)
  ├─ fetch()      Provider REST API (`/api/*`), Kora & Telegram webhooks, `/p/:token`
  ├─ queue()      Async consumer: Kora verification, reconciliation rechecks, notifications
  ├─ scheduled()  Per-minute cron: expiring windows, overdue/due-soon reminders, outbox recovery
  │
  ├──► PostgreSQL (Neon via Cloudflare Hyperdrive, Prisma ORM)
  └──► External Rails: Kora Virtual Accounts API · Telegram Bot API (optional alert channel)
```

- **Same-origin security:** All browser requests go through the `paidar` frontend Worker, avoiding cross-origin credential friction while protecting Kora secret keys strictly on the backend Worker.

---

## 2. Five Functional Modules in Code

| Blueprint Module | Frontend (`src/`) | Backend (`backend/src/`) |
| :--- | :--- | :--- |
| **A. Client & Job Management** | `pages/JobsPage.tsx`, `pages/JobPage.tsx`, `pages/EditJobPage.tsx`, `pages/PeoplePage.tsx`, `pages/CustomerPage.tsx`, `pages/NewRequestPage.tsx` | `services/customers.ts`, `services/jobs.ts`, `domain/job.ts` |
| **B. Payment Verification & Reconciliation** | `pages/PaymentsPage.tsx`, `pages/PublicPayPage.tsx`, `pages/PublicReceiptPage.tsx`, `features/requests/`, `features/review/ResolveDialog.tsx` | `services/requests.ts`, `services/payments.ts`, `services/webhooks.ts`, `services/reconcile.ts`, `services/public.ts`, `integrations/kora/` |
| **C. Prioritization & Scheduling Engine** | `pages/QueuePage.tsx`, `pages/SettingsPage.tsx` (Working Hours), `api/mockV2.ts` | `domain/queue.ts` (`computePriorityBreakdown`, `computeQueue`, greedy slot allocator), `services/v2.ts` |
| **D. Notifications** | `pages/NotificationsPage.tsx`, `features/ping/PaidPing.tsx`, `shell/AppShell.tsx` (Bell menu) | `services/notifications.ts`, `services/background.ts`, `queue/consumer.ts` |
| **E. Business Dashboard** | `pages/TodayPage.tsx`, `pages/SearchPage.tsx` (CSV export), `shell/MasterDetail.tsx` | `services/today.ts`, `services/search.ts`, `services/export.ts` |

---

## 3. Core Architectural Invariants

1. **Separated Payment vs. Work State Machines**
   - A `Job` separates **financial eligibility** (`PaymentRequest`: `not_requested`, `awaiting_payment`, `paid`, `under_review`, `cancelled`, `refunded`) from **work execution** (`JobWorkStatus`: `awaiting_payment`, `ready`, `in_progress`, `completed`, `on_hold`, `cancelled`).
   - Verified payments automatically promote eligible jobs to `ready` based on the job's `ReadyRule` (`AFTER_DEPOSIT` or `AFTER_FULL`). Owners may override readiness only by recording an explicit written reason (`startedWithoutPayment = true`, logged in `ActivityEvent`).

2. **Authoritative Kora Verification (Zero Screenshot Trust)**
   - Clicking *"I've paid"* on `/pay/:token` only stamps `customerClaimedPaidAt` and enqueues a server-side recheck (`ClaimEvent`).
   - Only signed `/webhooks/kora` events corroborated via Kora transaction verification record a `KORA_VERIFIED` `Payment` row in Postgres.
   - Ambiguous events (mismatched amount, late payment after expiry, paid on cancelled request) create open `ReviewItem` records resolved explicitly in **Payments → Needs attention**.

3. **Rules-Based Priority Scoring + Human-Approved Scheduling**
   - `backend/src/domain/queue.ts` computes normalized 0–100 sub-scores:
     $$\text{Priority} = 0.35D + 0.25P + 0.15C + 0.15E + 0.10R$$
   - Active jobs (`in_progress`, `ready`) are allocated greedily into open `Africa/Lagos` working-hours windows (`Provider.workingHoursJson` / settings).
   - If a job cannot fit before its deadline, Paidar flags `recommendedSlot.hasConflict = true` instead of inventing impossible capacity. Owners approve suggested schedules explicitly via `POST /api/jobs/:id/approve-schedule`.

4. **Pure Domain Isolation & Whole-Kobo Money**
   - `backend/src/domain/` contains zero database or network I/O and is unit-tested independently (`vitest run test/unit`).
   - All money math uses whole kobo `bigint` / `KoboString` (₦1 = 100 kobo).

---

## 4. Database Schema Highlights (`backend/prisma/schema.prisma`)

- **`Provider`**: business profile, working hours JSON, default payment terms/deposit/fee bearer, digest preferences, optional Telegram/Clerk linkage.
- **`Customer` & `Job`**: client contact records, job price/terms/due date/estimated hours, separate `workStatus` and financial rules.
- **`PaymentRequest` & `ChargeAttempt`**: durable payment expectation paired with ephemeral single-use Kora virtual account attempts.
- **`Payment` & `ReviewItem`**: immutable verified/manual payment ledger + exception resolution queue.
- **`ActivityEvent`, `Notification`, `WebhookEvent`, `IdempotencyKey`**: full financial audit trail, read-tracked alerts, deduplicated webhooks, and 24-hour API idempotency.
