# Paidar — End-to-End User Interaction Flow (A to Z)

This document details every interactive surface, control, form field, validation rule, modal/drawer, status transition, keyboard behavior, empty/loading/error state, and cross-page flow implemented across the Paidar application (`src/`).

---

## 1. Architecture, Route Map & Guards

### 1.1 Route Guards (`src/auth/guards.tsx`, `src/auth/AuthProvider.tsx`)
1. **`RequireAuth`**:
   - Reads authenticated provider state (`ME_KEY = ['me']`).
   - **Loading**: Displays a centered splash screen with `<LogoMark size={48} />`.
   - **Anonymous (`!expired`)**: Redirects via `<Navigate>` to `/login`.
   - **Expired session (`expired === true` via `UNAUTH_EVENT`)**: Keeps the current authenticated route mounted (`<Outlet />`) so unsaved form edits are preserved, and overlays the inline **`SessionExpiredModal`** (`GLB-16`).
2. **`RequireOnboarded`**:
   - Checks `isOnboarded(provider.id)`.
   - If incomplete, redirects to `/onboarding`; otherwise renders `<AppShell>`.

### 1.2 Complete Route Directory (`src/App.tsx`, `worker/index.js`)

| Category | Path | Component / Target | Auth Guard |
| :--- | :--- | :--- | :--- |
| **Public Marketing** | `/` | `LandingPage` | Public |
| **Client Payment** | `/pay/:token` | `PublicPayPage` (`/pay/demo` supported) | Public |
| **Legacy Pay Redirect** | `/p/:token` | `LegacyPayRedirect` → `/pay/:token` | Public |
| **Client Receipt** | `/receipt/:token` | `PublicReceiptPage` | Public |
| **Authentication** | `/auth`, `/login` | `AuthPage` | Public |
| **Sign Up** | `/signup` | `SignupPage` | Public |
| **Verify Email** | `/verify-email` | `VerifyEmailPage` | Public / Post-signup |
| **Password Recovery** | `/forgot-password` | `ForgotPasswordPage` | Public |
| **Password Reset** | `/reset-password` | `ResetPasswordPage` | Public (`?token=`) |
| **Onboarding** | `/onboarding` | `OnboardingPage` | `RequireAuth` |
| **Dashboard (Today)** | `/app` | `TodayPage` | `RequireAuth` + `RequireOnboarded` |
| **Work Queue** | `/app/queue` | `QueuePage` | `RequireAuth` + `RequireOnboarded` |
| **New Payment Request** | `/app/new` | `NewRequestPage` | `RequireAuth` + `RequireOnboarded` |
| **Jobs (Master-Detail)** | `/app/jobs`, `/app/jobs/:id` | `MasterDetail` (`JobsPage` + `JobPage`) | `RequireAuth` + `RequireOnboarded` |
| **Edit Job** | `/app/jobs/:id/edit` | `EditJobPage` | `RequireAuth` + `RequireOnboarded` |
| **Payments & Review** | `/app/payments` | `PaymentsPage` | `RequireAuth` + `RequireOnboarded` |
| **Clients (Master-Detail)** | `/app/clients`, `/app/clients/:id` | `MasterDetail` (`PeoplePage` + `CustomerPage`) | `RequireAuth` + `RequireOnboarded` |
| **Notifications** | `/app/notifications` | `NotificationsPage` | `RequireAuth` + `RequireOnboarded` |
| **Settings** | `/app/settings` | `SettingsPage` | `RequireAuth` + `RequireOnboarded` |
| **Legacy App Aliases** | `/today`, `/new`, `/jobs`, `/people`, `/review`, `/settings` | Redirects to `/app/*` equivalents | `RequireAuth` |
| **Search & Export** | `/search` | `SearchPage` + `ExportDialog` | `RequireAuth` |
| **Design Kit (Dev)** | `/kit` | `KitPage` | Dev |
| **System / Error** | `/500`, `/maintenance`, `/404`, `*` | `ServerErrorPage`, `MaintenancePage`, `NotFoundPage` | Public |

> **Edge Worker Proxy (`worker/index.js`):** Incoming requests to `/api/*`, `/p/:token/status`, and `/p/:token/claim-paid` are forwarded directly to `BACKEND_ORIGIN`; all other paths serve the built SPA (`./dist`).

### 1.3 Status Chip System (`src/ui/StatusChip.tsx`)
Jobs and payments separate **Payment Status** from **Work Status** and **Operational Flags**:

- **Payment Request (`PaymentStatusChip`)**:
  - `not_requested` → `Not requested` (neutral, clock)
  - `awaiting_payment` → `Awaiting payment` (warning, clock) — overrides to `Overdue` (danger, alert) when `overdue` prop is true
  - `paid` → `Paid` (success, check)
  - `under_review` → `Under review` (warning, alert)
  - `cancelled` → `Cancelled` (neutral, ban, strikethrough)
  - `refunded` → `Refunded` (danger, refund)
