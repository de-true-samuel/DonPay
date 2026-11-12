# Paidar Backend Implementation Spec

**Source:** Paidar Change Specification v1.1 (11 November 2026), Section 5 plus every backend-relevant item from Sections 1–4 and 6–10.
**Target:** Backend contract **v1.0.0 → v1.1.0**
**Audience:** Backend developer (with frontend developer and product owner for review)

> **Basis.** Statements about what exists come from contract v1.0.0, not from a review of the code. Anything marked **(confirm)** must be checked against the code or with Kora. Anything marked **(proposed)** is an implementation detail added in this spec to make the work buildable; it is not in the source document and should be agreed during review.

---

## Contents

1. Ground rules (the settled payment flow)
2. What already exists (do not rebuild)
3. Open decisions that block backend work
4. Work items
   - 4.1 Messages: BE-01, BE-02, BE-07, BE-08, BE-12
   - 4.2 Requests, Today and reminders: BE-03, BE-04, BE-05
   - 4.3 Payment verification and reliability: BE-06, BE-14
   - 4.4 Idempotency: BE-09
   - 4.5 Provider and customer data: BE-10, BE-11, BE-15, BE-16
   - 4.6 Customer payment page: BE-13
   - 4.7 Telegram bot scope
   - 4.8 Environments, operations and launch: BE-17, BE-18, BE-19, BE-20
5. Data model and migrations
6. Contract 1.1.0 API surface summary
7. Error and edge-case behaviour
8. Acceptance tests (backend-owned)
9. Delivery order
- Appendix A. Short message template
- Appendix B. Glossary

---

## 1. Ground rules (the settled payment flow)

These are non-negotiable. Every work item below must respect them.

1. **The virtual account is created only when the provider taps "Get payment details".** Never at job creation, never at scheduling. The expiry clock starts at that moment.
2. **Scheduling is a reminder to the provider only.** No account exists until the provider acts.
3. **Paidar never contacts the customer.** No WhatsApp Business API, no customer-facing bot messages, no automatic receipts into chats. The backend *prepares* text; the provider copies and sends it.
4. **The Telegram bot talks to the provider only** (sign-in, payment pings, reminders, evening summary).
5. **One exact amount per request.** A deposit and a balance are two separate requests. The backend never tracks a partial payment against one account. Kora reverses a short payment and keeps the request open until the right amount arrives or the account expires.
6. **The account is a Kora virtual account made for this one payment**, not the provider's own bank account. Settlement timing and fees are not shown anywhere until Kora confirms them (D3).
7. **Never trust the webhook body alone.** Verify the signature, re-query the transaction, and use Kora's accepted amount.

**Withdrawn — must not be built:** opt-in capture of the customer's WhatsApp/Telegram, a "Send automatically" option, scheduled requests that send themselves, customer channel fields, conversation identifiers, the "OK to message this customer" consent switch, and automatic receipts into the customer's chat.

### Naming and technical identifiers

The product is Paidar (formerly Kobo-Exact). These identifiers keep the old name and **must not be renamed** without a coordinated backend + frontend change:

| Identifier | Value |
|---|---|
| Request header | `X-Requested-With: kobo-exact` |
| Session cookie | `ke_session` |

---

## 2. What already exists (do not rebuild)

Per contract v1.0.0 **(confirm against the code)**.

| Capability | Status | What still needs doing |
|---|---|---|
| Account created at send; scheduling is a reminder | Exists (contract §6) | Nothing; matches the settled flow. |
| Sending the same request twice is safe | Exists | Returns the same request and message. Keep. |
| One open request per job | Exists | `OPEN_REQUEST_EXISTS` also covers an unsent draft. Keep. |
| Prepared message with WhatsApp and Telegram links | Exists | Switch to the short template (BE-01) and add `details` (BE-02). |
| Customer page at `/p/:token` and JSON status | Exists | Rebuild to spec (BE-13). |
| Signed webhooks, review items, late-payment handling | Exists | Add background reconciliation (BE-14). |
| Balance requests, manual payments, edit and cancel job | Exists | None. |
| Customers, CSV import/export, search, review queue | Exists | Ignore the CSV consent column (BE-15). |

