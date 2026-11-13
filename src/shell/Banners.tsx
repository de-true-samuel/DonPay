import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RELEASE_RISKS } from '../config';
import { useOnline } from '../lib/online';
import { useServiceWorkerUpdate } from '../pwa/usePwa';
import { Banner, Button } from '../ui/primitives';
import { useToast } from '../ui/Toast';

/** Offline notice, and a refresh of everything the moment the connection comes back. */
export function ConnectionBanner() {
  const online = useOnline();
  const qc = useQueryClient();
  const toast = useToast();
  const was = useRef(true);
  useEffect(() => {
    if (online && !was.current) { toast.success('Back online. Refreshing…'); void qc.invalidateQueries(); }
    was.current = online;
  }, [online, qc, toast]);
  if (online) return null;
  return <Banner tone="warn">You’re offline. What’s on screen may be out of date. New actions won’t work until you reconnect.</Banner>;
}

export function UpdateBanner() {
  const { available, apply } = useServiceWorkerUpdate();
  if (!available) return null;
  return <Banner action={<Button variant="line" onClick={apply}>Reload</Button>}>A new version of Paidar is ready.</Banner>;
}

/** A loud warning if a release was built with demo or developer switches on. */
export function RiskBanner() {
  if (!RELEASE_RISKS.length) return null;
  return <Banner tone="bad">Not safe for real use. {RELEASE_RISKS.join(' ')}</Banner>;
}