- **Charge Attempt (`AttemptStatusChip`)**:
  - `account_active` → `Account active` (info, clock)
  - `processing` → `Processing` (warning, refresh)
  - `succeeded` → `Succeeded` (success, check)
  - `failed` → `Failed` (danger, x)
  - `expired` → `Expired` (neutral, clock)
  - `superseded` → `Superseded` (neutral, ban)
- **Job Work Status (`JobStatusChip`)**:
  - `awaiting_payment` → `Awaiting payment` (warning, clock)
  - `ready` → `Ready` (info, check)
  - `in_progress` → `In progress` (scheduled, refresh)
  - `completed` → `Completed` (success, shield)
  - `on_hold` → `On hold` (neutral, pause)
  - `cancelled` → `Cancelled` (neutral, ban, strikethrough)
- **Flags (`FlagChip`)**:
  - `at_risk` → `At risk` (warning, alert)
  - `overdue` → `Overdue` (danger, alert)
  - `started_without_payment` → `Started without payment` (warning, info)
  - `deposit_paid` → `Deposit paid` (success, check)

---

## 2. Global Chrome, Shell & Cross-Cutting Overlays

### 2.1 Desktop Sidebar (`src/shell/AppShell.tsx`, `>= 1024px`)
- **Brand Header**: Geometric `<LogoMark tone="dark" />` + workspace `businessName` link navigating to `/app/settings`.
- **Navigation Links**:
  1. `Dashboard` → `/app`
  2. `Queue` → `/app/queue`
  3. `Jobs` → `/app/jobs`
  4. `Payments` → `/app/payments` (displays danger count badge when `needsReview > 0`)
  5. `Clients` → `/app/clients`
  6. `Notifications` → `/app/notifications`
  7. `Settings` → `/app/settings`
- **Collapse Toggle**: Switches sidebar width between `248px` (expanded) and `76px` (collapsed), persisted in `localStorage` key `paidar.sidebar.collapsed`.

### 2.2 Top Header Bar (`src/shell/AppShell.tsx`, `src/shell/AccountMenu.tsx`)
- **Mobile Brand Link (`< 1024px`)**: Links to `/app`.
- **Desktop Page Title (`>= 1024px`)**: Reflects active screen heading.
- **`Test mode` Pill (`GLB-04`)**: Click opens a modal explaining sandbox/test-mode Kora behavior.
- **`New request` Primary CTA (`DSH-02`)**: Navigates directly to `/app/new`.
- **Notification Bell Dropdown (`GLB-05`)**:
  - Badge displays unread/active count from `justPaid` + `needsReview` (capped visually at `99+`).
  - Clicking opens a dropdown showing up to the last 10 events.
  - Controls inside dropdown: **`Mark all read`**, individual notification rows (mark read & navigate to target), and **`View all notifications`** (`/app/notifications`).
  - **Dismissal**: Closes on `Escape` key or outside click.
- **Account Menu (`GLB-06`, `src/shell/AccountMenu.tsx`)**:
  - **Trigger**: Circular avatar button showing the uppercase first letter of `provider.businessName` (`aria-haspopup="menu"`, `aria-expanded`, `aria-controls`).
  - **Menu Panel** (`role="menu"`):
    - Displays business name + `"Signed in"`.
    - **`Settings`** link → `/settings` (redirects to `/app/settings`).
    - **`Sign out`** button → Sets `"Signing out…"` pending state, calls `signOut()` (clears Clerk session + `/api/auth/logout`), and navigates to `/auth`.
  - **Keyboard & Dismissal**: Auto-focuses first menu item on open; closes on route change, outside `pointerdown`, or `Escape` (returns focus to avatar button).

### 2.3 Mobile Bottom Tab Bar & "More" Sheet (`GLB-02`, `< 1024px`)
- **5 Fixed Bottom Items**:
  1. `Home` → `/app`
  2. `Queue` → `/app/queue`
  3. **Raised `+` FAB** → `/app/new`
  4. `Payments` → `/app/payments`
  5. `More` → Opens a slide-up bottom sheet containing links to **`Jobs`** (`/app/jobs`), **`Clients`** (`/app/clients`), **`Notifications`** (`/app/notifications`), **`Settings`** (`/app/settings`), and a **`Log out`** action.

### 2.4 Persistent System Banners (`src/shell/Banners.tsx`)
- **`RiskBanner`**: Appears when provider has at-risk or attention items requiring awareness.
- **`VerifyEmailBanner` (`DSH-12`)**: Warns unverified accounts; includes **Resend verification** button (enforces a **60-second cooldown** after sending) and **Dismiss** button.
- **`ConnectionBanner` (`GLB-15`)**: Monitors browser online/offline state; shows offline warning banner when disconnected and automatically invalidates active queries upon reconnection.
- **`UpdateBanner`**: Shown when a new service worker version is waiting; provides **Reload** button to activate update.

