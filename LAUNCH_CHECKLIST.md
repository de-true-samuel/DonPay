# Paidar web: launch checklist

Work through this top to bottom before real customers use it. Tick each line.

## 1. Build the right thing
- [ ] `npm install`, then `npm run typecheck && npm test && npm run build` all pass.
- [ ] The build was made **without** `VITE_MOCK=true`, `VITE_DEV_LOGIN=true` or `VITE_SIMULATE_PAYMENTS=true`. If any is on, the app shows a red "Not safe for real use" banner. Treat that banner as a failed build.
- [ ] `VITE_API_URL` is set to the real API origin, **or** left empty because a reverse proxy serves `/api` on the same origin.
- [ ] `VITE_TELEGRAM_BOT_URL` points at your real bot.
- [ ] The backend's contract version matches the one in Settings → About (currently 1.0.0).

## 2. Cookies and CORS (the part that most often goes wrong)
The session is a cookie (`ke_session`), and the backend allows exactly **one** frontend origin with credentials. Pick one setup:

| Setup | How | Notes |
|---|---|---|
| **A. One origin (best)** | Host the frontend and proxy `/api` to the backend on the same domain (e.g. `https://app.example.com`). Leave `VITE_API_URL` empty. | No CORS, no third-party-cookie problems. In dev: `VITE_DEV_PROXY=http://127.0.0.1:8790` and `VITE_MOCK=false`. |
| **B. Sibling subdomains** | `https://app.example.com` and `https://api.example.com`, same registrable domain. Set `VITE_API_URL=https://api.example.com`. | Backend `FRONTEND_ORIGIN=https://app.example.com`; cookie must be `Secure` and `SameSite=Lax` or `None`. |
| **C. Unrelated domains** | Frontend on one domain, API on another. | Not recommended. Browsers block or restrict cross-site cookies, so people get signed out. |

- [ ] HTTPS everywhere.
- [ ] After signing in, the browser's dev tools show a `ke_session` cookie, and `GET /api/me` returns 200 after a refresh.
- [ ] A request to `/api/*` from another origin is rejected (CORS is not wide open).
- [ ] Every non-GET call carries `X-Requested-With: kobo-exact` (the client does this; don't rename it without the backend).

## 3. Hosting
- [ ] The host serves `index.html` for unknown paths (single-page app). `public/_redirects` does this on Netlify and Cloudflare Pages; on Vercel use a rewrite of `/(.*)` to `/index.html`.
- [ ] `/sw.js` and `/index.html` are served with `Cache-Control: no-cache` (so a new release is picked up). Files under `/assets/` can be cached for a year (their names change on every build).
- [ ] `/manifest.webmanifest` and `/icons/*` load (no 404s in the Network tab).
- [ ] Suggested security headers (adjust `connect-src` to your API origin, then test every screen):
  `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://api.example.com; manifest-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'`
  plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.

## 4. Sign-in and messaging
- [ ] `/login` in the real Telegram bot gives a link to `https://YOUR-APP/auth?t=…` and it signs you in once. Opening the same link again shows "expired or already used".
- [ ] The bot sends payment pings and the evening summary.
- [ ] Share sheet: WhatsApp and Telegram buttons open with the right customer and the exact message.

## 5. Kora (backend side, but check from the app)
- [ ] The bank-transfer API is enabled on the live Kora account (Kora enables it on request).
- [ ] One real ₦-small payment end to end: create → send → pay from a real bank app → the ping arrives → job shows Ready to start → receipt message works.
- [ ] A **short** payment is reversed by Kora and the request stays open; an expired account can't be paid and **Send again** makes a new one.
- [ ] No "Simulate payment" or "Expire now" buttons anywhere.

## 6. Devices and browsers
- [ ] Android Chrome (a mid-range phone on mobile data), iPhone Safari, desktop Chrome and Edge.
- [ ] Install to the home screen works (Android: Install button in Settings; iPhone: Share → Add to Home Screen).
- [ ] Offline: turn on airplane mode, open the app. You see the offline banner and the last screen, not a blank page.
- [ ] Dark mode and Light mode both readable, outdoors brightness included.
- [ ] Zoom to 200% and text size "large": nothing is cut off.
- [ ] Keyboard only: you can create a request, share it, and sign out. Focus is always visible.
- [ ] Screen reader (TalkBack or VoiceOver) reads status labels, not just colours.

## 7. Speed (run on the built app: `npm run build && npm run preview`)
- [ ] Lighthouse (mobile, Slow 4G) on `/auth` and `/today`: Performance 90+, Accessibility 95+, PWA installable.
- [ ] The first-load JavaScript is small (the build prints chunk sizes; the entry chunk should be well under 300 kB before compression). If it isn't, tell the developer which chunk is large.

## 8. Day-one safety net
- [ ] You know how to roll back: redeploy the previous build. Because pages load from the network first, people get it on their next visit.
- [ ] Someone watches the first real payments live.
- [ ] A way for customers and providers to reach you when something looks wrong.

## Known limits
- Onboarding completion is remembered per device (the contract has no flag for it).
- The service worker keeps the app shell and static files only. It never stores payments, customers or any API data.
- The evening summary, payment pings and reminders come from the Telegram bot, not from this app. The app can't send push notifications on its own.