---

## 3. Open decisions that block backend work

| # | Question | Blocks |
|---|---|---|
| D1 | Merchant model: each provider is their own Kora merchant, or one Paidar account collects for many (needs Kora approval; possible licensing implications). | BE-19 |
| D2 | **(confirm with Kora)** Can a single-use account's validity be extended or chosen? What is the default window? Can the displayed account name be set to the business name? | BE-13 wording, BE-19 |
| D3 | **(confirm with Kora)** Fees, who bears them, settlement timing into the business. | BE-19, any fee/settlement text |
| D4 | Where the customer payment page lives (see 4.6). Recommendation: Option A, backend-served. | BE-13 |
| D5 | Final wording of the short message (Appendix A). | BE-01 |
| D6 | How Paidar earns (fee per payment or subscription). | Open launch |
| D7 | Whether providers add a phone number for the "message the business" button. | BE-16 |

---

## 4. Work items

Each item lists **Priority** (Must / Should / Could), **Size** (S ≈ a day or less, M ≈ a few days, L ≈ a week or more) and **Depends on**.

### 4.1 Messages

#### BE-01 — Short message template
**Priority:** Must · **Size:** S · **Depends on:** D5

- `PreparedMessage.text` uses the short template in Appendix A.
- Fields, in order: business name; amount and service (with "deposit" / "balance" qualifier where relevant); bank; account number; account name; expiry time; payment page link.
- Amount in the message is formatted with `₦` and thousands separators (e.g. `₦25,000`).
- Expiry time rendered in **Africa/Lagos** time, human-readable (e.g. `4:10 PM today`).
- No personal details beyond what the customer already knows. Do not include the customer's phone number.
- Keep the existing WhatsApp and Telegram links on the prepared message (the frontend treats them as secondary).
- The frontend displays `text` exactly as returned and never rebuilds it, so the backend is the single source of wording.

**Acceptance:** for a deposit request of ₦25,000 for "Bridal makeup" the text matches Appendix A line-for-line (with real values); text contains no customer phone number.

#### BE-02 — Structured details on the prepared message
**Priority:** Should · **Size:** S · **Depends on:** none

Add `PreparedMessage.details`:

```ts
details: {
  bankName: string;        // e.g. "Wema Bank"
  accountNumber: string;   // string, preserve leading zeros
  accountName: string;     // as Kora will display it (see D2)
  amountKobo: number;      // integer, e.g. 2500000
  amountPlain: string;     // digits only, 2 decimals, no ₦, no commas: "25000.00"
  expiresAt: string;       // ISO 8601 UTC
}
```

- `amountPlain` must paste cleanly into a bank app: `/^\d+\.\d{2}$/`.
- Values must be identical to those embedded in `text`.

#### BE-07 — Nudge message endpoint
**Priority:** Should · **Size:** S · **Depends on:** none

`GET /api/requests/:id/nudge-message` → `PreparedMessage`

- Only for a **waiting** request (account created, unpaid) that **still has time left**.
- Wording along the lines of: "Your payment details expire in 10 minutes." The minutes value is computed from `expiresAt` at call time.
- Read-only; does not change request state and does not contact the customer.
- **(proposed)** Return `409` with a clear error code (e.g. `REQUEST_NOT_WAITING` / `REQUEST_EXPIRED`) when the request is not eligible.

#### BE-08 — Start message endpoint
**Priority:** Should · **Size:** S · **Depends on:** none

`GET /api/jobs/:id/start-message` → `PreparedMessage`

- Only once the job is `readyToStart`.
- Wording along the lines of: "Payment received. We're starting."
- **(proposed)** `409 JOB_NOT_READY` otherwise.

#### BE-12 — Customer message language
**Priority:** Could · **Size:** M · **Depends on:** none