### 2.5 Global Overlays, Pings & Share Dialog
- **Live Paid Ping Toast (`PaidPingLayer`, `GLB-09`, `src/features/ping/PaidPing.tsx`)**:
  - Compares each `useToday()` poll against previously seen `justPaid` IDs (first poll seeds without firing).
  - Up to 3 simultaneous toasts appear (`aria-live="polite"`) and trigger `navigator.vibrate?.(80)`.
  - Each toast displays: `"{FirstName} paid ₦{amount}"` and `"{service} · Ready to start"` (if applicable).
  - **Click toast body**: Dismisses ping and navigates to `/app/payments?tab=received&payment=${ping.id}`.
  - **Click `X` (`aria-label="Dismiss"`)** or **after 8 seconds**: Auto-dismisses.
- **Session Expired Modal (`GLB-16`, `src/shell/SessionExpiredModal.tsx`)**:
  - Opens over current screen on mid-session 401 (`UNAUTH_EVENT`) so form state is not lost. Allows inline `devLogin` / re-authentication.
- **Share Payment Details Dialog (`ShareProvider`, `src/features/share/ShareProvider.tsx`)**:
  - Triggered immediately after creating a payment request or clicking `"Copy details again"` / `"Share"`.
  - **Display**: Generated dedicated virtual bank name, account name, account number, and exact amount.
  - **Itemized Copy Chips**:
    - Copy **Account number** (digits)
    - Copy **Amount** (plain digits without `₦`/commas for bank app paste)
    - Copy **Payment link** (`/pay/:token`)
  - **Full Message Block & Actions**:
    - **`Copy message`**: Copies formatted WhatsApp-ready template message to clipboard (marks copy timestamp).
    - **`Open WhatsApp` (`SHR-06`)**: Launches `wa.me` with prefilled payment instructions.
    - **`Open Telegram`**: Opens Telegram share sheet/URL.
    - **`Preview as your client` (`SHR-09`)**: Opens `/pay/${token}?preview=1` in preview mode.
    - **`I've sent it`** / **`Close`**: Closes the modal and marks the request as communicated.

---

## 3. Public, Auth & Client-Facing Pages

### 3.1 Landing Page (`/`, `src/pages/LandingPage.tsx`, `LND-01`..`LND-17`)
1. **Header**: Brand logo (`/`), **`Log in`** (`/auth`), and **`Get started`** (`/auth` or `/signup`).
2. **Test Mode Notice Banner**: Explains live sandbox/test status.
3. **Hero Section**:
   - **Primary CTA (`Create a payment request`)**: Navigates to `/app/new` if already authenticated, or `/auth` if signed out.
   - **Secondary CTA (`See what your client sees`)**: Opens `/pay/demo` to preview the interactive client checkout flow.
4. **3-Step Explainer Cards**: Visualizes Create Request → Client Pays via Transfer → Verified Auto-Unlock.
5. **Waitlist Form (`POST /api/waitlist`)**:
   - **Email** (required)
   - **WhatsApp number** (optional)
   - **Business type** selector
   - **Submit**: Validates email, submits via API, and shows confirmation or inline error.
6. **5-Item FAQ Accordion**: Expand/collapse individual FAQ items (`aria-expanded` toggles).
7. **Footer**: Navigation links and product notices.

### 3.2 Authentication Suite (`src/pages/AuthPage.tsx`, `src/pages/AuthSuitePages.tsx`)
Uses `AuthSplitShell` (Midnight Navy brand panel on desktop + `420px` white form column):

- **Sign In (`/auth`, `/login`)**:
  - **Token Exchange (`?t=...`)**: Automatically verifies magic/handoff token on mount if present in query string.
  - **Clerk Mode (`VITE_CLERK_PUBLISHABLE_KEY` configured)**: Renders `<SignIn routing="hash" />`.
  - **Dev Quick Presets (`DEV_LOGIN` enabled)**: One-click workspace sign-in preset buttons.
  - **Standard Email/Password Form**:
    - **Email** input
    - **Password** input + **Show/Hide password toggle (`LGN-03`)**
    - **`Keep me signed in` checkbox (`LGN-04`)**
    - **`Forgot password?` link (`LGN-05`)** → `/forgot-password`
    - **Submit (`Sign in`)** + link to `/signup`.
- **Sign Up (`/signup`, `SGN-01`..`SGN-08`)**:
  - **Full name**: 2–80 characters.
  - **Email**: Valid email address.
  - **Password**: Minimum 10 characters with live **Password Strength Meter**.
  - **Terms agreement checkbox**: Must be checked to submit.
  - **Submit**: Creates account and transitions to `/verify-email` or `/onboarding`.
- **Verify Email (`/verify-email`, `VFY-01`..`VFY-05`)**:
  - Supports verification token confirmation and manual actions:
    - **Resend email** button (enforces **60-second cooldown** timer).
    - **`Change email`**: Allows editing target address.
    - **`Skip for now`**: Proceeds into app/onboarding (persistent `VerifyEmailBanner` will remain active until verified).
