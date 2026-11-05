# Kobo-Exact: Project Description (Version 2)

*Payment coordination for chat-based service providers · Kora hackathon, Covenant University · Working draft*

## 1. The problem in plain words

Service providers agree prices with customers in WhatsApp or Telegram, then lose part of every day to payment admin instead of the service itself. The usual pains:

- Scrolling through chats to find out whether someone has paid.
- Reading a long bank history to match a transfer to a customer, especially when two customers owe the same amount.
- Asking for screenshots, and wondering whether the screenshot is real.
- Remembering who still owes the balance, and by when.
- Keeping a spreadsheet of customers and payments up to date by hand.

This is a **payment-coordination problem** and a **convenience problem**. The money usually does arrive. What costs time is knowing which payment belongs to whom, what is still owed, and when it is safe to start work.

## 2. What Kobo-Exact does

Kobo-Exact gives every payment request its own single-use Kora bank account, sends the details to the customer in the chat they already use, and confirms the payment automatically through Kora. The provider is told the moment someone has paid, and can see every customer, job, balance and payment on one clear screen, with no chat searching and no long transaction lists.

**One-line pitch: Agree in chat. Pay exact. Know instantly. Get on with the work.**

## 3. Who it's for

Chat-based service providers who handle several customers at once: caterers, tailors, photographers, makeup artists, event planners, repair technicians, tutors, freelancers and small agencies. It suits anyone who takes deposits and balances, or who keeps asking "has she paid yet?"

It will not be worth switching for a provider who receives two payments a week and is happy with a bank app. The strongest users have enough volume, overlapping customers and manual tracking that already costs them time.

*[Add your own interview findings here: customers per day, how they track payments now, and how much time or money it costs them.]*

## 4. A day with Kobo-Exact

- **Agree the price in chat**, as the provider does today.
- **Create a job:** customer name, phone number, service, total price, and the payment plan (all at once, or a deposit and a balance).
- **Prepare the first payment request.** The provider sends it now or schedules it for a set time.
- **The Kora account is created at send time**, so its expiry clock starts when the customer actually receives the details.
- **The customer receives a short message** in their chat: business name, bank, account number, exact amount, expiry time, and a link to a clean payment page with copy buttons and a countdown.
- **The customer pays** from any bank app. No signup, no card.
- **Kora confirms, and Kobo-Exact verifies.** The provider gets an instant alert: *"Paid ✔ ₦25,000 from Tolu for Bridal makeup. Deposit received. Ready to start."*
- **The customer gets a receipt**, so they know it went through.
- **The job updates itself:** "Deposit paid. Balance ₦25,000 due Friday."
- **On Friday the balance request goes out** (or the provider is prompted to send it), and the cycle repeats until the job is fully paid.

## 5. Jobs, deposits and balances (the core of the product)

A **job** is the agreement with one customer: the service, the total price, and when each part is due. A **payment request** is one exact amount inside that job, with its own single-use Kora account.

- A job paid in full uses one request.
- A job with a deposit and a balance uses two requests. For example ₦25,000 now and ₦25,000 on Friday.
- The job always shows the running picture: **paid so far, balance remaining, next due date.**

Why exact amounts per request? Kora's default behavior is to reverse an underpayment in full and keep the transaction open until the correct amount arrives or the account expires. It returns the excess on an overpayment. So Kobo-Exact doesn't track "half a payment" on one account. It tracks balances by creating a new exact request for the remainder. This keeps every naira traceable to one request.

**"Ready to start" rule.** For each job the provider chooses when work can begin: after the deposit, or after full payment. The app shows a clear **Ready to start ✔** badge once the rule is met. The provider still decides; the app only tells them what has been verified.

## 6. Seeing everything at a glance

The home screen is a **Today view**, not a list of transactions. It answers one question: *what needs my attention right now?*

- **Just paid:** payments confirmed today, with "Ready to start" badges.
- **Waiting:** requests sent and still within their time limit, with a countdown.
- **Balances due:** jobs where a balance is due today or soon.
- **Expired, send again:** requests whose account expired. One tap creates and shares a new request.
- **Needs review:** a payment that arrived with no matching request, or whose payer name looks different.

Each customer and job also carries a simple status: **Not started, Part-paid (balance due), Fully paid.**

