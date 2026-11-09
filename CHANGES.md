# Phase 5: polish and launch readiness

Copy this folder's contents over `frontend/` and allow overwrites. **No new packages**, so `npm install` is not needed again.
Run `npm test` (one new test file, theme). **Restart `npm run dev`** because `vite.config.ts` and `index.html` changed.

## Behaviour changes to know about
- **The mock API is now on by default only in development.** In a production build it is off unless `VITE_MOCK=true`.
  If you relied on running the production build with no backend, set `VITE_MOCK=true` (a red warning banner will remind you it's demo data).
- If your `.env` has `VITE_API_URL` set and `VITE_MOCK=false`, nothing changes for you.
- New optional `.env` setting: `VITE_DEV_PROXY=http://127.0.0.1:8790` (forwards `/api`; see README).

## New files
public/manifest.webmanifest, sw.js, theme-init.js, _redirects
public/icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
src/lib/online.ts
src/pwa/register.ts, usePwa.ts
src/shell/Banners.tsx, MasterDetail.tsx
src/styles/dark.css, phase5.css
src/theme/theme.ts, theme.test.ts
src/ui/ErrorBoundary.tsx
LAUNCH_CHECKLIST.md

## Changed files
index.html, vite.config.ts, package.json (version), .env.example, README.md
src/App.tsx             (lazy-loaded screens, list + detail routes, error boundary, offline-friendly query settings)
src/main.tsx            (theme, service worker, new styles)
src/config.ts           (mock off in production; release-risk warnings)
src/auth/AuthProvider.tsx, guards.tsx (session-expiry flag; return to the page you were on)
src/pages/AuthPage.tsx  (session-ended banner, return path, risk banner)
src/pages/SettingsPage.tsx (appearance, install, about, review link)
src/pages/PeoplePage.tsx, src/features/jobs/JobRow.tsx (highlight the open item)
src/shell/AppShell.tsx  (left rail on wide screens, skip link, focus on navigation, banners)
src/styles/tokens.css, ui.css, pages.css, phase2.css, phase3.css, phase4.css (theme tokens; 44 px touch targets)

## Removed
nothing
