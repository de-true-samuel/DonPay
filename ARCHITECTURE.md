# Kobo-Exact: Architecture

*Companion to `Kobo-Exact_Project_Description (1).md` (v2). That document says **what** the product does. This one says **how it is built**. Items marked **⚠ Confirm** depend on facts from Kora or a vendor that we have not verified yet. See §14.*

---

## 1. Architecture at a glance

The whole backend is **one Cloudflare Worker** with three entry points: HTTP requests, queue messages and the cron schedule. It sits in front of one Postgres database. Kora and Telegram are the only external systems.

```
                ┌──────────────────────────────────────────────────────────────┐
                │                 Cloudflare Worker  (Hono, TypeScript)        │
                │                                                              │
 Provider ──────┤  fetch()   /api/*            provider API (session cookie)   │
 (web app)      │            /  (static)       provider SPA (Workers Assets)   │
                │            /p/:token         customer payment / receipt page │
 Customer ──────┤            /webhooks/kora    Kora webhook  ──┐               │
 (browser)      │            /webhooks/telegram grammY bot     │ enqueue       │
                │                                              ▼               │
 Kora ──────────┤  queue()   consumer: verify payment, send alerts, digests    │
 (webhooks)     │                 ▲  retries + dead-letter queue               │
                │  scheduled() ───┘  per-minute sweep: expiries, prompts,      │
 Telegram ──────┤                    digests, outbox recovery                  │
                └───────────────┬──────────────────────────────┬───────────────┘
                                │ Hyperdrive (pooled TCP)       │ HTTPS
                                ▼                               ▼
                     PostgreSQL (Neon / Supabase)       Kora API  ·  Telegram Bot API
```

**Why one Worker?** It is one deploy and one set of bindings, and code and types are shared. HTTP, queue and cron handlers are just different exports of the same module. We can split later if one part needs to scale separately. At hackathon scale it won't.

---

## 2. Components

| Component | Responsibility | Notes |
| --- | --- | --- |
| **Hono HTTP app** | Provider API, public payment page, webhook receivers | Zod validation on every body. Routes are thin and call the domain services. |
| **Provider web app** | Today view, jobs, customers, search, history | React + Vite SPA served from the same Worker via **Workers Static Assets**. Same origin, so cookie auth needs no CORS setup. |
| **Customer payment page** | Bank details, copy buttons, countdown, then receipt | Rendered on the server with Hono JSX: tiny, fast on poor connections, no JS bundle needed. It polls a status endpoint every few seconds. |
| **Queue consumer** | Payment verification, notifications, digests | Runs off the request path. Retried automatically, with a dead-letter queue after max retries. |
| **Cron handler** | Per-minute sweep | Finds due work and **enqueues** it rather than doing heavy work inline. |
| **Telegram bot (grammY)** | Login links, "paid" alerts, digest, later chat shortcuts | Webhook mode. Checks the `X-Telegram-Bot-Api-Secret-Token` header. |
| **Postgres** | Source of truth | Reached through Hyperdrive. Prisma with the `pg` driver adapter. |
| **Kora** | Single-use accounts, webhooks, transaction query | The money rails. We never hold funds. |

---

## 3. Code layout

