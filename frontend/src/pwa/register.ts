export const SW_UPDATE_EVENT = 'paidar:sw-update';

/**
 * Production only. In development any old worker is removed so stale files never hide your changes.
 * A new version waits until the person taps "Reload" (see usePwa), so a payment form is never reloaded under them.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) {
    void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister()));
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
      const announce = () => { if (reg.waiting && navigator.serviceWorker.controller) window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT, { detail: reg })); };
      announce();
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed') announce(); });
      });
    }).catch(() => { /* the app works without it */ });
  });
}
