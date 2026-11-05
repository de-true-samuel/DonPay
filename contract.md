# Kobo-Exact: Backend ↔ Frontend Contract

**Contract version: 1.0.0** · Backend: `backend/` · Source of truth for types: `backend/src/shared/contract.ts`

This document describes every piece of data the backend sends to the frontend or accepts from it. If the code and this document disagree, treat it as a bug and fix one of them. Every change bumps the version and adds a changelog entry (§12).

---

## 1. Conventions

### 1.1 Transport

- **Base URL:** the backend origin, e.g. `https://kobo-exact-staging.<account>.workers.dev` (local: `http://127.0.0.1:8790`, see `backend/README.md`).
- All provider endpoints are under **`/api`**, take JSON and return JSON (`Content-Type: application/json`), except CSV export.
- **CORS:** the backend allows the origin set in its `FRONTEND_ORIGIN` setting, with credentials. Call it with `fetch(url, { credentials: 'include' })`.

### 1.2 Authentication

- After login, the backend sets an **HttpOnly cookie `ke_session`**. The frontend never reads it. Just send `credentials: 'include'`.
- The same token is also returned in the login response (`sessionToken`). Clients that can't use cookies (mobile shells, tools) may send `Authorization: Bearer <sessionToken>` instead.
- **Every mutating request** (`POST`, `PATCH`, `DELETE`) to `/api/*` must include the header **`X-Requested-With: kobo-exact`** (CSRF guard). Without it the response is `403 CSRF_HEADER_MISSING`.
- A missing or expired session returns `401 UNAUTHENTICATED`. The frontend should send the user to the login screen.

### 1.3 Data formats

| Kind | Format | Example |
| --- | --- | --- |
| **Money** | **Whole kobo as a decimal string** (`KoboString`). Never a float. ₦1 = 100 kobo. | `"2500000"` = ₦25,000.00 |
| Money in requests | `KoboString` preferred; a JSON integer is also accepted | `"2500000"` or `2500000` |
| Timestamps | ISO 8601, UTC, with `Z` | `"2026-11-05T14:03:22.000Z"` |
| Time of day | `"HH:MM"`, 24-hour, **Africa/Lagos** time | `"19:30"` |
| Phone (response) | E.164 | `"+2348031234567"` |
| Phone (request) | Any Nigerian format; the backend normalises it | `"0803 123 4567"`, `"2348031234567"`, `"+2348031234567"` |
| IDs | Opaque strings (cuid). Don't parse them. | `"cm3x9k2ab0001…"` |
| Nullable fields | Present with `null`. Fields are never omitted. | `"balanceDueAt": null` |

To format kobo for display, convert by string or `BigInt`, never `Number(x) / 100` on large values:

```ts
const naira = (k: string) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })
    .format(Number(BigInt(k) / 100n) + Number(BigInt(k) % 100n) / 100);
```

### 1.4 Pagination

List endpoints take `?limit=` (default 25, max 100) and `?cursor=` and return:

```ts
interface Page<T> { items: T[]; nextCursor: string | null }   // null = no more pages
```

### 1.5 Errors

Every non-2xx response has this body:

```ts
interface ApiError {
  error: {
    code: ErrorCode;
    message: string;              // human-readable, safe to show
    details?: unknown;            // e.g. field errors for VALIDATION_ERROR
  };
}
```

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body or query failed validation. `details` = `{ fieldErrors: Record<string, string[]>, formErrors: string[] }` |
| 401 | `UNAUTHENTICATED` | No or expired session; invalid/used login token |
| 403 | `CSRF_HEADER_MISSING` | Mutating request without `X-Requested-With: kobo-exact` |
| 403 | `FORBIDDEN` | Not allowed in this environment (e.g. dev login disabled, payment simulation outside fake-Kora mode) |
| 404 | `NOT_FOUND` | Resource doesn't exist **or belongs to another provider** |
| 409 | `CONFLICT` | Duplicate (e.g. customer phone already exists; `details.existingId`) |
| 409 | `OPEN_REQUEST_EXISTS` | The job already has a SCHEDULED/SENT request, or (for balance requests) an unsent DRAFT one (`details.requestId`) |
| 409 | `INVALID_STATE` | Action not allowed in the current status (e.g. sending a PAID request) |
| 409 | `NOTHING_OWED` | Balance request on a fully paid job |
| 429 | `RATE_LIMITED` | Too many requests (public pages) |
| 502 | `KORA_UNAVAILABLE` | Kora failed or timed out. Safe to retry; nothing was charged. |
| 500 | `INTERNAL` | Unexpected; `x-request-id` header identifies it in logs |