- **Forgot Password (`/forgot-password`, `FPW-01`..`FPW-04`)**:
  - Email input + **`Send reset link`** submit button → confirmation banner; link back to `/login`.
- **Reset Password (`/reset-password?token=...`, `RPW-01`..`RPW-05`)**:
  - New password input (min 10 chars + strength indicator) + confirm password + **`Reset password`** submit → success state linking to `/login`.

### 3.3 Onboarding Wizard (`/onboarding`, `src/pages/OnboardingPage.tsx`, `ONB-00`..`ONB-16`)
Resumable 3-step setup wizard with header actions **`Save and exit`** and **`Sign out`**, plus clickable completed stepper tabs to jump back:

1. **Step 1 — Business Profile**:
   - **Business name** (`2–40` chars, required): Updates a live Kora account name preview (`Paidar/{BusinessName}`).
   - **WhatsApp / Phone** (optional): Nigerian phone validation.
   - **`Show my number on the payment page` switch**: Controls public visibility of provider phone on `/pay/:token`.
   - **Business type**: Category selector.
   - **Action**: `Continue` → saves Step 1 and advances to Step 2.
2. **Step 2 — Working Hours**:
   - **Quick Presets**: `Mon–Fri`, `Mon–Sat`, `Custom`.
   - **Per-Day Controls (`Mon`–`Sun`)**: Enable/disable toggle + start time & end time pickers.
   - **Validation**: Each active day's shift cannot exceed **16 hours**.
   - **Live Readout**: Calculates total weekly working hours dynamically (used for Queue capacity strip).
   - **Actions**: **`Skip, use defaults`** or **`Continue`** → saves Step 2 and advances to Step 3.
3. **Step 3 — Payment Defaults**:
   - **Default payment rule**: `Full payment upfront` (`FULL`), `Deposit then balance` (`DEPOSIT`), or `Pay on delivery` (`PAY_ON_DELIVERY`).
   - **Deposit percentage slider**: `10%` to `90%` in steps of `5%` (active when Deposit selected).
   - **Fee bearer choice**: Provider (`OWNER`) or Client (`CLIENT`).
   - **Action**: **`Finish setup`** → completes onboarding and routes to `/app`.

### 3.4 Client Public Payment Page (`/pay/:token`, `src/pages/PublicPayPage.tsx`, `PGE-00`)
Public mobile-first bank-transfer checkout page viewed by the end client:

- **Top Context & Preview Modes**:
  - Shows **Test mode** pill when in sandbox.
  - When URL is `/pay/demo` or includes `?preview=1`, renders a **`Preview only`** banner at top.
- **Polling & Focus Recheck**:
  - Automatically polls request status using **adaptive intervals (`5s` / `15s` / `30s`)** and immediately rechecks on window/tab `focus`.
- **Countdown Timer & Accessibility**:
  - Ticks every `1s` until bank account expiry.
  - Screen-reader `aria-live="assertive"` timer announcements fire **strictly at `10:00`, `5:00`, `1:00`, and `0:10`** remaining (preventing per-second announcement spam).
- **Interactive Controls by State**:
  - **Active (`SENT` / `awaiting_payment`)**:
    - **Copy Bank Name / Account Number / Exact Amount** buttons (amount copies as plain digits).
    - **`"I've paid"` claim button** (`POST /p/:token/claim-paid`): Records `customerClaimedPaidAt`, switches UI feedback to payment verification watch, and flags the provider's request card.
    - **`Simulate verified payment` button**: Rendered in `/pay/demo` preview/sandbox mode to demonstrate instant verification transition.
  - **Expired**:
    - **`Generate new account` button**: Requests a fresh virtual account window without leaving the page.
  - **Verified / Paid**:
    - Automatically transitions to a confirmation screen with a button/link to open the **Public Receipt (`/receipt/:token`)**.

### 3.5 Public Printable Receipt (`/receipt/:token`, `src/pages/PublicReceiptPage.tsx`, `RCT-00`)
- **Status Header**: Displays **Verified** or **Refunded** badge alongside provider business name and receipt details.
- **Details Block**: Amount paid (formatted `₦`), client name, service description, payment timestamp localized to **Africa/Lagos** time, and copyable **Kora reference** ID (`Copy reference` button with toast/copied indicator).
- **Actions**:
  - **`Print / Save PDF`**: Calls `window.print()` using print-friendly CSS.
  - **WhatsApp action**: Opens WhatsApp link to share/save receipt or contact the provider.

---

## 4. Authenticated Provider Workspace Pages

### 4.1 Dashboard / Today (`/app`, `src/pages/TodayPage.tsx`, `DSH-01`..`DSH-11`)
- **Header**:
  - Time-aware **Lagos greeting** (`Good morning/afternoon/evening, ...`).
  - **Period Selector**: `This week` (`week`), `This month` (`month`), `Last 30 days` (`30d`), `All time` (`all`).
  - **`New request` CTA** → `/app/new`.
