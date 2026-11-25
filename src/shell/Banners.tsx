import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RELEASE_RISKS } from '../config';
import { getPendingVerificationEmail, setPendingVerificationEmail } from '../lib/emailVerify';
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
  return (
    <Banner tone="warn" data-flow-id="GLB-15">
      You’re offline. Changes won’t save until you reconnect.
    </Banner>
  );
}

/** Persistent email verification soft-gate reminder (VFY-05 / DSH-12). */
export function VerifyEmailBanner() {
  const toast = useToast();
  const [pendingEmail, setPendingEmail] = useState<string | null>(() => getPendingVerificationEmail());
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!pendingEmail) return null;

  function resend() {
    setCooldown(60);
    toast.success(`Verification link resent to ${pendingEmail}`);
  }

  function markVerifiedDemo() {
    setPendingVerificationEmail(null);
    setPendingEmail(null);
    toast.success('Email verified.');
  }

  return (
    <Banner
      tone="info"
      data-flow-id="DSH-12"
      action={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="line" disabled={cooldown > 0} onClick={resend}>
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
          </Button>
          <Button variant="line" onClick={markVerifiedDemo}>
            Dismiss
          </Button>
        </div>
      }
    >
      Verify your email ({pendingEmail}) to create payment links.
    </Banner>
  );
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