Every response carries an **`x-request-id`** header. Include it in bug reports.

---

## 2. Enums

```ts
type PaymentPlan    = 'FULL' | 'DEPOSIT_BALANCE';
type ReadyRule      = 'AFTER_DEPOSIT' | 'AFTER_FULL';
type RequestKind    = 'FULL' | 'DEPOSIT' | 'BALANCE' | 'CUSTOM';
type RequestStatus  = 'DRAFT' | 'SCHEDULED' | 'SENT' | 'PAID' | 'EXPIRED' | 'CANCELLED';
type JobStatus      = 'NOT_STARTED' | 'PART_PAID' | 'FULLY_PAID' | 'CANCELLED';
type PaymentSource  = 'KORA_VERIFIED' | 'MANUAL';
type ReviewKind     = 'UNMATCHED_REFERENCE' | 'PAID_AFTER_EXPIRY' | 'JOB_OVERPAID'
                    | 'AMOUNT_MISMATCH' | 'PAYER_NAME_DIFFERS' | 'VERIFICATION_FAILED';
type SearchStatus   = 'paid' | 'waiting' | 'balance_due' | 'expired' | 'needs_review';
type SavedView      = 'unpaid_balances' | 'this_week' | 'needs_follow_up';
```

**What the request statuses mean (and the labels to show):**

| Status | Meaning | Suggested label |
| --- | --- | --- |
| `DRAFT` | Created, no bank account yet | "Not sent" |
| `SCHEDULED` | Provider will be reminded at `scheduledFor` | "Scheduled" |
| `SENT` | Kora account allocated; customer can pay until `expiresAt` | "Waiting" + countdown |
| `PAID` | Kora confirmed **and** we verified the amount accepted | "Paid ✔" |
| `EXPIRED` | Account expired unpaid. Offer **Send again**. | "Expired" |
| `CANCELLED` | Withdrawn by the provider | "Cancelled" |

**Allowed actions by status:** `send` → DRAFT, SCHEDULED · `schedule` → DRAFT, SCHEDULED · `cancel` → DRAFT, SCHEDULED, SENT · `resend` → SENT (re-share), EXPIRED (new request). A late payment can move EXPIRED → PAID; the UI must cope with that.

---

## 3. Core objects

### 3.1 Provider

```ts
interface Provider {
  id: string;
  businessName: string;
  telegramLinked: boolean;          // false → show "Connect Telegram for alerts"
  defaultReadyRule: ReadyRule;
  digestTime: string | null;        // "HH:MM" Lagos time; null = digest off
  createdAt: string;
}
```

### 3.2 Customer

```ts
interface Customer {
  id: string;
  name: string;
  phone: string;                    // E.164
  messageConsent: boolean;
  createdAt: string;
}

interface CustomerSummary extends Customer {
  jobCount: number;
  outstandingKobo: KoboString;      // sum of balances on non-cancelled jobs
  lastActivityAt: string;
}
```

### 3.3 Job

```ts
interface CustomerRef { id: string; name: string; phone: string }

interface JobSummary {
  id: string;
  customer: CustomerRef;
  service: string;
  totalKobo: KoboString;
  plan: PaymentPlan;
  depositKobo: KoboString | null;   // non-null when plan = DEPOSIT_BALANCE
  balanceDueAt: string | null;
  readyRule: ReadyRule;
  notes: string | null;
  status: JobStatus;

  // Derived by the backend from payments. Never compute these on the client.
  paidKobo: KoboString;             // all payments, incl. MANUAL
  verifiedPaidKobo: KoboString;     // KORA_VERIFIED only
  balanceKobo: KoboString;          // total − paid; "0" when fully paid; may be negative if overpaid
  readyToStart: boolean;            // uses verifiedPaidKobo only; show "Ready to start ✔"
  hasUnverifiedPayments: boolean;   // true → show "includes payments not verified by Kora"

  openRequest: PaymentRequest | null;   // the single SCHEDULED/SENT request, if any
  createdAt: string;
  cancelledAt: string | null;
}

interface JobDetail extends JobSummary {
  requests: PaymentRequest[];       // newest first
  payments: Payment[];              // newest first
  openReviewItems: ReviewItem[];
}
```

### 3.4 PaymentRequest

```ts
interface PaymentRequest {
  id: string;
  jobId: string;
  kind: RequestKind;
  amountKobo: KoboString;
  status: RequestStatus;
  payLink: string;                  // public customer page, e.g. https://api…/p/AbC123…
  bankName: string | null;          // null until SENT
  accountNumber: string | null;     // null until SENT
  accountName: string | null;       // null until SENT
  expiresAt: string | null;         // null until SENT
  scheduledFor: string | null;
  sentAt: string | null;
  paidAt: string | null;
  createdAt: string;
}
```