- **4 Clickable KPI Metric Cards (`Blueprint §2.5`)**:
  1. **Payments received** → Navigates to `/app/payments?tab=received`.
  2. **Outstanding payments** (shows unpaid count & open exception count) → Navigates to `/app/payments?tab=awaiting`.
  3. **Active jobs** (shows in-progress & ready counts) → Navigates to `/app/queue`.
  4. **Overdue & at-risk** → Navigates to `/app/queue?filter=risk`.
- **Needs Attention Alert Card** (shown when `needsReview > 0`): Surfaces flagged/unmatched payments with **`Resolve exceptions`** CTA linking directly to `/app/payments?tab=attention`.
- **Onboarding Checklist (`DSH-08`)**: Dismissible first-run setup checklist card (can be replayed later from Settings).
- **Brand-New Empty State**: When zero jobs exist, displays welcoming prompt with primary CTA to create the first request (`/app/new`).
- **7 / 5 Split Action Lists**:
  - **Left Column — `Next up` (Top 5 ready/active jobs)**:
    - Each row links to job detail (`/app/jobs/:id`) and offers an inline **`Start`** quick button for `ready` jobs (immediately transitions `JobWorkStatus` to `in_progress`).
  - **Right Column — `Awaiting payment` (Oldest 5 open payment requests)**:
    - **`Remind`**: Opens WhatsApp (`wa.me`) with reminder text for that client & request.
    - **`Copy`**: Copies client payment link or transfer details directly to clipboard.
    - **`Check`**: Triggers instant payment status poll/query invalidation (`Checking with bank…`).
- **Bottom Section — `Recent verified payments`**:
  - Lists recent confirmed transfers; clicking any row opens `/app/payments?tab=received&payment={id}` with the Payment Detail Drawer pre-opened.

### 4.2 Work Queue & Scheduling (`/app/queue`, `src/pages/QueuePage.tsx`, `QUE-00`..`QUE-15`)
- **Toolbar & Filters**:
  - **`"Why this order?"` Info Popover**: Explains deterministic weighted priority (`0.35 Deadline + 0.25 Payment + 0.15 Client + 0.15 Effort + 0.10 Dependencies`) and greedy working-hours slot allocation with conflict detection.
  - **`At risk / Overdue` Toggle** (synced with `?filter=risk`): Filters list to flagged jobs.
  - **Client Filter Dropdown**: Scopes queue lanes to one client.
- **Clickable Capacity Strip**:
  - Compares committed work hours against configured weekly working hours (`Settings -> Working hours`).
  - Color thresholds:
    - `< 90%` → **Volt** (healthy load)
    - `90%–100%` → **Solar Amber** (near capacity)
    - `> 100%` → **Flare Red** (`"Over by Xh"` warning)
  - Clicking opens an explanation/summary linking directly to **Working hours in Settings** (`/app/settings`).
- **Priority Score & Recommended Schedule (Per Job Card)**:
  - Displays deterministic **`Score XX`** badge alongside **`Suggested: <Window>`** or **`Conflict · <Window>`** indicator.
  - **`Approve schedule`**: Locks in the suggested window as **`Scheduled: <Window>`** (logged on the job timeline).
- **3 Queue Lanes**:
  1. **`In progress`**:
     - **`Mark completed`** → Moves job to `completed`.
     - **`Hold`** → Moves job to `on_hold`.
  2. **`Ready to start`**:
     - **`Start`** → Moves job to `in_progress`.
     - **`Hold`** → Moves job to `on_hold`.
  3. **`Waiting for payment` (Collapsed disclosure by default)**:
     - Expanding lists unpaid jobs waiting on deposit/full payment.
     - **`Mark ready anyway`**: Opens override confirmation dialog requiring a **5–200 character written reason**; submitting unlocks the job into `ready` (and attaches the `Started without payment` flag).

### 4.3 New Payment Request (`/app/new`, `src/pages/NewRequestPage.tsx`, `NEW-00`..`NEW-18`)
- **4 Essential Fields**:
  1. **Client**: Search/autocomplete dropdown of saved clients; typing a new name or phone expands inline **Name / Phone (Nigerian format) / Email (optional)** creation fields.
  2. **Service / Description**: Required textarea (`3–500` chars); reveals live character counter once input reaches **400+ chars**.
  3. **Amount (`₦`)**: Accepts flexible Naira entry (e.g., `15000`, `15k`, `15,000`), bounded between **₦100 and ₦10,000,000**.
  4. **Due date**: Quick-pick chips (**`Today`**, **`Tomorrow`**, **`In 3 days`**, **`Next week`**) + `<input type="date">` + **`No deadline` checkbox**.
- **Collapsible `More details` Disclosure** (open/closed state persisted in `localStorage`):
  - **Job title** (optional short label)
  - **Estimated hours** (`0.5` to `200` hours for Queue capacity planning)
  - **Payment terms** (`Full payment`, `Deposit then balance`, `Pay on delivery`)
  - **Deposit percentage slider** (`10%–90%`, shown for deposit terms)
  - **Fee bearer** (`Provider pays` / `Client adds fee`)
  - **Private notes** (up to `1,000` chars, visible only to provider)