```
kobo-exact/
├─ prisma/
│  ├─ schema.prisma
│  └─ migrations/              # includes hand-written SQL for partial indexes / pg_trgm
├─ src/
│  ├─ index.ts                 # export default { fetch, queue, scheduled }
│  ├─ env.ts                   # Bindings type: HYPERDRIVE, QUEUE, secrets
│  ├─ http/
│  │  ├─ app.ts                # Hono app, middleware (request id, auth, errors)
│  │  ├─ routes/               # auth, jobs, customers, requests, today, search, export
│  │  ├─ webhooks/kora.ts
│  │  ├─ webhooks/telegram.ts
│  │  └─ pages/pay.tsx         # customer payment + receipt page (Hono JSX)
│  ├─ queue/
│  │  ├─ consumer.ts           # dispatch on message.type
│  │  └─ handlers/             # verifyPayment, sendNotification, buildDigest
│  ├─ cron/sweep.ts
│  ├─ domain/                  # pure business logic — no I/O, heavily unit-tested
│  │  ├─ money.ts              # kobo <-> naira, parsing Kora amounts
│  │  ├─ job.ts                # derived balance, status, ready-to-start
│  │  ├─ request-state.ts      # PaymentRequest state machine
│  │  └─ messages.ts           # prepared chat message / alert / receipt text
│  ├─ services/                # orchestrate domain + db + integrations
│  │  ├─ requests.ts           # create, send (allocate Kora account), cancel, resend
│  │  ├─ payments.ts           # verify + record (the critical transaction)
│  │  └─ review.ts
│  ├─ integrations/
│  │  ├─ kora/                 # client, zod schemas, signature check
│  │  └─ telegram/             # grammY bot, senders
│  ├─ db/client.ts             # per-invocation Prisma factory
│  └─ shared/                  # zod schemas + DTO types shared with the web app
├─ web/                        # React SPA (Vite) → built into ./public for Workers Assets
├─ test/
│  ├─ unit/                    # domain/*
│  └─ integration/             # @cloudflare/vitest-pool-workers + test DB
└─ wrangler.jsonc
```

**Rule:** `domain/` has no imports from Prisma, Hono or `fetch`. All the money and status logic lives there as plain functions, which makes it the easiest code to test and the most important.

---

## 4. Data model

### 4.1 Entities

```
Provider 1───* Customer 1───* Job 1───* PaymentRequest 1───0..1 Payment
    │                                         │
    ├──* Session                              └── koraReference (unique)
    ├──* ReviewItem ──> (WebhookEvent | PaymentRequest | Payment)
    └──* Notification (outbox)

WebhookEvent  (raw Kora events; unique eventKey)
```

### 4.2 Prisma schema (sketch)