- New optional field `Customer.messageLanguage`: `"en" | "pcm"` (English / Nigerian Pidgin).
- Selects the wording template for every copied message (payment details, nudge, start, receipt).
- Default `en` when null.

### 4.2 Requests, Today and reminders

#### BE-03 — `dueReminders` in the Today response
**Priority:** Must · **Size:** M · **Depends on:** none

- Add `TodayResponse.dueReminders: Array<{ request, job }>`.
- Include a request when **all** are true: it is scheduled; its reminder time is ≤ now; it has **no account yet**; it is not cancelled.
- Add `TodayResponse.counts.dueReminders`.
- A request stays in the list until the provider gets payment details or cancels it.
- All reminder times are interpreted in Lagos time.

#### BE-04 — Reminder message links to the job page
**Priority:** Should · **Size:** S · **Depends on:** none

- At the reminder time the bot sends the **provider** a Telegram message containing a link to the job page in the app.
- The reminder **does not create an account**.
- Consider one follow-up reminder the next morning if the request is still due. Make this configurable (**proposed:** config flag + Lagos-time hour, default off or 08:00).

#### BE-05 — `detailsCopiedAt` tracking
**Priority:** Could · **Size:** S · **Depends on:** none

- New optional field `PaymentRequest.detailsCopiedAt` (nullable timestamp).
- `POST /api/requests/:id/copied` sets it (**proposed:** set on first call; later calls are no-ops that return the existing value).
- Purpose: sync the "Details copied / Not copied yet" marker across devices. The frontend works without it.

### 4.3 Payment verification and reliability

#### Rules that apply to all payment handling
- Keep webhook **signature verification** and **duplicate-event protection**.
- Never trust the webhook body alone. **Re-query the transaction** with Kora and use the **accepted amount**.
- **Short payments:** rely on Kora's default (full reversal, request stays open until the right amount arrives or the account expires).
- **Overpayments:** Kora returns the excess. The job must show the correct paid amount, and any overpayment surfaces as a review item.
- **Late payments** (after expiry) create a review item: "Paid after the account expired". The provider decides; Paidar does not move money.
- **Account creation is idempotent per request.** Retrying "Get payment details" returns the same account. If Kora fails, the request stays a **draft** with a clear error code and **no half-created state**.
- Guard against **duplicate account numbers** (e.g. unique constraint), even though Kora should guarantee uniqueness.
- Wire the **dead-letter queue and health information** into monitoring.

#### BE-06 — Customer "I've paid" claim and provider recheck
**Priority:** Should · **Size:** M · **Depends on:** BE-13 (for the page button)

**Public claim endpoint:** `POST /p/:token/claim-paid`
- Sets `PaymentRequest.customerClaimedPaidAt` (if not already set) and records a **claim event**.
- **Never changes the request's status.**
- Alerts the provider (Telegram ping + in-app).
- Triggers a recheck (same logic as below).
- Rate-limited (**proposed:** per token and per IP; e.g. 3 claims per token per 10 minutes).
- Returns a neutral success response that leaks nothing about other requests.

**Provider recheck endpoint:** `POST /api/requests/:id/recheck` → `RequestWithMessage`
- Queries Kora by the request's reference, reconciles any payment found, returns the updated request and message.
- Idempotent; safe to call repeatedly.
- Handles late webhooks (payment received by Kora but webhook delayed or lost).

#### BE-14 — Background reconciliation
**Priority:** Must · **Size:** M · **Depends on:** none

- Periodically re-query with Kora:
  - every **waiting** request, until a little after its expiry (**proposed:** grace window of 30 minutes past `expiresAt`);
  - any request with **unprocessed webhooks**.
- Reconciliation uses the same code path as webhooks and recheck (signature-independent re-query, accepted amount, duplicate protection).
- **Alert** when a backlog builds (**proposed:** threshold on count of unprocessed items and on oldest-item age).
- **(proposed)** Interval of 1–2 minutes; respect Kora rate limits.

### 4.4 Idempotency

#### BE-09 — `Idempotency-Key` support
**Priority:** Should · **Size:** M · **Depends on:** none

