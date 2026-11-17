# Frontend ↔ backend: differences and changes

Date: 2026-11-17. Compares the frontend's built-in fake API with the real backend in `backend/` (contract 1.1.0), and records the changes made to the frontend so it runs against the real backend.

## 1. What is where

| Location | What it is |
|---|---|
| `backend/` | The real backend: Cloudflare Worker, Postgres, Kora, Telegram. Contract 1.1.0 (`contract.md`). |
| `frontend/` | The React app (`paidar-web`). Includes a **fake API that runs in the browser**: `src/api/mock.ts` and `src/api/mockDomain.ts`. |
| Repo root (`src/`, `package.json`, `vite.config.ts`, `wrangler.jsonc`, `index.html`, `public/`) | A **copy of `frontend/`**, not a backend. Before these changes it differed from `frontend/` only in `src/api/client.ts` (log comments). It does **not** have the fixes below yet. |

There is only one real backend. The "two backends" are the real one in `backend/` and the fake API inside each copy of the frontend.

## 2. How the comparison was done

Every call in `frontend/src/api/endpoints.ts` was made against the real backend running locally. Each response was checked with the frontend's own schemas in `frontend/src/contract/contract.ts`. These are the same checks that raise `CONTRACT_MISMATCH` in development.

**Result: 33 of 35 calls passed.** The 2 failures and the silent mismatches the schemas don't catch are listed below. The schemas allow missing fields and ignore extra ones, so a renamed field passes the check but the screen shows nothing.

## 3. Breaking differences (fixed)

These stopped the frontend working against the real backend.

### 3.1 The dev proxy ignored `.env` files

- **Problem:** `vite.config.ts` read `process.env.VITE_DEV_PROXY`. Vite gives `.env` values only to app code, not to its own config. Samuel's commit `2c1e77d` removed the earlier `loadEnv` call when it changed the config to a plain object export for Cloudflare's build.
- **Effect:** `VITE_DEV_PROXY` in `.env.local` was ignored. `/api` calls went to Vite itself and failed, so sign-in errored or the app dropped to fake data.
- **Fix:** `vite.config.ts` calls `loadEnv` once at the top. A shell variable still takes priority. The plain object export is kept.

### 3.2 The fake-data fallback replaced real errors

- **Problem:** Samuel's commit `9083d6b` makes `api/client.ts` switch to the fake API whenever `VITE_API_URL` is empty and a call returns 404 or 405, returns HTML, or fails to connect. In dev with the proxy, `VITE_API_URL` is empty, so this caught real backend errors too, such as `404 NOT_FOUND` for a job.
- **Effect:** a real error, or a moment when the backend was down, silently switched the session to fake data. A provider could create a job and believe it was saved.
- **Fix:**
  - New `MOCK_FALLBACK` in `src/config.ts`. It is true only when no backend is configured: no `VITE_API_URL`, no `VITE_DEV_PROXY`, and `VITE_MOCK` is not `false`.
  - The fallback also never triggers on a JSON response, so a real backend error is always shown.

### 3.3 The payment page's API calls weren't forwarded

- **Problem:** the frontend's payment page (`/p/:token`) calls `GET /p/:token/status` and `POST /p/:token/claim-paid`. The proxy only forwarded `/api`.
- **Effect:** the payment page couldn't poll status or send "I've paid".
- **Fix:** the proxy also forwards `^/p/[^/]+/(status|claim-paid)$`. The page `/p/:token` itself is still served by the frontend.

### 3.4 `remindersDue` vs `dueReminders`

- **Problem:** the frontend expected `TodayResponse.remindersDue`. The backend sends `dueReminders`, the name in the Paidar spec (BE-03) and `contract.md`.
- **Effect:** "Reminders due" on Today was always empty, with no error. The schema defaulted the missing field to `[]`.
- **Fix:** the frontend now uses `dueReminders` in `contract.ts`, `mockDomain.ts` and `TodayPage.tsx`.

## 4. Other differences (not fixed, nothing breaks)