At a time the provider chooses, a short **daily digest** arrives in their chat app: how many paid, what is still waiting, and who to follow up with.

## 7. Finding things fast: history that is easy to use

The history is built for search, not scrolling.

- **One search bar** that finds by customer name, phone number, amount, service or date.
- **Filter chips:** Paid, Waiting, Balance due, Expired, Needs review, plus a date range.
- **Customer page:** every job and payment for one person on a single timeline.
- **Saved views:** "Unpaid balances," "This week," "Needs follow-up."
- **Quick actions on every row:** resend the details, create a balance request, view or share the receipt.
- **Export** to CSV or PDF for the provider's accountant. The spreadsheet is replaced, not required.

## 8. Fake screenshots

A screenshot is no longer evidence. A payment counts only when Kora confirms it for that request's single-use account, and Kobo-Exact re-checks the amount accepted with Kora before marking it paid. A fake screenshot changes nothing in the app, and the provider can simply say: "I'll start when the app shows paid."

**Honest limits:**

- This protects payments made **through the account Kobo-Exact generated**. If a customer pays an old personal account number instead, the app can't verify it.
- A confirmed payment shows that money arrived. It doesn't prove where the money came from.
- Payer-name checks are a secondary signal. A missing name is shown as "unknown," never as a match.

## 9. What the customer experiences

- A short, clear message in the chat they already use, with the business name, exact amount and expiry time.
- A simple payment page with copy buttons and a countdown. No app to install.
- A receipt after payment, and a clear reminder of any balance still due.
- Nothing else: no signup, no spam.

## 10. How Kora is used (technical summary)

- **Single-use bank accounts:** one per payment request. Each account expires after one transaction. Kora's docs say this API must be enabled on your account by contacting Kora.
- **Webhooks:** Kora notifies our server when money arrives. We verify the signature, ignore duplicates, and never act on the webhook alone.
- **Transaction query:** we ask Kora for the status, the amount paid, the amount accepted, and the payer's account details where available. The amount accepted is what counts.
- **Underpayment and overpayment handling:** Kora's own behavior (reverse a short payment, return an excess), which Kobo-Exact shows clearly to the provider.
- **Our own layer:** jobs, balances, the Today view, search, receipts and alerts. This is where the product's value sits, on top of Kora's payment features.

## 11. Backend stack