- Accept an `Idempotency-Key` request header on:
  - creating a job;
  - requesting a balance;
  - getting payment details;
  - recording a manual payment.
- The same key returns the **original result for 24 hours**.
- Store keys in an idempotency table with a 24-hour expiry (see Section 5).
- **(proposed):** scope keys per provider; store method, path, a request-body hash, the response status and body; if the same key arrives with a different body, return `422 IDEMPOTENCY_KEY_REUSED`; if the original is still in progress, return `409` and let the client retry.
- Protects against double taps and flaky networks (test T7).

### 4.5 Provider and customer data

#### BE-10 — `Provider.onboardedAt`
**Priority:** Should · **Size:** S · **Depends on:** none

- New nullable timestamp on Provider, settable through `PATCH /api/me`.
- Backfill existing providers with their creation date.
- Replaces per-device onboarding memory in the frontend (FE-19).

#### BE-11 — Account export and deletion
**Priority:** Should · **Size:** M · **Depends on:** PR-02 (legal/retention policy)

- Provider can export their data and delete their account (frontend FE-23).
- Also support **sign out everywhere** (invalidate all `ke_session` sessions for the provider).
- Retention of customer names and phone numbers follows the policy agreed with legal advice.

#### BE-15 — Deprecate customer consent
**Priority:** Should · **Size:** S · **Depends on:** none

- `Customer.messageConsent`: **keep accepting it** in requests (no breaking change), **stop using it**, stop reading and writing it.
- Ignore the consent column in CSV import.
- Keep the DB column until a later cleanup; remove in a later major version.
- Mark deprecated in the contract changelog.

#### BE-16 — Provider phone number
**Priority:** Could · **Size:** S · **Depends on:** D7

- New optional `Provider.phone`: business phone for the "message the business" button on the expired page.

### 4.6 Customer payment page

#### BE-13 — Rebuild the customer payment page
**Priority:** Must · **Size:** L · **Depends on:** D2, D4

This page is the customer's entire experience of Paidar. WhatsApp cannot render copy buttons in a normal message, so the page carries them.

**Location (D4):**

| Option | Pros | Cons |
|---|---|---|
| **A. Improve the backend-served page (recommended)** | Already exists, no extra deployment, fastest to load. | Backend team owns design and styling. |
| B. Tiny standalone page in the frontend repo | Frontend owns the brand; still framework-free. | Another thing to deploy and route. |
| C. Route inside the React app | Shares the design system. | Heavy bundle for slow connections. Not recommended. |

**Requirements:**

1. **Fast on weak data:** well under **30 KB total**, no framework, critical styles inline, system fonts.
2. **Above the fold:** business name, service, **exact amount**, bank, **account number**, account name, time left.
3. **Two large copy buttons:** account number, and amount as plain digits (`amountPlain`). Show "Copied ✓". If the clipboard is blocked, the text stays selectable.
4. **Countdown** from `expiresAt`, corrected with the **server's current time** so a wrong phone clock does not mislead. (**proposed:** status JSON returns `serverNow`; client computes offset.)
5. **Guidance:** "Pay exactly ₦25,000.00. A different amount may be reversed by your bank." Also state which account name the bank will show (**confirm with Kora, D2**).
6. **Reassurance:** "This account is for this payment only." Trust cues: business name, service, "payment goes to {Business} via Kora".
7. **Live status:** poll `/p/:token/status` every **4 s** while open, slowing to **10 s after two minutes**, pausing when the page is hidden. On payment show "Payment received", amount, reference, time, and any balance and due date (a receipt the customer can save).
8. **"I've paid" button** (optional, shown after about **1 minute**): "Tell {Business} I've paid." Explains that confirmation comes from the bank. Calls BE-06 claim endpoint. **Never changes the status.**
9. **Expired, cancelled and not-found states** with friendly wording, and a "message the business" contact button when the provider's phone is known (BE-16).
10. **Privacy:** customer's **first name only**; nothing about other customers; `noindex`; unguessable token; rate limiting.
11. **Accessibility:** tap targets ≥ **48 px**, WCAG **AA** contrast, labelled buttons, and plain-text details that are readable **without JavaScript**.
12. **Caching:** `Cache-Control: no-store` on the page and the status endpoint.