```prisma
enum PaymentPlan     { FULL  DEPOSIT_BALANCE }
enum ReadyRule       { AFTER_DEPOSIT  AFTER_FULL }
enum RequestKind     { FULL  DEPOSIT  BALANCE  CUSTOM }
enum RequestStatus   { DRAFT  SCHEDULED  SENT  PAID  EXPIRED  CANCELLED }
enum PaymentSource   { KORA_VERIFIED  MANUAL }
enum ReviewKind      { UNMATCHED_REFERENCE  PAID_AFTER_EXPIRY  JOB_OVERPAID
                       AMOUNT_MISMATCH  PAYER_NAME_DIFFERS  VERIFICATION_FAILED }
enum NotificationKind{ PAID_ALERT  RECEIPT_READY  BALANCE_DUE_PROMPT  SCHEDULED_SEND_PROMPT  DIGEST }

model Provider {
  id               String   @id @default(cuid())
  businessName     String
  telegramChatId   BigInt?  @unique
  defaultReadyRule ReadyRule @default(AFTER_DEPOSIT)
  digestMinuteOfDay Int?     // minutes after 00:00 Africa/Lagos; null = off
  lastDigestOn     DateTime? @db.Date
  createdAt        DateTime @default(now())
  customers Customer[]
  jobs      Job[]
}

model Customer {
  id            String   @id @default(cuid())
  providerId    String
  name          String
  phoneE164     String           // normalised +234…
  messageConsent Boolean @default(false)
  createdAt     DateTime @default(now())
  provider Provider @relation(fields: [providerId], references: [id])
  jobs     Job[]
  @@unique([providerId, phoneE164])
}

model Job {
  id            String      @id @default(cuid())
  providerId    String
  customerId    String
  service       String
  totalKobo     BigInt
  plan          PaymentPlan
  depositKobo   BigInt?           // required when plan = DEPOSIT_BALANCE
  balanceDueAt  DateTime?
  readyRule     ReadyRule
  notes         String?
  cancelledAt   DateTime?
  balancePromptedAt DateTime?
  createdAt     DateTime    @default(now())
  requests PaymentRequest[]
  @@index([providerId, createdAt])
}

model PaymentRequest {
  id             String        @id @default(cuid())
  providerId     String                    // denormalised for tenant-scoped queries
  jobId          String
  kind           RequestKind
  amountKobo     BigInt
  status         RequestStatus @default(DRAFT)
  publicToken    String        @unique     // 128-bit random, used in /p/:token
  koraReference  String?       @unique     // ours, generated before calling Kora
  bankName       String?
  accountNumber  String?
  accountName    String?
  expiresAt      DateTime?
  scheduledFor   DateTime?
  sentAt         DateTime?
  createdAt      DateTime      @default(now())
  payment        Payment?
  @@index([providerId, status])
  @@index([status, expiresAt])
}

model Payment {
  id               String        @id @default(cuid())
  providerId       String
  jobId            String
  requestId        String?       @unique   // null only for MANUAL entries
  source           PaymentSource
  amountKobo       BigInt                  // Kora's *amount accepted*, never amount sent
  feeKobo          BigInt?
  payerName        String?
  payerBank        String?
  payerAccountMasked String?
  koraTransactionRef String?
  verifiedAt       DateTime?
  recordedById     String?                 // for MANUAL
  createdAt        DateTime      @default(now())
  @@index([jobId])
}

model WebhookEvent {
  id          String   @id @default(cuid())
  eventKey    String   @unique             // see §6.2
  eventType   String
  reference   String?
  signatureOk Boolean
  payload     Json
  receivedAt  DateTime @default(now())
  processedAt DateTime?
  error       String?
}

model ReviewItem {
  id          String     @id @default(cuid())
  providerId  String?                       // null if we can't attribute it
  kind        ReviewKind
  requestId   String?
  paymentId   String?
  webhookEventId String?
  detail      Json
  resolvedAt  DateTime?
  createdAt   DateTime   @default(now())
  @@index([providerId, resolvedAt])
}

model Notification {                        // transactional outbox
  id         String           @id @default(cuid())
  providerId String
  kind       NotificationKind
  dedupeKey  String           @unique       // e.g. "PAID_ALERT:<paymentId>"
  payload    Json
  sentAt     DateTime?
  attempts   Int              @default(0)
  lastError  String?
  createdAt  DateTime         @default(now())
  @@index([sentAt, createdAt])
}

model Session {
  id          String   @id @default(cuid())
  providerId  String
  tokenHash   String   @unique              // store only SHA-256 of the cookie value
  expiresAt   DateTime
  createdAt   DateTime @default(now())
}

model LoginToken {                           // one-time magic link from the bot
  tokenHash  String   @id
  providerId String
  expiresAt  DateTime
  usedAt     DateTime?
}
```

### 4.3 Constraints Prisma can't express (hand-written SQL in a migration)

```sql
-- At most one live request per job: no double-requesting the balance.
CREATE UNIQUE INDEX one_open_request_per_job
  ON "PaymentRequest" ("jobId")
  WHERE status IN ('SCHEDULED', 'SENT');

-- Money sanity
ALTER TABLE "Job"            ADD CONSTRAINT job_total_positive  CHECK ("totalKobo" > 0);
ALTER TABLE "Job"            ADD CONSTRAINT job_deposit_valid   CHECK ("depositKobo" IS NULL OR ("depositKobo" > 0 AND "depositKobo" < "totalKobo"));
ALTER TABLE "PaymentRequest" ADD CONSTRAINT request_amount_pos  CHECK ("amountKobo" > 0);

-- Search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX customer_name_trgm ON "Customer" USING gin (name gin_trgm_ops);
CREATE INDEX job_service_trgm   ON "Job"      USING gin (service gin_trgm_ops);
```