### 3.5 Payment

```ts
interface Payment {
  id: string;
  jobId: string;
  requestId: string | null;         // null for MANUAL
  source: PaymentSource;            // MANUAL → always label "not verified by Kora"
  amountKobo: KoboString;           // for KORA_VERIFIED: Kora's *amount accepted*
  payerName: string | null;         // null → display "unknown". Never treat null as a match.
  payerBank: string | null;
  payerAccountMasked: string | null;// e.g. "******4321"
  payerDetailsSimulated: boolean;   // true in sandbox → label "simulated"
  note: string | null;              // MANUAL entries
  receivedAt: string;               // verified time (Kora) or provider-entered time (MANUAL)
  createdAt: string;
}
```

### 3.6 PreparedMessage

The exact text the provider shares. **Show it exactly as given.** Account details must never be retyped or rebuilt on the client.

```ts
interface PreparedMessage {
  text: string;                     // full message, newlines included
  whatsappUrl: string;              // https://wa.me/234…?text=…  (opens chat with that customer)
  telegramUrl: string;              // https://t.me/share/url?url=…&text=…
  payLink: string;
}
```

### 3.7 ReviewItem

```ts
interface ReviewItem {
  id: string;
  kind: ReviewKind;
  message: string;                  // human-readable explanation, ready to show
  jobId: string | null;
  requestId: string | null;
  paymentId: string | null;
  detail: Record<string, unknown>;  // kind-specific extras (amounts as KoboString)
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}
```

### 3.8 TimelineEvent (customer page)

```ts
interface TimelineEvent {
  type: 'JOB_CREATED' | 'REQUEST_SENT' | 'PAYMENT_RECEIVED' | 'MANUAL_PAYMENT'
      | 'REQUEST_EXPIRED' | 'REQUEST_CANCELLED' | 'JOB_CANCELLED';
  at: string;
  jobId: string;
  service: string;
  requestId: string | null;
  paymentId: string | null;
  amountKobo: KoboString | null;
  label: string;                    // e.g. "Deposit ₦25,000 paid"
}
```

---

## 4. Auth endpoints

The login flow uses the Telegram bot:

1. The provider opens the bot and sends `/start` (or `/login`).
2. The bot replies with a link: **`{FRONTEND_URL}/auth?t=<loginToken>`**.
3. The frontend's `/auth` page reads `t` and calls `POST /api/auth/exchange`.

### `POST /api/auth/exchange`
```ts
// Request
{ token: string }
// 200
{ sessionToken: string; provider: Provider }      // also sets ke_session cookie
```
Errors: `401 UNAUTHENTICATED` (unknown, expired after 10 minutes, or already used).

### `POST /api/auth/dev-login` *(only when the backend has `DEV_LOGIN_ENABLED=true`, never in production)*
```ts
// Request
{ businessName: string }                           // creates or reuses a dev provider by name
// 200
{ sessionToken: string; provider: Provider }
```

### `POST /api/auth/logout` → `204`

### `GET /api/me` → `200 Provider`

### `PATCH /api/me`
```ts
{ businessName?: string; defaultReadyRule?: ReadyRule; digestTime?: string | null }
// 200 Provider
```

### `POST /api/me/telegram-link`
For a provider whose `telegramLinked` is false (e.g. created with dev login). Open the URL; the bot links the chat when the provider taps Start.
```ts
// 200
{ url: string; expiresAt: string }   // url = https://t.me/<bot>?start=link_<token>, valid 10 minutes, single use
```
`403 FORBIDDEN` if the server has no Telegram bot configured.

---

## 5. Today view

### `GET /api/today`

Everything the home screen needs in one call. Each list is sorted by most urgent first.

```ts
interface TodayResponse {
  generatedAt: string;
  justPaid:    { payment: Payment; job: JobSummary }[];    // payments received since Lagos midnight
  waiting:     { request: PaymentRequest; job: JobSummary }[]; // SENT and not yet expired; soonest expiry first
  balancesDue: JobSummary[];                               // balance > 0, no open request, balanceDueAt ≤ end of tomorrow (Lagos) or overdue
  expired:     { request: PaymentRequest; job: JobSummary }[]; // EXPIRED in the last 7 days, job still owes money and has no open request
  needsReview: ReviewItem[];                               // unresolved
  counts: { justPaid: number; waiting: number; balancesDue: number; expired: number; needsReview: number };
}
```

