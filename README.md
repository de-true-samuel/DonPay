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