### 4.4 Derived values (never stored)

| Value | Derivation |
| --- | --- |
| `paidKobo(job)` | `SUM(Payment.amountKobo)` for the job (both sources; MANUAL is labelled in the UI) |
| `verifiedPaidKobo(job)` | Same, `source = KORA_VERIFIED` only. **This one drives "Ready to start"**. |
| `balanceKobo(job)` | `totalKobo − paidKobo` (negative ⇒ overpaid ⇒ ReviewItem) |
| `jobStatus` | `NOT_STARTED` if paid = 0 · `PART_PAID` if 0 < paid < total · `FULLY_PAID` if paid ≥ total |
| `readyToStart` | `AFTER_DEPOSIT`: verifiedPaid ≥ depositKobo (or ≥ total for a FULL plan) · `AFTER_FULL`: verifiedPaid ≥ total |
| `nextDue` | the open request's amount/expiry, or the job's `balanceDueAt` if no request is open |

The Today view and job lists compute these in **one SQL query** (a `LEFT JOIN` on an aggregated payments subquery) through `prisma.$queryRaw`, so a list never runs one query per row.

---

## 5. Money

- **Storage:** `BigInt` kobo everywhere, in DB columns and in TypeScript (`bigint`).
- **Kora boundary:** Kora amounts are in naira and may contain decimals (⚠ Confirm the format). `domain/money.ts` turns them into kobo by **parsing the decimal string** (`"25000.50"` → `2500050n`) and never goes through `Number`. Input with more than 2 decimal places is rejected.
- **API boundary:** JSON can't carry `bigint`, so DTOs send kobo as a **string** (`"amountKobo": "2500000"`). The web app formats it with `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })` after converting by string math.
- **Comparison:** we always compare Kora's **amount accepted** with `PaymentRequest.amountKobo`. The amount the customer sent can differ, because Kora reverses or refunds the difference.

---

## 6. Critical flows

### 6.1 Sending a payment request (account allocated at send time)

```
Provider taps "Send" (or a scheduled prompt fires and the provider taps "Send now")
  │
  ├─ 1. TX: lock request (SELECT … FOR UPDATE), check status ∈ {DRAFT, SCHEDULED},
  │        set koraReference = "KE-<requestId>-<n>" if not already set. COMMIT.
  │        (The reference exists BEFORE the Kora call, so a retry reuses it.)
  │
  ├─ 2. Kora: create single-use bank account (reference, amount in naira,
  │        customer name, account_name ⚠, expiry ⚠, notification_url)
  │        • on duplicate-reference error → query Kora for that reference, then continue
  │        • on network failure → return a retryable error; the request stays DRAFT
  │
  ├─ 3. TX: set bankName, accountNumber, expiresAt, status = SENT, sentAt = now.
  │        The partial unique index rejects a second open request on the same job.
  │
  └─ 4. Return the **prepared message** + share links:
         • wa.me/<customerPhone>?text=<urlencoded message>
         • https://t.me/share/url?url=<payment page>&text=<message>
         • raw text for "Copy"
```

The prepared message is built only by `domain/messages.ts` from stored fields, so account details are never retyped by hand.

### 6.2 Payment confirmation (the core path)