Poll every 15–30 s while the screen is open. Countdowns are computed on the client from `expiresAt`.

---

## 6. Customers

| Method & path | Request | Response |
| --- | --- | --- |
| `GET /api/customers?q=&limit=&cursor=` | `q` matches name or phone | `Page<CustomerSummary>` |
| `POST /api/customers` | `{ name: string; phone: string; messageConsent?: boolean }` | `201 Customer` · `409 CONFLICT` with `details.existingId` |
| `GET /api/customers/:id` | — | `CustomerPage` |
| `PATCH /api/customers/:id` | `{ name?; phone?; messageConsent? }` | `Customer` |
| `POST /api/customers/import` | `{ csv: string }`. Header row required, columns `name,phone[,consent]` | `ImportResult` |

```ts
interface CustomerPage {
  customer: CustomerSummary;
  jobs: JobSummary[];               // newest first
  timeline: TimelineEvent[];        // newest first
}

interface ImportResult {
  created: number;
  skipped: number;                  // duplicates by phone
  errors: { line: number; message: string }[];
}
```

---

## 7. Jobs

### `POST /api/jobs`: create a job

Either reference an existing customer or create one inline.

```ts
{
  customerId?: string;                        // one of customerId | customer
  customer?: { name: string; phone: string; messageConsent?: boolean };
  service: string;                            // 1–120 chars
  totalKobo: KoboString;                      // > 0
  plan: PaymentPlan;
  depositKobo?: KoboString;                   // required for DEPOSIT_BALANCE; 0 < deposit < total
  balanceDueAt?: string | null;               // ISO; only meaningful for DEPOSIT_BALANCE
  readyRule?: ReadyRule;                      // default: provider.defaultReadyRule
  notes?: string;
}
// 201 JobDetail. Its first request is created in DRAFT:
//   FULL            → kind FULL,    amount = total
//   DEPOSIT_BALANCE → kind DEPOSIT, amount = deposit
// If customer.phone already exists for this provider, the existing customer is reused.
```

| Method & path | Request | Response |
| --- | --- | --- |
| `GET /api/jobs?status=&limit=&cursor=` | `status` is a `JobStatus` | `Page<JobSummary>` |
| `GET /api/jobs/:id` | — | `JobDetail` |
| `PATCH /api/jobs/:id` | `{ service?; notes?; balanceDueAt?; readyRule? }` | `JobDetail` |
| `POST /api/jobs/:id/cancel` | — | `JobDetail` (cancels any DRAFT/SCHEDULED/SENT request) |
| `POST /api/jobs/:id/requests/balance` | `{ send?: boolean }` | `201 RequestWithMessage` (`message` is null unless `send: true`) |
| `POST /api/jobs/:id/payments/manual` | `{ amountKobo: KoboString; note?: string; receivedAt?: string }` | `201 Payment` |

The balance request amount is **always computed by the backend** as `total − paid`. The client never sends an amount. Errors: `409 NOTHING_OWED`, `409 OPEN_REQUEST_EXISTS` (also returned while an unsent DRAFT request exists, so the same money is never requested twice), `409 INVALID_STATE` on a cancelled job.

---

## 8. Payment requests

```ts
interface RequestWithMessage {
  request: PaymentRequest;
  job: JobSummary;
  message: PreparedMessage | null;
}
```

| Method & path | Request | Response | Notes |
| --- | --- | --- | --- |
| `POST /api/requests/:id/send` | — | `RequestWithMessage` | Allocates the Kora account **now** (expiry clock starts). Safe to retry: a retry returns the same account. `502 KORA_UNAVAILABLE` leaves it DRAFT. |
| `POST /api/requests/:id/schedule` | `{ scheduledFor: string }` (future ISO) | `RequestWithMessage` (`message: null`) | Provider gets a Telegram reminder at that time; no account is created yet |
| `POST /api/requests/:id/cancel` | — | `RequestWithMessage` (`message: null`) | |
| `POST /api/requests/:id/resend` | — | `RequestWithMessage` | SENT → same request, same message (re-share). EXPIRED → **a new request** with a new account; `request.id` is the new one. |
| `GET /api/requests/:id/message` | — | `PreparedMessage` | Re-share a SENT request |
| `GET /api/payments/:id/receipt-message` | — | `PreparedMessage` | Receipt text to forward to the customer |

**Prepared message example** (`text`):

```
Hi Tolu, here are the payment details from Tolu's Glam Studio for Bridal makeup (deposit):

Amount: ₦25,000.00 (pay this exact amount)
Bank: Wema Bank
Account number: 7821234567
Account name: Tolu's Glam Studio
Valid until: 3:45 PM, Thu 5 Nov

This account is for this payment only. Details & receipt:
https://api.example.com/p/AbC123
```

