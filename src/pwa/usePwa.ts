import { useCallback, useEffect, useReducer, useState } from 'react';
import { SW_UPDATE_EVENT } from './register';

/* ---- install prompt (Chrome / Edge / Android). The event fires once, early, so it is captured at module load. ---- */
interface InstallEvent extends Event { prompt: () => Promise<void> }
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
}

export function useInstall() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const prompt = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    deferred = null;
    notify();
  }, []);
  return { canPrompt: !!deferred && !standalone, standalone, iosHint: ios && !standalone, prompt };
}

/* ---- update available ---- */
export function useServiceWorkerUpdate() {
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);
  useEffect(() => {
    const on = (e: Event) => setReg((e as CustomEvent<ServiceWorkerRegistration>).detail);
    window.addEventListener(SW_UPDATE_EVENT, on);
    return () => window.removeEventListener(SW_UPDATE_EVENT, on);
  }, []);
  const apply = useCallback(() => {
    if (!reg?.waiting) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  }, [reg]);
  return { available: !!reg, apply };
}