**(proposed) Status JSON shape for `/p/:token/status`:**

```ts
{
  state: "waiting" | "paid" | "expired" | "cancelled";
  serverNow: string;          // ISO 8601 UTC
  expiresAt: string | null;
  receipt?: {
    amountKobo: number;
    reference: string;
    paidAt: string;
    balanceKobo?: number;
    balanceDueDate?: string;
  };
}
```

Not-found returns a friendly page / generic 404 JSON that reveals nothing.

### 4.7 Telegram bot scope

- Scope is the **provider only**: sign-in (`/login`), payment pings, reminders (BE-04), evening summary, and the "customer says paid" alert (BE-06).
- **Remove any customer-facing flows** if they exist.
- The bot never messages customers.

### 4.8 Environments, operations and launch

#### BE-17 — Staging, production and operations baseline
**Priority:** Must · **Size:** L · **Depends on:** none

- **Separate staging and production**, each with its own secrets, Kora keys and database. Staging → Kora sandbox; production → live Kora.
- **Cookies and CORS:** one origin, or sibling subdomains of one registered domain, with HTTPS and a `Secure` cookie (see `LAUNCH_CHECKLIST.md` for the three setups).
- **Rate limits** on the public payment page, the claim endpoint and sign-in.
- **Backups** with a restore that has actually been tested.
- **Logging** with request references and no sensitive data.
- **Monitoring and alerts** for webhook failures, notification failures, error rates, reconciliation backlog (BE-14) and dead-letter queue.
- **CI** on every push: typecheck, tests, build, contract tests.
- **Security review** of headers, cookies and the public page before opening to more people.
- Incident and rollback plan; rollback rehearsed once.

#### BE-18 — Read-only support view
**Priority:** Should · **Size:** M · **Depends on:** BE-17

- Look up a request **by reference** without database access. Read-only.
- The frontend shows the request reference on every error (FE-20) so support can use this view.

#### BE-19 — Live Kora cutover
**Priority:** Must · **Size:** M · **Depends on:** D1, D2, D3

- Live keys; live webhook URL; bank-transfer API enabled on the live account.
- One **real small payment verified end to end**.
- Then test against real banks: short payment, overpayment, expired account, late payment.
- Real fees and settlement timing exposed to providers only after D3 is answered.

#### BE-20 — Contract 1.1.0
**Priority:** Must · **Size:** S · **Depends on:** none

- Bump the contract to **1.1.0** with a changelog (Section 6 is the basis).
- Add **contract tests** that fail when the live backend's replies differ from the schemas (pairs with frontend FE-25).

---

## 5. Data model and migrations

All new columns are **nullable** so deploys are safe. Migrations must be **reversible** and **tested on a copy of production data**.

| Entity | Field / table | Type | Notes | Item |
|---|---|---|---|---|
| Provider | `onboardedAt` | timestamp, nullable | Backfill with provider creation date. | BE-10 |
| Provider | `phone` | string, nullable | Business phone; depends on D7. | BE-16 |
| PaymentRequest | `detailsCopiedAt` | timestamp, nullable | Set by `POST /api/requests/:id/copied`. | BE-05 |
| PaymentRequest | `customerClaimedPaidAt` | timestamp, nullable | Set by claim endpoint; never changes status. | BE-06 |
| Customer | `messageLanguage` | enum `en`/`pcm`, nullable | Default `en`. | BE-12 |
| Customer | `messageConsent` | existing | **Deprecated.** Stop reading/writing; keep column. | BE-15 |
| *new table* | claim events | — | **(proposed)** `id, requestId, createdAt, ipHash, userAgent`. | BE-06 |
| *new table* | idempotency keys | — | 24-hour expiry. **(proposed)** `providerId, key, method, path, bodyHash, status, responseBody, createdAt, expiresAt`, unique on `(providerId, key)`. | BE-09 |
| Virtual account | account number | existing | Add/confirm **unique constraint** as a duplicate guard. | 5.3 |