```
Kora ──POST /webhooks/kora──► Worker (fetch)
   1. Read raw body. Verify x-korapay-signature (HMAC-SHA256 with the secret key, via
      crypto.subtle) ⚠ Confirm exactly which bytes are signed.
      Bad signature → store WebhookEvent(signatureOk=false), return 401.
   2. eventKey = sha256(event + ":" + data.reference + ":" + data.status)
      INSERT WebhookEvent … ON CONFLICT (eventKey) DO NOTHING.
      Already existed → return 200 (duplicate; nothing to do).
   3. QUEUE.send({ type: "kora.verify", reference, webhookEventId })
   4. Return 200. Target: < 300 ms, no Kora calls on this path.

Queue consumer: kora.verify
   5. GET Kora transaction for `reference` (the webhook is a trigger, never proof).
      Not success → mark the event processed; nothing else to do.
   6. Find PaymentRequest by koraReference.
      Not found → ReviewItem(UNMATCHED_REFERENCE). Ack.
   7. ONE DB TRANSACTION:
        SELECT request FOR UPDATE
        if request.payment exists → already recorded (idempotent). Commit, ack.
        INSERT Payment(source=KORA_VERIFIED, amountKobo = Kora amount accepted, payer…)
        UPDATE request SET status = PAID   -- allowed from SENT *or* EXPIRED (see 6.4)
        compute job totals, readyToStart
        if amount ≠ request.amountKobo → ReviewItem(AMOUNT_MISMATCH)
        if job now overpaid             → ReviewItem(JOB_OVERPAID)
        if request was EXPIRED          → ReviewItem(PAID_AFTER_EXPIRY)
        INSERT Notification(PAID_ALERT, dedupeKey="PAID_ALERT:<paymentId>")
        INSERT Notification(RECEIPT_READY, …)
        UPDATE WebhookEvent SET processedAt = now
      COMMIT
   8. Enqueue { type: "notify.send", notificationId } for each new Notification.
   9. Any throw → message.retry() (exponential backoff). After max retries →
      dead-letter queue → its consumer writes ReviewItem(VERIFICATION_FAILED).
```

**Idempotency comes in three layers:** the unique `eventKey` (duplicate webhooks), the unique `Payment.requestId` plus the `FOR UPDATE` check (duplicate queue deliveries), and the unique `Notification.dedupeKey` (no double alerts).

### 6.3 Notifications (transactional outbox)

A notification is written **inside** the same transaction as the state change it describes. Sending happens afterwards:

- The `notify.send` handler loads the row. If `sentAt` is set it does nothing. Otherwise it calls the Telegram API and sets `sentAt`.
- If the enqueue in step 8 is lost (the Worker died after commit), the cron sweep re-enqueues `Notification` rows where `sentAt IS NULL AND createdAt < now() − 2 min`.
- The worst case is that Telegram gets the message twice when a send succeeds but the `sentAt` write fails. That is acceptable for an alert. A missed "paid" alert is not.

**Customer receipts.** We don't message customers directly: Telegram bots can't start chats, and WhatsApp needs approved templates. Instead:
1. The payment page `/p/:token` turns into the **receipt** once the request is PAID. A customer who still has the link open sees it update live.
2. The provider's "Paid ✔" alert has a **"Share receipt"** button that opens a prepared receipt message with the link, ready to forward in one tap.

### 6.4 Expiry and the late-payment race

- Cron selects `SENT` requests with `expiresAt < now() − 2 min grace` (batch of 100) and enqueues `request.checkExpiry` for each.
- The handler **asks Kora first**. If Kora reports success, it runs the 6.2 verification path (the payment wins). Otherwise it does a conditional `UPDATE … SET status='EXPIRED' WHERE id=? AND status='SENT'`.
- **A verified payment always wins.** If money arrives on a request already marked EXPIRED, we still record it, because the money is real. We flag it `PAID_AFTER_EXPIRY`, and if the provider had already sent a replacement request, the job may be overpaid (`JOB_OVERPAID`). The provider can cancel the replacement request from the review screen.
- "Send again" on an expired request **creates a new PaymentRequest** (new reference, new account). It never reuses the old one. The old request stays EXPIRED for history.

### 6.5 Balance requests

- `POST /api/jobs/:id/requests/balance` creates a request for exactly `totalKobo − paidKobo`, computed at creation time inside a transaction.
- Rejected if the balance ≤ 0 or another request is already open (the partial unique index enforces this too).
- Cron finds jobs where `balanceDueAt` falls today (Africa/Lagos), balance > 0, there is no open request, and `balancePromptedAt` is null. It writes a `BALANCE_DUE_PROMPT` notification with a "Send balance request" button that deep-links into the web app.