- **Sticky Live Summary Card**: Displays formatted total, fee breakdown, amount due now, balance later, and due date in real time.
- **Validation & Guards**:
  - **Blur-then-change validation**: Fields validate on blur and clear live on edit; submitting an invalid form keeps the submit button clickable, reveals all errors, and scrolls/focuses the first invalid input.
  - **Email verification gate**: If email is unverified when attempting to create/send, opens verification prompt modal before proceeding.
  - **10-minute duplicate guard**: Warns in a confirmation dialog if an identical client + amount request was created within the last 10 minutes (`Create anyway` vs `Cancel`).
  - **Unsaved changes guard (`useUnsavedGuard`)**: Prompts before navigating away with dirty unsaved fields.
- **Completion**: Submitting creates the job + Kora payment request, opens **`ShareDialog` (`ShareProvider`)**, or navigates to the newly created job.

### 4.4 Jobs Master-Detail (`/app/jobs`, `/app/jobs/:id`)
Uses responsive `MasterDetail` layout (split-pane list + detail on wide viewports; stacked navigation on mobile).

#### A. Jobs List (`src/pages/JobsPage.tsx`, `JBL-00`..`JBL-09`)
- **Search Box**: Live filter by customer name, phone, or service/job description.
- **Client Filter Dropdown** & **Sort Selector** (`Due date`, `Newest`, `Amount`).
- **Work Status Chips**: `All`, `Awaiting payment`, `Ready`, `In progress`, `Completed`, `On hold`, `Cancelled`.
- **Risk Toggles**: **`Overdue`** and **`At risk`** filter chips.
- **Responsive List**: Renders a table on desktop and stacked card list (`< 640px`) displaying separate **Payment** and **Work** status chips per job.
- **Pagination**: **`Show more`** button fetches next cursor page.

#### B. Job Detail (`src/pages/JobPage.tsx`, `JBD-00`..`JBD-27`)
- **Top Status & Quick Contact**:
  - Shows separated **Payment Status Chip**, **Job Work Status Chip**, and active **Risk/Flag Chips** (`Overdue`, `At risk`, `Started without payment`, `Deposit paid`).
  - **Client Quick Actions**: **WhatsApp** (`wa.me`) and **Call** (`tel:`) links, plus client link to `/app/clients/:id`.
  - **Payment Progress Bar**: Visual ratio of verified/recorded paid kobo vs total job amount.
- **Context-Sensitive Primary Action Matrix**:
  - Transitions work status (`Start`, `Mark completed`, `Put on hold`, `Resume`), triggers **`Mark ready anyway`** dialog (requires override reason), or opens **`CancelJobDialog`** (`Cancel job` vs `Keep it` — cancels open requests while retaining already verified payments).
  - **`Edit`** link → `/app/jobs/:id/edit` (also supports **`Record a payment`** / `ManualPaymentDialog` for offline cash/external transfers marked *Not verified*).
- **3 URL/Hash Tabs (`#overview`, `#payments`, `#activity`)**:
  1. **`#overview`**: Full description, deadline, estimated hours, private notes, and active `RequestCard` summary.
  2. **`#payments`**: All `RequestCard` items for the job (`src/features/requests/RequestCard.tsx`):
     - `DRAFT`: **`Get payment details`**, **`Remind me later`** (opens `RemindDialog` with Lagos `datetime-local` input defaulting to tomorrow 9:00 AM; schedules Telegram reminder), **`Cancel`**.
     - `SCHEDULED`: Shows reminder time; **`Get payment details`**, **`Cancel`**.
     - `SENT`: Live **`CountdownRing`**, `"created X ago · copied X ago"` status, **`Customer says paid`** amber pill when client clicked `"I've paid"` + **`Check now`** refresh button, **`Copy details again`** (reopens Share Dialog), **`Cancel`**, plus demo-only **`Simulate payment`**, **`Wrong amount (demo)`**, **`Expire now (demo)`**.
     - `EXPIRED`: **`Get new details`** (regenerates a new request).
     - `Cancel this request?` Dialog: **`Cancel request`** (danger) or **`Keep it`**.
  3. **`#activity` (`JobTimeline`)**: Chronological audit trail of status transitions, webhook events, claims, and verified payments with copyable receipt/Kora references.

#### C. Edit Job (`/app/jobs/:id/edit`, `src/pages/EditJobPage.tsx`, `JBE-00`..`JBE-03`)
- **Locked Fields**: Client is always immutable; Amount is locked once any verified payment has been recorded.
- **Editable Fields**: Service/description, deadline/due date, estimated hours, private notes.
- **Guards**: Protected by `useUnsavedGuard`; **`Save changes`** disabled/validated cleanly and returns to `/app/jobs/:id`.

