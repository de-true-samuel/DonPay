/*
 * Paidar service worker: keeps the app shell and static files available offline.
 * It NEVER caches API traffic or customer payment pages: money data is always live or not shown.
 * Pages open from the network first, so a new release is picked up on the next visit.
 */
const VERSION = 'paidar-v5';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks for the update to take over only when the person taps "Reload".
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

const isFontHost = (u) => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/p/') || url.pathname.startsWith('/receipt/')) return;
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !isFontHost(url)) return; // other origins (including a separate API host) are untouched

  if (req.mode === 'navigate') { event.respondWith(shellFirstFromNetwork(req)); return; }
  if (isFontHost(url) || url.pathname.startsWith('/assets/') || /\.(?:png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function shellFirstFromNetwork(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('/index.html', res.clone()); // one shared shell, never URLs that carry sign-in tokens
    return res;
  } catch {
    return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req);
  const fresh = fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  }).catch(() => undefined);
  return cached || (await fresh) || Response.error();
}