### 6.6 Scheduled sends

`SCHEDULED` means we **remind the provider** at `scheduledFor`. We do **not** allocate the Kora account at that time. The account is allocated only when the provider taps Send, so its expiry clock starts when the customer actually gets the details, as the product description requires. Fully automatic sending is left for a channel that allows business-initiated messages.

### 6.7 Provider authentication (Telegram magic link)

```
Provider opens t.me/KoboExactBot → /start
  Bot: creates Provider if new (stores telegramChatId), creates LoginToken
       (32 random bytes, stored hashed, 10-minute TTL, single use)
  Bot replies with a button: https://app/auth/callback?t=<token>
Browser → /auth/callback: token valid & unused → mark used → create Session
       → Set-Cookie: ke_session=<random>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30d
```

- This links the Telegram chat that receives alerts and logs the provider in, in one step, with no SMS provider and no passwords.
- The bot command `/login` issues a fresh link whenever the provider needs one.
- ⚠ Confirm with the team: the description says "Telegram or a one-time code". This design is the Telegram option. A phone OTP can be added later as a second login method.

---

## 7. Background work: cron and queue

**One queue, typed messages** (a discriminated union validated with Zod):

| Message `type` | Produced by | Work |
| --- | --- | --- |
| `kora.verify` | Kora webhook, expiry check | Query Kora, record payment (§6.2) |
| `request.checkExpiry` | cron | Kora check, then EXPIRED or verify (§6.4) |
| `notify.send` | after-commit, cron outbox sweep | Send one Telegram message |
| `digest.build` | cron | Build and send one provider's daily digest |

Settings: `max_batch_size: 10`, `max_retries: 5`, retry delay with backoff, and `dead_letter_queue: kobo-exact-dlq`.

**Cron `* * * * *`:** each run makes cheap indexed selects and enqueues the work:
1. Requests past expiry, then `request.checkExpiry`
2. Scheduled requests now due, then `SCHEDULED_SEND_PROMPT` notification
3. Balance-due jobs, then `BALANCE_DUE_PROMPT` notification
4. Providers whose `digestMinuteOfDay` matches the current Lagos minute and `lastDigestOn < today`, then `digest.build` (the handler sets `lastDigestOn` so each digest goes once a day)
5. Unsent notifications older than 2 minutes, then `notify.send`

Africa/Lagos is UTC+1 all year with no daylight saving, so time-of-day maths is simple. We still keep it in one helper.

---

## 8. API surface (provider app)

All `/api/*` routes need a session and are **scoped to `providerId` in the service layer**: every query includes `where: { providerId }`. That check is the tenancy boundary and it has its own tests.

| Method & path | Purpose |
| --- | --- |
| `GET /api/me` · `PATCH /api/me/settings` | Profile, ready-rule default, digest time |
| `GET /api/today` | The five Today buckets in one call |
| `GET/POST /api/customers` · `GET /api/customers/:id` | List/create; customer timeline |
| `POST /api/customers/import` | CSV import (name, phone), deduplicated by phone |
| `POST /api/jobs` · `GET /api/jobs/:id` · `PATCH /api/jobs/:id` | Create a job (with first request in DRAFT), view, edit notes/due date |
| `POST /api/jobs/:id/requests/balance` | Exact balance request |
| `POST /api/requests/:id/send` | Allocate Kora account, return prepared message (§6.1) |
| `POST /api/requests/:id/schedule` · `/cancel` · `/resend` | Schedule, cancel, new request after expiry |
| `POST /api/jobs/:id/payments/manual` | Manual cash entry (labelled "not verified by Kora") |
| `GET /api/search?q=&status=&from=&to=&view=` | Universal search + filter chips + saved views |
| `GET /api/review` · `POST /api/review/:id/resolve` | Needs-review queue |
| `GET /api/export.csv?from=&to=` | Accountant export (PDF comes later) |