Chosen for a small team and a hackathon timeline: few moving parts, nothing to run or patch ourselves, and a clean path to production.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript | One language across API, bot and any future web app, with types shared end to end. |
| API framework | **Hono** | Small, fast, built for edge runtimes, and first-class on Cloudflare Workers. |
| Hosting | **Cloudflare Workers** | Instant deploys, HTTPS and secrets built in, no servers. Wrangler for config and deploys. |
| Database | **PostgreSQL** (managed: Neon or Supabase) | Relational data, strong constraints, real transactions, good search. |
| DB connectivity | **Cloudflare Hyperdrive** | Pools and accelerates connections to Postgres from Workers, so normal TCP drivers and interactive transactions work. |
| ORM | **Prisma**, with the `pg` driver adapter | Typed queries and migrations. On Workers, Prisma runs through a driver adapter rather than its old native engine. |
| Validation | **Zod** (with Hono's validator middleware) | Validates every request body, plus the Kora webhook payload and API responses. |
| Background work | **Cloudflare Queues** | Webhook processing, receipts and alerts run off the request path and are retried on failure. |
| Scheduling | **Cron Triggers** | A per-minute sweep for expiries, scheduled sends, balance-due prompts and the daily digest. |
| Chat integration | **Telegram bot** via grammY (webhook mode) | Instant "paid" alerts, the daily digest and chat shortcuts. No outbound messaging approval needed. |
| Authentication | Provider login via Telegram or a one-time code; session tokens in secure cookies | Providers need accounts. Customers never do. *(Confirm the exact method before building.)* |
| Secrets | Wrangler secrets | Kora API keys and the webhook secret never live in code or the database. |
| Testing | Vitest, against Kora's sandbox | Webhook signature, duplicate delivery and expiry cases can all be tested. |
| Observability | Workers logs, plus an error tracker such as Sentry | Every payment event gets a traceable log line with the Kora reference. |

### Core data model

- **Provider**: the business using the app (name, Telegram chat ID, settings such as the "Ready to start" default).
- **Customer**: name and phone number, belonging to one provider, with a consent flag for messages.
- **Job**: a customer, a service, a total price, a payment plan and a "ready to start" rule.
- **PaymentRequest**: one exact amount inside a job. Holds the Kora reference, account number, bank, expiry time and status (`DRAFT`, `SCHEDULED`, `SENT`, `PAID`, `EXPIRED`, `CANCELLED`).
- **Payment**: a verified payment, linked to one request, with the amount accepted by Kora. Also used for manual entries, flagged "not verified by Kora."
- **WebhookEvent**: every incoming Kora event, stored raw with a unique event key, so duplicates are detected and everything can be audited or replayed.

### Rules the backend must follow

- **Money is stored as whole kobo, never as decimals or floats.** Use `BigInt` in Prisma, since a 32-bit `Int` tops out around ₦21 million, which a large event booking could pass. Convert to naira only for display.
- **Balances are derived, not stored.** Paid so far is the sum of verified `Payment` rows for the job, and balance remaining is the total minus that. There is no counter to drift out of sync.
- **One Kora reference maps to one request**, enforced by a unique constraint.
- **Webhook handling is idempotent.** A repeated delivery changes nothing.
- **A payment is only recorded after verification.** The webhook is a trigger, not proof; the backend always queries Kora for the status and amount accepted before marking anything paid.
- **Status changes and payment inserts happen in one database transaction**, so a request can never be marked paid without its payment row, or the reverse.

### Payment confirmation flow

1. Kora sends a webhook to a Hono route on the Worker.
2. The route verifies the signature, stores a `WebhookEvent` (rejecting duplicates by its unique key), pushes a message onto the queue, and returns `200` quickly.
3. The queue consumer calls Kora's transaction query for that reference and checks the status and amount accepted.
4. In one Prisma transaction, it creates the `Payment`, sets the request to `PAID`, and checks the job's "Ready to start" rule.
5. It sends the provider's Telegram alert and the customer's receipt.
6. Anything that fails is retried by the queue. Anything that can't be matched to a request goes to **Needs review**.

### Prisma on Workers: setup notes

- Create the Prisma client **inside the request or queue handler**, using the Hyperdrive connection string from the Worker's bindings. Don't reuse a client across requests at module level.
- Use the driver-adapter setup for `pg`, and keep migrations (`prisma migrate`) out of the Worker. Run them from a developer machine or CI against the database directly.
- Prisma's Workers support and bundle size have changed across versions, so follow the current Prisma and Cloudflare guides and test a deploy early, before building features on top.

### Environment and deployment

- Environments: **local** (Wrangler dev against a local or branch database and Kora sandbox), **staging** and **production**, each with its own database and Kora keys.
- Deploy with Wrangler from CI. Run migrations first, then deploy the Worker.
- Keep the Worker and Postgres region close together to limit query latency.

### To confirm

- That Kora doesn't require static IP allow-listing for API calls, since Workers can't provide a fixed outbound IP.
- Which signed payload and header Kora uses for webhooks, because this decides how the signature check is written.
- The current recommended Prisma adapter setup for Workers and Hyperdrive.
- Where customer data is stored, in light of the data-protection point in section 15.

## 12. Real and simulated in the demo

- **Real, in Kora's sandbox:** account creation, payment confirmation, amount verification, balances, alerts and history. The sandbox completes a payment automatically after about two minutes, or you can trigger it yourself.
- **Simulated:** the customer's bank-app payment, and the payer name (the sandbox returns placeholder values, so any name check is labeled as simulated).

## 13. Corrections compared with the earlier draft

- **The headline changed.** The product is now described as coordination and convenience first. Verification is the engine that makes it trustworthy, not the headline.
- **Balances are now core.** The earlier draft downplayed deposits and balances. Jobs with a deposit and balance are central, tracked as separate exact requests.
- **The Today view was added.** The provider sees what needs attention, not a list of transactions.
- **History is search-first.** Search, filters, customer pages and saved views replace a long list.
- **A "Ready to start" rule per job was added**, so the provider doesn't have to work it out.
- **Spreadsheet replacement.** Import a customer list once, and export when needed.
- **Manual entries are allowed but labeled.** Cash or off-app payments can be recorded, clearly marked "not verified by Kora."
- **The trading-desk focus was dropped.** Two-person approval stays an optional setting for teams, not a core feature.
- **Limits are stated plainly.** The app solves fake screenshots only for payments made through its own accounts.

## 14. Proposed additions

Test for every feature: does it save the provider time, prevent a mistake, or build customer trust? If not, leave it out.

### Include in the first build

- **Today view and status board.** The main screen, as described above.
- **Job ledger with deposit and balance plan**, including the "Ready to start" rule.
- **Universal search, filters and customer pages.**
- **Instant "paid" alert** to the provider (a Telegram bot is the easiest MVP), plus an **automatic receipt** to the customer.
- **One-tap resend and new request** when an account expires.
- **Prepared message sharing.** The app generates the exact message, and the provider taps send in their own WhatsApp or Telegram. Details are never retyped, so a typo can't send money to the wrong account.
- **Daily digest.**

### Strong additions after that

- **Balance reminders to the provider**, and optional gentle reminders to the customer, only with their consent.
- **Scheduled sending.** At the chosen time, the provider gets a prompt ("Time to send Tolu's balance") or the message goes out automatically where the channel allows.
- **Job notes and due dates**, such as "fitting Friday" or "delivery Monday," so one screen holds the whole job.
- **Slot hold for bookings.** A booking slot is held only while the payment account is valid, confirms when payment is verified, and releases automatically on expiry.
- **Customer trust page** showing the business name, amount and purpose, with a "verify this request" link, so customers can tell a genuine request from an imitation.
- **Chat shortcuts.** In Telegram, a command such as `/request Tolu 0801… 50000 makeup deposit in 2h` creates a request in one line.
- **Voice note to request.** The provider speaks the details, the app drafts the request, and the provider confirms before anything is sent. Draft-only, so mistakes never reach a customer.
- **Team roles**, so staff can create requests while the owner sees everything.
- **Manual payment entry**, clearly labeled "not verified," for cash or off-app payments.

### Later, with more care

- Private reliability notes (which customers usually pay on time), visible only to the provider.
- Refund and cancellation records, using Kora's refund tools.
- Payouts to collaborators, only after the merchant model is settled.
- Accounting integrations.

### What to avoid

- Automatic reminders to customers who didn't ask for them. Spam erodes trust and may breach messaging rules.
- Public reliability scores, which raise fairness and privacy concerns.
- A full customer-management system. Keep the product focused on payments.
- Any claim to prove the source of funds.

## 15. What to confirm before building

- **Kora:** that the single-use bank-transfer API is enabled on your account, its maximum expiry window, whether the displayed account name can be set, fees, settlement timing, the webhook signature header, and whether the sandbox can simulate a short payment.
- **Who is the merchant?** Each provider as their own Kora merchant, one platform account collecting for many providers (which needs Kora's explicit approval), or one demo account for the hackathon. Get this in writing from Kora and state clearly in the pitch which one the demo uses.
- **Messaging:** WhatsApp sends business-initiated messages only through approved templates and charges per delivered template, and its pricing has changed several times, so check current terms. Telegram bots generally can't message someone who hasn't started the bot. SMS needs sender-ID registration. For the MVP, the prepared-message approach avoids all three.
- **Demand:** how many customers a provider handles daily, how they track payments now, whether they would send app-generated details instead of their own account number, and what fees they would accept.
- **Data and trust:** you will hold customer names and phone numbers, so confirm your obligations under Nigeria's data protection law and get consent for messages.

## 16. What Kobo-Exact does not do

It doesn't hold customer money beyond Kora's normal settlement to the merchant, prove where funds came from, decide when a provider starts work, or verify payments made outside its own accounts. It tells the provider, clearly and instantly, what has been paid and what is still owed.

## 17. The 30-second pitch

Service providers handle customers in chat but track payments in their heads, their bank alerts and a spreadsheet. Kobo-Exact gives each payment request its own Kora account, confirms it automatically, and shows the provider one clear screen: who has paid, who owes a balance, and who is ready to start. No chat searching, no fake screenshots, no spreadsheet. Agree in chat. Pay exact. Know instantly. Get on with the work.