**Retention:** agree a retention policy for customer names and phone numbers with legal advice (PR-02) before BE-11 ships.

---

## 6. Contract 1.1.0 API surface summary

| Item | Change |
|---|---|
| `PreparedMessage.text` | **Changed:** short template (Appendix A). |
| `PreparedMessage.details` | **New:** `{ bankName, accountNumber, accountName, amountKobo, amountPlain, expiresAt }`. |
| `TodayResponse.dueReminders` | **New:** `Array<{ request, job }>`; plus `counts.dueReminders`. |
| `PaymentRequest.detailsCopiedAt` | **New, optional.** |
| `POST /api/requests/:id/copied` | **New:** sets `detailsCopiedAt`. |
| `PaymentRequest.customerClaimedPaidAt` | **New.** |
| `POST /p/:token/claim-paid` | **New, public, rate-limited.** Never changes status. |
| `POST /api/requests/:id/recheck` | **New:** re-query Kora, reconcile, return `RequestWithMessage`. Idempotent. |
| `GET /api/requests/:id/nudge-message` | **New:** `PreparedMessage` for a waiting request with time left. |
| `GET /api/jobs/:id/start-message` | **New:** `PreparedMessage` once `readyToStart`. |
| `Idempotency-Key` header | **New:** on create job, request balance, get payment details, record manual payment. 24 h. |
| `Provider.onboardedAt` | **New:** nullable, settable via `PATCH /api/me`. |
| `Provider.phone` | **New, optional** (D7). |
| `Customer.messageConsent` | **Deprecated:** accepted, ignored; CSV column ignored. |
| `Customer.messageLanguage` | **New, optional:** `en` \| `pcm`. |
| `/p/:token` and `/p/:token/status` | **Changed:** rebuilt to Section 4.6; `no-store`. |
| Contract version | **1.1.0** with changelog and contract tests. |

---

## 7. Error and edge-case behaviour

| Case | Required backend behaviour |
|---|---|
| Kora does not respond on "Get payment details" | Return a clear error code. Nothing is created; the request stays a **draft**. A retry is safe and creates **exactly one** account. |
| Same "Get payment details" call repeated | Return the same account and message (existing behaviour + idempotency key). |
| Provider reopens the panel ("Copy details again") | Return the same message and account. **Do not** create a new account. |
| Expired request, "Get new details" | Create a fresh account for a new request. |
| Customer pays the wrong (short) amount | Kora reverses it; the request stays open. |
| Customer overpays | Kora returns the excess; job shows the correct paid amount; overpayment appears for review. |
| Customer pays after expiry | Create a review item "Paid after the account expired". |
| Webhook delayed or lost | Background reconciliation (BE-14) or recheck (BE-06) finds it. |
| Customer taps "I've paid" | Record claim, alert provider, trigger recheck. **Status unchanged** unless the recheck finds a real payment. |
| Reminder time passes | Telegram reminder to provider; request appears in `dueReminders` until details are created or it is cancelled. No account created. |
| Open request already exists on job | Existing `OPEN_REQUEST_EXISTS` (covers unsent drafts too). |
| Unknown or cancelled token on public page | Friendly state; reveals nothing about anyone else. |
| Session ends | Existing auth behaviour; the frontend redirects to sign-in and returns to the same page. |

---

## 8. Acceptance tests (backend-owned or backend-dependent)

