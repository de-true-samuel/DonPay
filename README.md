# Paidar

**Payment-to-Work Management for Service Businesses**

> *Most payment tools stop when the money arrives. Paidar connects the money arriving to the work that needs to happen next.*

Paidar connects verified bank-transfer payments via Kora virtual accounts directly to job eligibility, rules-based prioritization, capacity-aware work scheduling, and in-app delivery tracking.

---

## Core Modules & Scope

Aligned with the **Paidar Product Scope & Execution Blueprint**:

1. **Client & Job Management** — Create and edit clients, define service scope, total price, payment terms (`Full`, `Deposit`, `Pay on delivery`), deadlines, and estimated work hours. Job execution status (`Awaiting payment → Ready → In progress → Completed / On hold / Cancelled`) stays strictly separate from payment status.
2. **Payment Management & Verification (Kora)** — Generates single-use virtual accounts per payment attempt, validates signed Kora webhooks, re-queries transactions before marking paid, prevents duplicate credits via idempotency keys, isolates partial/overpaid/late transfers in a **Needs Attention** reconciliation queue, and never lets a client screenshot or manual *"I've paid"* tap mark a payment verified.
3. **Prioritization & Scheduling Engine** — Deterministic rules-based scoring (`Priority = 0.35D + 0.25P + 0.15C + 0.15E + 0.10R` across Deadline urgency, Payment readiness, Client priority, Effort suitability, and Dependency readiness) paired with greedy slot allocation over your weekly working hours and explicit conflict flagging for human approval.
4. **Notifications** — In-app payment pings, verification updates, review alerts, and read-state tracking (with optional Telegram alerts as a secondary channel).
5. **Business Dashboard** — Answers immediately: *Payments received*, *Outstanding payments*, *Active jobs*, *Overdue & at-risk jobs*, *Next up* work queue, and recent verified credits.

**Explicitly excluded from MVP:** full accounting/bookkeeping, payroll, inventory management, employee attendance, AI chatbot/ML scheduling, automated WhatsApp bots, multi-gateway billing, or full ERP/CRM suites.

---

## Repository Structure

```
DonPay/
├─ src/                     # React + TypeScript + Vite SPA ("Obsidian Signal" dark-default UI)
│  ├─ api/                  # Typed fetch client, Zod endpoints, local mock API + Queue v2 mock
│  ├─ auth/                 # Session provider, Clerk/dev auth gate, route guards
│  ├─ contract/             # Zod contracts (contract.ts + v2.ts)
│  ├─ features/             # Domain flows: jobs, requests, customers, share dialog, review, live pings
│  ├─ lib/                  # BigInt kobo math, Lagos time, CSV helpers, audio/haptics, filters
│  ├─ pages/                # Route screens (/app, /app/queue, /app/jobs, /app/payments, /pay/:token, ...)
│  ├─ shell/                # AppShell, sidebar/bottom rail, offline/verify banners, session modal
│  ├─ styles/               # Plain CSS tokens, layout, Obsidian/Daylight themes, FX tiers
│  ├─ theme/                # Default-Obsidian theme & pointer spotlight controller
│  └─ ui/                   # TicketCard, CountdownRing, StatusChip, Money, Dialog, Icon, Toast
├─ public/                  # Local WOFF2 fonts, SVG grain/icons, PWA manifest, theme-init.js
├─ worker/                  # Edge Cloudflare Worker serving ./dist + proxying /api/* and /p/* to BACKEND_ORIGIN
├─ backend/                 # Cloudflare Worker (Hono + TypeScript + Prisma + Postgres/Hyperdrive + Queues + Cron)
│  ├─ prisma/               # PostgreSQL schema & migrations
│  └─ src/                  # Domain logic (priority/queue, money, job), services, Kora client, HTTP app
├─ wrangler.jsonc           # Frontend edge Worker configuration
├─ ARCHITECTURE.md          # System architecture & module flow
├─ contract.md              # Backend ↔ Frontend API contract
├─ DEPLOY.md                # Cloudflare Workers deployment guide
└─ USER_INTERACTION_FLOW.md # Screen-by-screen A-to-Z interaction documentation
```

---

## Run Locally

### Frontend SPA (with built-in mock API in `dev`)

```bash
npm install
npm run dev        # http://localhost:5173 (mock API active when VITE_MOCK is not 'false')
npm test           # Vitest unit tests
npm run typecheck  # Strict TypeScript check
npm run build      # Typecheck + production Vite bundle (mock off by default)
```

To point local Vite dev directly at the local backend Worker:

```bash
# In .env:
# VITE_MOCK=false
# VITE_DEV_PROXY=http://127.0.0.1:8790
npm run dev
```

### Backend Worker

See [`backend/README.md`](./backend/README.md) for Postgres startup, Prisma migrations, local `wrangler dev`, and unit/integration/e2e test scripts.

```bash
npm --prefix backend run typecheck
npm --prefix backend run test:unit
```

---

## Wire Compatibility Notes

- Two legacy wire identifiers remain in active HTTP transport and must stay synchronized across frontend and backend: header `X-Requested-With: kobo-exact` and cookie `ke_session`.
- Monetary values are always transmitted and calculated in **whole kobo as decimal strings** (`BigInt` in code, never floats). Time calculations use **`Africa/Lagos`** (`UTC+1`).

---

## Further Documentation

- [System Architecture](./ARCHITECTURE.md)
- [Backend ↔ Frontend Contract](./contract.md)
- [User Interaction Flow (A–Z)](./USER_INTERACTION_FLOW.md)
- [Deployment Guide](./DEPLOY.md)
- [Backend Runbook & Operations](./backend/OPERATIONS.md)