---

### `POST /api/dev/simulate-payment/:requestId` *(only when the backend runs with `KORA_MODE=fake`)*

Lets the frontend and the demo complete a payment before Kora sandbox access exists. It goes through the same verification code as a real payment, so the job, Today view, alert and receipt all update as they would for real. Payer details come back with `payerDetailsSimulated: true`.

```ts
// Request (all optional)
{ amountKobo?: KoboString; payerName?: string | null }   // default: the request's exact amount, "SIMULATED PAYER"
// 200
{ outcome: 'recorded' | 'duplicate'; paymentId: string | null }
```
The request must have been sent first (`409 INVALID_STATE` otherwise). `403 FORBIDDEN` when Kora mode isn't `fake`.

---

## 9. Search and history

### `GET /api/search`

| Param | Type | Notes |
| --- | --- | --- |
| `q` | string | Free text. Recognised: phone (`0803…`), amount (`25000`, `25k`, `₦25,000`, `1.5m`), and other words matched loosely on customer name and service. |
| `status` | comma list of `SearchStatus` | Filter chips; a job matches if **any** chip applies |
| `from`, `to` | ISO date `YYYY-MM-DD` (Lagos) | Filters on job creation or payment date |
| `view` | `SavedView` | Preset filters (below). Combines with `q`. |
| `limit`, `cursor` | | Pagination |

```ts
// 200
interface SearchResponse extends Page<JobSummary> {
  interpreted: {                  // shows what the backend understood; can be displayed as chips
    text: string | null;
    phone: string | null;
    amountKobo: KoboString | null;
  };
}
```

**Saved views:**
- `unpaid_balances`: status PART_PAID or NOT_STARTED, not cancelled.
- `this_week`: created or paid since Monday 00:00 Lagos time.
- `needs_follow_up`: balance due or overdue, an expired request, or an unresolved review item.

### `GET /api/export.csv?from=&to=`
`text/csv` download, one row per payment:
`date,customer,phone,service,request_kind,amount_naira,source,payer_name,kora_reference,job_total_naira,job_balance_naira`

---

## 10. Needs review

| Method & path | Request | Response |
| --- | --- | --- |
| `GET /api/review?state=open\|resolved&limit=&cursor=` | default `open` | `Page<ReviewItem>` |
| `POST /api/review/:id/resolve` | `{ resolution: string; cancelRequestId?: string }` | `ReviewItem` |

`cancelRequestId` lets the "paid after expiry, replacement now open" case be fixed in one action.

A payment whose Kora reference matches no request at all (`UNMATCHED_REFERENCE`) can't be attributed to a provider, so it never appears in a provider's list. Operators see it in `GET /api/admin/health` (`unattributedReviewItems`).

---

## 11. Public (customer-facing, no auth)

The backend serves the customer payment page itself at **`GET /p/:token`** (HTML). The frontend doesn't need to build it. For a custom design, use the JSON:

### `GET /p/:token/status` (also `GET /api/public/requests/:token`)

```ts
interface PublicRequest {
  status: RequestStatus;
  businessName: string;
  customerFirstName: string;
  service: string;
  kind: RequestKind;
  amountKobo: KoboString;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  receipt: null | {
    amountKobo: KoboString;         // amount accepted
    paidAt: string;
    reference: string;              // short receipt number
    jobTotalKobo: KoboString;
    jobPaidKobo: KoboString;
    jobBalanceKobo: KoboString;     // "0" = fully paid
  };
}
```

No phone numbers or provider IDs are ever exposed here. Rate limit: 60 requests per minute per IP.

### Webhooks (backend-only, listed for completeness)

- `POST /webhooks/kora`: Kora payment events. Signature-verified.
- `POST /webhooks/telegram`: Telegram bot updates. Secret-token-verified.

### `GET /health` → `{ ok: true, db: boolean, time: string }`

### `GET /api/admin/health` (header `X-Admin-Secret`)
```ts
{ deadLetterHint: string; unprocessedWebhooks: number; unsentNotifications: number; openReviewItems: number; unattributedReviewItems: number; oldestUnprocessedWebhookAt: string | null }
```

---

## 12. Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.0.0 | 2026-11-05 | Initial contract, as implemented in `backend/`: added `POST /api/me/telegram-link`, `POST /api/dev/simulate-payment/:requestId`, `unattributedReviewItems` in admin health; `OPEN_REQUEST_EXISTS` also covers unsent drafts for balance requests |