| Area | Fake API | Real backend | Effect |
|---|---|---|---|
| `messageConsent` on customers | Stored | Accepted but ignored, always returned `false` (consent was withdrawn in the spec) | The consent toggle never stays on. Remove it from the UI. |
| `POST /api/dev/expire/:id` | Expires a request | Doesn't exist (404) | The "expire" test button errors. To test "send again", wait for expiry or run the cron sweep. |
| `POST /api/me/telegram-link` | Works | 403 when no bot is configured | Expected locally. Works on servers with Telegram configured. |
| Payment links (`payLink`) | Open the frontend page `/p/:token` | Point to `PUBLIC_BASE_URL/p/:token`, the backend's own server-rendered page | Both work. To open the frontend's page instead, set the backend's `PUBLIC_BASE_URL` to the frontend origin, which also requires forwarding `/p` and `/webhooks` there. |
| `Idempotency-Key` | Ignored | Honoured | The frontend sends a new random key on every POST, so a double tap is **not** de-duplicated. To get the benefit, reuse one key per user action, including its retries. |
| `PublicRequest.receipt` | — | Also has `balanceDueAt` | Not used by the frontend. Harmless. |

### Contract 1.1.0 features the frontend doesn't use yet

| Feature | Backend route or field |
|---|---|
| Nudge message | `GET /api/requests/:id/nudge-message` |
| Start message | `GET /api/jobs/:id/start-message` |
| Copied marker | `POST /api/requests/:id/copied` |
| Provider recheck | `POST /api/requests/:id/recheck` |
| Account export | `GET /api/me/export` |
| Account deletion | `POST /api/me/delete` |
| Sign out everywhere | `POST /api/auth/logout-all` |
| Business phone, onboarding date | `phone` and `onboardedAt` on `PATCH /api/me` |
| Message language | `messageLanguage` on customers and jobs |
| Payment details block | `details` in prepared messages |

The frontend's `CONTRACT_VERSION` still says `1.0.0`. The backend sends `x-contract-version: 1.1.0`.

## 5. Files changed (all in `frontend/`)

| File | Change |
|---|---|
| `vite.config.ts` | `loadEnv` for `VITE_DEV_PROXY`, and the proxy also forwards the payment page's status and claim routes |
| `src/config.ts` | New `MOCK_FALLBACK` |
| `src/api/client.ts` | Fallback uses `MOCK_FALLBACK` and never fires on a JSON response |
| `src/contract/contract.ts` | `remindersDue` renamed to `dueReminders` |
| `src/api/mockDomain.ts` | `remindersDue` renamed to `dueReminders` |
| `src/pages/TodayPage.tsx` | `remindersDue` renamed to `dueReminders` |

**Checked:**
- frontend typecheck is clean and its 41 tests pass
- through `http://localhost:5173`, sign-in returned 200
- a missing job returned the backend's real 404, not fake data
- the payment page's status call returned 200 and claim returned 202, both from the backend
- `/p/:token` still loads the frontend page

## 6. Running locally

`frontend/.env.local` (not committed):

```
VITE_MOCK=false
VITE_DEV_PROXY=http://127.0.0.1:8790
VITE_DEV_LOGIN=true
VITE_SIMULATE_PAYMENTS=true
```

1. Start Docker Desktop. Then start the database: `cd backend && npm run db:up`.
2. Start the backend: `cd backend && npm run dev -- --port 8790`.
3. Start the frontend: `cd frontend && npm run dev`, then open http://localhost:5173.

## 7. Open items

1. **Root copy.** Keep one frontend: delete the root copy, or apply these changes to it. Check first which folder Cloudflare builds from (its build settings, or the root `wrangler.jsonc`).
2. **The deployed app can't reach the backend.**
   - It is a static site, so `/api` doesn't reach the backend.
   - Because of the fallback, it currently runs on fake data. Nothing is saved.
   - **Option 1, one domain (recommended):** the frontend Worker forwards `/api` and `/p` to the backend Worker through a service binding.
   - **Option 2, two domains:**
     - Set `VITE_API_URL` at **build time**. Setting it as a Worker variable after the build does nothing.
     - Set the backend's `FRONTEND_ORIGINS` and `COOKIE_SAMESITE=None`.
     - Safari blocks cross-site cookies unless both hosts share one domain of yours.
3. **Warning banner.** The "Demo mode is on" warning now only shows when `VITE_API_URL` is set, so a deployed build running on fake data shows no warning. Show the warning whenever `MOCK` is true or the fallback is used.
4. **Update the frontend contract** to 1.1.0 and build the features listed in section 4.