### 4.5 Payments & Needs Attention (`/app/payments`, `src/pages/PaymentsPage.tsx`, `PMT-00`..`PMT-18`, `ATT-00`..`ATT-04`)
- **3 Clickable Summary Cards**:
  1. **Needs attention** → switches to `?tab=attention`
  2. **Awaiting payment** → switches to `?tab=awaiting`
  3. **Verified received** → switches to `?tab=received`
- **4 URL-Synced Tabs (`?tab=`)**: `Needs attention`, `Awaiting`, `Received`, `All`.
- **`Needs attention` Controls**:
  - **`Open` / `Handled` toggle**: Filters unresolved vs already-resolved exceptions (overpayment, underpayment, paid after expiry, paid after cancellation, duplicate payment).
  - **`Resolve` button** on open items → opens **`ResolveDialog` (`src/features/review/ResolveDialog.tsx`)**:
    - Shows exception message & link (`Open the job` → `/jobs/:id`).
    - Radio `ChoiceCards` (`What did you do?`) tailored to `item.kind`.
    - Note textarea (`maxLength={400}`; **required** when choice is `'other'`).
    - If `PAID_AFTER_EXPIRY` and a newer replacement request is still open, offers checkbox **`Cancel the open ₦X request too, since this one was paid`** (checked by default when choosing `'keep'`).
    - **`Resolve`** button disables if `'other'` note is blank; marks resolved and invalidates `today`, `review`, `job`, `jobs`, `search`.
- **Search & Responsive List**: Filter bar + desktop table / mobile card list.
- **Right-Side Payment Detail Drawer (`?payment={id}`)**:
  - Opens from any payment row, Today card, or Live Paid Ping toast; closes via close button or **`Escape`** key.
  - Displays amount, verification badge, copyable **Kora reference**, **5-step payment timeline**, and context actions: **`Check payment now`**, **`Copy payment link`**, **`View receipt`** (`/receipt/:token`), **`Open job`** (`/app/jobs/:id`).

### 4.6 Clients Directory & Detail (`/app/clients`, `/app/clients/:id`)
Uses `MasterDetail` layout.

#### A. Clients List (`src/pages/PeoplePage.tsx`, `src/features/customers/CustomerDialogs.tsx`, `CLT-00`..`CLT-16`)
- **Toolbar**:
  - Search input (name or phone)
  - Sort selector (`Name`, `Recent`, `Outstanding balance`)
  - **`Show archived` toggle** (archived clients render with muted styling)
  - **`Add customer` button** → opens **`AddCustomerDialog`**: Name (`autoFocus`, required), Nigerian Phone (`isValidNgPhone`), saves and opens detail. If phone conflicts (`CONFLICT`), warns with a **`View`** button jumping to existing customer.
  - **`Import CSV` button** → opens **`ImportDialog`**: Paste CSV or pick `.csv` file (max **1 MB**, header `name,phone`), **`Use an example`** button, live client-side line inspection (`inspectCsv`), and post-import summary listing created / skipped / per-line error details with **`Back to the list`**.