Public, no auth:

| Method & path | Purpose |
| --- | --- |
| `GET /p/:token` | Payment page, which becomes the receipt once PAID |
| `GET /p/:token/status` | Small JSON for the page's polling |
| `POST /webhooks/kora` | Signature-verified |
| `POST /webhooks/telegram` | Secret-token-verified |
| `GET /auth/callback` | Magic-link login |

**Search parsing.** The query string is split into tokens:
- Phone-like tokens are normalised and matched on `phoneE164`.
- Amount-like tokens (`25000`, `25k`, `₦25,000`) become kobo and match a request or job amount exactly.
- Date-like tokens (`12/11`, `friday`, `this week`) become a date range.
- Everything else is fuzzy-matched on customer name and job service (`ILIKE` + `pg_trgm` similarity).

---

## 9. Prisma on Workers with Hyperdrive

- **Create the client per invocation.** `db/client.ts` exports `getDb(env)`, which builds `new PrismaClient({ adapter: new PrismaPg({ connectionString: env.HYPERDRIVE.connectionString }) })`. It is called inside `fetch`, `queue` and `scheduled`, and never at module scope.
- **Turn off Hyperdrive query caching** for this database (`wrangler hyperdrive create … --caching-disabled`, or the equivalent setting). Hyperdrive can cache read queries. Our status polling, the Today view and the `FOR UPDATE` paths must never read a stale payment status.
- **Interactive transactions** (`prisma.$transaction(async tx => …)`) work over Hyperdrive's pooled TCP. Keep them short and **never call Kora or Telegram inside one**.
- **Migrations** (`prisma migrate deploy`) run from CI or a developer machine against the **direct** database URL, never from the Worker.
- **Bundle size.** Check the gzipped Worker size against the plan limit (3 MB free, 10 MB paid) on the very first deploy.
- **Local dev.** `wrangler dev` uses `localConnectionString` (or `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`) pointing at a local Postgres or a Neon branch.
- ⚠ Confirm: Prisma's generator and adapter setup for Workers has changed between major versions. Pin the version that the current Prisma + Cloudflare guide uses and record it in the README.

---

## 10. Security and privacy