| # | Scenario | Expected result |
|---|---|---|
| T1 | Full payment, happy path | Create request, get details, pay from a bank app. Provider pinged; job shows Paid and Ready to start; customer page shows a receipt. |
| T2 | Deposit and balance | Two requests under one job. Job shows paid so far and the balance. Balance details use the computed remainder. |
| T3 | Short payment | Kora reverses it; request stays open; page tells customer to pay the exact amount. |
| T4 | Overpayment | Kora returns the excess; correct paid amount on the job; overpayment appears for review. |
| T5 | Expiry, then late payment | "Get new details" creates a fresh account. A payment to the old account becomes a review item "Paid after the account expired". |
| T6 | Kora down when getting details | Clear error; nothing created; request stays a draft; retry creates exactly one account. |
| T7 | Double tap / network retry | One account only, via the idempotency key. |
| T9 | Panel closed by accident | "Copy details again" returns the same message and account. |
| T10 | Scheduled reminder | No account at scheduling. At the time: Telegram reminder to provider, request in `dueReminders`, account created only on "Get payment details". |
| T11 | Delayed webhook | Customer taps "I've paid"; provider alerted; recheck finds the payment and status updates. The claim alone changes nothing. |
| T14 | Customer page on a slow connection | Amount, bank and account number appear quickly; copy buttons work on Android Chrome and iPhone Safari. |
| T15 | Cancelled request or unknown link | Friendly state; no information about anyone else. |
| T16 | Production build | No dev login, no simulate or "Expire now" endpoints reachable in production. |
| T17 | Customer page privacy | Only the customer's first name and this request's details are shown. |

**Additional backend checks (proposed):** contract tests pass against staging (BE-20); idempotency key reused with a different body is rejected; `dueReminders` excludes requests that already have an account; reconciliation does not double-credit a payment already processed by webhook.

---

## 9. Delivery order

Ordered by priority and dependency.

**Must — no external dependency (start now)**
1. BE-20 Contract 1.1.0 skeleton and changelog (keep updating as items land)
2. BE-03 `dueReminders`
3. BE-14 Background reconciliation
4. BE-17 Staging/production, secrets, backups, monitoring, rate limits, CI

**Must — blocked by decisions**
5. BE-01 Short message template (D5)
6. BE-13 Customer payment page (D2, D4)
7. BE-19 Live Kora cutover (D1, D2, D3)

**Should**
8. BE-02 Structured details (unblocks the frontend copy panel fully)
9. BE-09 Idempotency keys
10. BE-06 Claim-paid and recheck (button needs BE-13)
11. BE-04 Reminder links to job page
12. BE-07 Nudge message, BE-08 Start message
13. BE-10 `onboardedAt`, BE-15 Deprecate consent
14. BE-18 Support view (after BE-17)
15. BE-11 Export and deletion (after PR-02)

**Could**
16. BE-05 `detailsCopiedAt`, BE-16 Provider phone (D7), BE-12 Message language

**Definition of usable (from the product plan):** at least 20 real payments processed with every amount matching the bank; provider ping within a few seconds of a real payment; no simulate/dev-login paths in production; a backup restored once, a rollback rehearsed, and a person watching the first live payments.

---

## Appendix A. Short message template (proposed wording, decision D5)

```
Tolu's Glam Studio
Pay ₦25,000 for Bridal makeup (deposit)
Bank: Wema Bank
Account number: 7812345678
Account name: Tolu's Glam Studio
Valid until: 4:10 PM today
Details and copy buttons: https://.../p/AbC123
```

- First line is the business name, so the customer knows whose message it is.
- Amount shown with `₦` and commas in the message; copy buttons (page and app) copy plain digits.
- The link opens the payment page, which carries the copy buttons and countdown.
- No personal details beyond what the customer already knows.

## Appendix B. Glossary

| Term | Meaning |
|---|---|
| Virtual account | A bank account number made by Kora for one payment. Money paid into it is detected by Kora and settled to the business. |
| Payment request | One exact amount the customer is asked to pay, with its own virtual account. |
| Job | The agreement with one customer: service, total, and any deposit and balance. |
| Get payment details | The provider's action that creates the virtual account and the message to copy. |
| Reminder | A scheduled prompt to the provider. It creates no account. |
| Needs review | A payment that did not go to plan, such as a late payment. The provider decides. |
| Idempotency key | A value that lets the backend recognise a repeated request and return the original result. |