#### B. Client Detail (`src/pages/CustomerPage.tsx`)
- **Header & Contact**: Customer name, formatted phone, **`WhatsApp`** & **`Call`** quick-action chips, **`New request`** (pre-fills client in `/app/new?customerId=...`), **`Edit`** (opens `EditCustomerDialog`), and **`Archive`** / restore action.
- **3-Stat Row**: Total billed/paid, open/outstanding balance, and total jobs count.
- **Tabs**: **`Jobs`** (client's jobs list linking to `/app/jobs/:id`) and **`Activity`** (payment/request history).

### 4.7 Notifications Center (`/app/notifications`, `src/pages/NotificationsPage.tsx`, `NTF-00`..`NTF-06`)
- **Filter Tabs**: **`All`** vs **`Unread`**.
- **Bulk Action**: **`Mark all read`** button clears unread dots across all notifications.
- **Notification Items**: Unread items show a visual unread indicator dot and bold title; clicking marks the notification read and deep-links to the relevant job, payment drawer (`?payment=...`), or review item.

### 4.8 Settings (`/app/settings`, `src/pages/SettingsPage.tsx`, `SET-00`..`SET-25`)
Organized into **9 interactive sections**:

1. **Business profile**: Edit business name (live Kora display preview), WhatsApp phone, **`Show my number on the payment page`** switch, plus read-only Currency (`NGN`) and Timezone (`Africa/Lagos`).
2. **Theme & visual effects**: Switch default Obsidian theme (`Obsidian`, `Daylight`, `System`) and ambient FX tier (`Auto`, `Full`, `Lite`, `Minimal`).
3. **Working hours**: Mon–Sun active toggles and shift start/end times (persisted cleanly and powering Queue capacity & greedy schedule recommendations).
4. **Payment defaults**: Default payment rule (`FULL`/`DEPOSIT`/`PAY_ON_DELIVERY`), deposit % slider (`10–90%`), fee bearer, Ready-to-start rule, confirm-before-clock switch, and customizable **WhatsApp message template** featuring clickable variable insertion chips (`{client}`, `{amount}`, `{link}`, etc.) with `{link}` validation.
5. **Notifications & audio**: Locked in-app paid alert toggle (always enabled for transaction safety), Paid Ping sound profile (`Subtle Bell`, `Deep Drum`, `Silent`), due-soon reminder selector, and daily summary digest preference.
6. **Kora connection**: Displays integration status, copyable **Webhook URL** button, secondary **Telegram alert link**, API/theme diagnostics panel, and a disabled **`Switch to live`** control in test mode.
7. **Account & security**: **`Log out of all devices`** button revoking all active sessions.
8. **Data**: **`Remove sample data`** (purges seeded demo jobs/customers) and **`Replay first-run checklist`** (restores Dashboard `DSH-08` checklist).
9. **Danger zone**: **`Delete account`** button opening an explicit confirmation dialog requiring typing **`DELETE`** verbatim to confirm deletion.

### 4.9 Search & CSV Export (`/search`, `src/pages/SearchPage.tsx`, `src/features/search/ExportDialog.tsx`)
All search state is synchronized directly to URL query parameters (`?q=`, `?view=`, `?status=`, `?from=`, `?to=`):

- **Smart Search Field**: Debounced (`300ms`) input supporting natural queries (names, phone numbers, amounts like `25k`). Displays a `"Looking for"` badge bar (`interpreted` text, phone, or `₦` amount).
- **Saved Views Tabs**: `Everything`, `Unpaid balances`, `This week`, `Needs follow-up`.
- **Multi-Select Status Chips**: `Paid`, `Waiting`, `Balance due`, `Expired`, `Needs review` (`MultiChips`).
- **Date Range Disclosure (`Dates`)**: Collapsible `From` / `To` date pickers with cross-min/max constraints.
- **`Clear all`**: Resets text and clears all URL params.
- **`Export CSV` (`ExportDialog`)**:
  - Defaults `From` to first day of current Lagos month and `To` to today (max today).
  - Validates `From <= To`.
  - **`Download CSV`** exports accountant-ready per-payment CSV (`saveBlob`) and displays success toast.
- **Results List**: `JobRow` + `JobFollowUp` actions per match + **`Show more`** infinite cursor button.

---

## 5. Error, Maintenance & Dev Pages

- **Not Found (`/404`, `*`, `src/pages/NotFoundPage.tsx`)**: Explains missing route and provides navigation back to `/app` or `/`.
- **Server Error (`/500`, `src/pages/SystemPages.tsx`)**: Shows error screen with support **Error ID** and **`Reload`** recovery action.
- **Maintenance (`/maintenance`, `src/pages/SystemPages.tsx`)**: Friendly scheduled maintenance notice when service is temporarily unavailable.
- **UI Kit (`/kit`, `src/pages/KitPage.tsx`)**: Development-only design system preview of tokens, buttons, chips, cards, and inputs.

---

## 6. Master End-to-End Lifecycle & Accessibility Summary

### 6.1 Primary Happy Path (Provider → Client → Provider)
```
1. Landing (/) or Sign In (/auth)
   └─► New user completes 3-step Onboarding (/onboarding) → arrives at Dashboard (/app)
2. Create Request (/app/new)
   └─► Pick/add client + description + ₦100–₦10M + due date → submits & generates Kora VA
3. Share Details (ShareDialog overlay)
   └─► Provider taps "Open WhatsApp" or "Copy message" → taps "I've sent it"
4. Client Pays (/pay/:token)
   └─► Client copies plain-digit amount & VA number → transfers in bank app → optionally taps "I've paid"
   └─► Adaptive polling (5s/15s/30s + tab focus) detects Kora webhook verification → transitions to Receipt (/receipt/:token)
5. Live Fulfillment Loop (Dashboard / Queue / Payments)
   └─► PaidPingLayer fires 8s toast ("{FirstName} paid ₦X · Ready to start") anywhere in app
   └─► Job automatically flips Payment = Paid & Work = Ready → appears in /app "Next up" & /app/queue "Ready to start"
   └─► Provider clicks Start → In progress → Mark completed
   └─► If payment arrived after expiry, underpaid, or while cancelled → Payment = Under review → resolves in /app/payments?tab=attention
```

### 6.2 Global Keyboard, Focus & Safeguards
- **`Escape`**: Closes open modals (`Dialog`), Payment Detail Drawer, Notification Bell dropdown, Account Menu (returning focus to avatar button), and mobile More sheet.
- **Accessible Live Regions**:
  - Public Pay Countdown announces only at **`10:00`**, **`5:00`**, **`1:00`**, and **`0:10`** via `aria-live="assertive"`.
  - Live payment arrival toasts use `aria-live="polite"`.
- **Unsaved Data Protection**: `NewRequestPage` and `EditJobPage` attach `useUnsavedGuard` to warn before accidental navigation; mid-session 401 errors trigger `SessionExpiredModal` without clearing in-progress form state.