| Concern | Control |
| --- | --- |
| Forged payment ("fake screenshot", forged webhook) | HMAC signature check **and** independent Kora transaction query before any state change |
| Replay / duplicate webhooks | Unique `eventKey`; idempotent consumer |
| Cross-tenant data access | `providerId` on every query, enforced in services; integration tests try to read another provider's data |
| Session theft | Random 256-bit token, only its hash stored, HttpOnly/Secure/SameSite=Lax cookie, 30-day expiry, logout deletes the row |
| CSRF | SameSite=Lax, plus a required `X-Requested-With` header on mutating `/api` routes |
| Guessable payment links | `publicToken` = 128-bit random (base64url). The payment page shows business name, amount, purpose and bank details, but **not** customer phone numbers. Rate-limited per IP. |
| Telegram webhook spoofing | `secret_token` set at `setWebhook`, checked on every call |
| Secrets | `KORA_SECRET_KEY`, `KORA_PUBLIC_KEY`, `KORA_WEBHOOK_SECRET` (if separate), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SENTRY_DSN` kept as Wrangler secrets per environment |
| Personal data (Nigeria Data Protection Act 2023) | We store only name and phone. A consent flag is required before any customer-facing message. Phones are redacted in logs (`+234•••••1234`). Customer deletion is supported. Data region is recorded in the README. |
| Honest labelling | `MANUAL` payments always show "not verified by Kora". A missing payer name shows as "unknown", never as a match. Sandbox payer names show as "simulated". |

---

## 11. Observability

- **Structured log line per payment event**: `{ evt, requestId, koraReference, jobId, providerId, status, amountKobo, latencyMs }`. Searching a Kora reference in Workers Logs shows that payment's whole history.
- A **request ID** middleware adds `x-request-id` to responses and logs.
- **Sentry** (`@sentry/cloudflare`) wraps `fetch`, `queue` and `scheduled`.
- **Health signals** worth watching: dead-letter queue depth, unprocessed `WebhookEvent` rows older than 5 minutes, unsent `Notification` rows older than 5 minutes, open `ReviewItem` count. `GET /api/admin/health` exposes them, protected by an admin secret.

---

## 12. Environments and deployment

| | Local | Staging | Production |
| --- | --- | --- | --- |
| Worker | `wrangler dev` | `kobo-exact-staging` | `kobo-exact` |
| Database | Docker Postgres / Neon branch | Neon branch `staging` | Neon `main` |
| Kora | Sandbox keys | Sandbox keys | Live keys (after Kora approval) |
| Telegram bot | `@KoboExactDevBot` | `@KoboExactStagingBot` | `@KoboExactBot` |
| Kora webhook URL | `cloudflared` tunnel → localhost | staging URL | prod URL |

**CI pipeline (GitHub Actions):** typecheck → lint → unit tests → integration tests (Postgres service container) → build web → `prisma migrate deploy` (staging) → `wrangler deploy --env staging`. Production deploys are a manual trigger running the same steps with prod credentials.

**Migrations are additive only**: add, then backfill, then switch, then drop in a later release. The deployed Worker always works with both the old and new schema during a deploy.

**Region:** the Neon or Supabase region should be as close as possible to Lagos users and Kora's API. Hyperdrive pools connections near the database. If the Worker's placement adds latency, enable **Smart Placement**.

---

## 13. Testing strategy

| Layer | Tooling | What it proves |
| --- | --- | --- |
| Unit (`domain/`) | Vitest | Kobo parsing (including `"25000.5"`, `"1e3"` rejected, > 2 decimals rejected); derived balance/status/ready rules; state-machine transitions; message formatting |
| Integration | `@cloudflare/vitest-pool-workers` + real Postgres, Kora mocked with `fetchMock` | Signature good/bad; duplicate webhook → one Payment; two concurrent queue deliveries → one Payment; payment after expiry; balance request exactness; one-open-request constraint; tenant isolation; outbox recovery |
| Sandbox E2E | Script against Kora sandbox | Create account → wait for sandbox auto-complete (~2 min) → request PAID, alert sent |
| Demo rehearsal | Manual, on staging | The full §4 "day with Kobo-Exact" story, timed |

---

## 14. Open questions that affect the architecture

| # | Question | If the answer is "no" or different |
| --- | --- | --- |
| 1 | Is single-use bank-transfer enabled on our Kora account (sandbox **and** live)? | **Blocker.** Ask Kora on day 0. The fallback for the demo is Kora's standard bank-transfer charge, with the expiry handling adjusted. |
| 2 | Exact webhook signature: header name, algorithm, which bytes are signed? | Change `integrations/kora/signature.ts` only |
| 3 | Does Kora require static-IP allow-listing for API calls? | Workers have no fixed egress IP. We'd need a small proxy with a static IP (for example on Fly.io) for Kora calls only. |
| 4 | Max expiry window; can we set the displayed account name? | Set the default expiry in config; adjust the message wording |
| 5 | Amount format in responses (naira decimal string or number)? | Change the parser in `money.ts` only |
| 6 | Can the sandbox simulate an underpayment or overpayment? | If not, cover those cases with mocked integration tests only and say so in the demo |
| 7 | Merchant model: per-provider merchant vs platform account? | The demo uses one platform sandbox account. Per-provider keys would add an encrypted `KoraCredential` per provider; the schema leaves room for that. |
| 8 | Prisma version and Workers adapter setup | Pin after the day-1 spike |
| 9 | Data residency of the managed Postgres | Pick region and vendor; record it for NDPA compliance |
