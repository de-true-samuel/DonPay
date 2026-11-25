import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { publicApi } from '../api/endpoints';
import type { PublicRequest } from '../contract/contract';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { formatTime } from '../lib/time';
import { Icon } from '../ui/Icon';
import { LogoMark } from '../ui/Logo';

const DEMO_REQUEST: PublicRequest = {
  status: 'SENT',
  serverNow: new Date().toISOString(),
  businessPhone: '+2348031234567',
  amountPlain: '₦25,000',
  businessName: "Tolu's Glam Studio",
  customerFirstName: 'Ada',
  service: 'Bridal makeup & hair styling (Demo)',
  kind: 'FULL',
  amountKobo: '2500000',
  bankName: 'Wema Bank (Test)',
  accountNumber: '9012345678',
  accountName: "Tolu's Glam Studio",
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  paidAt: null,
  customerClaimedPaidAt: null,
  receipt: null,
};

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export function PublicPayPage() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const isDemo = token === 'demo';
  const isPreview = isDemo || params.get('preview') === '1';
  const qc = useQueryClient();

  const [demoPaid, setDemoPaid] = useState(false);
  const [demoClaimed, setDemoClaimed] = useState(false);
  const [copiedAcct, setCopiedAcct] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState('');
  const mountMs = useRef(Date.now());
  const announcedMilestones = useRef(new Set<number>());

  const { data: liveReq, isLoading, isError, refetch } = useQuery({
    queryKey: ['public-pay', token],
    queryFn: () => publicApi.getRequest(token),
    enabled: !!token && !isDemo,
    retry: false,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.status === 'PAID' || d.status === 'CANCELLED') return false;
      const elapsed = Date.now() - mountMs.current;
      if (elapsed > 10 * 60_000) return 30_000; // Backoff after 10 minutes
      return d.status === 'SENT' ? 5_000 : 15_000;
    },
  });

  const req: PublicRequest | undefined = isDemo
    ? {
        ...DEMO_REQUEST,
        status: demoPaid ? 'PAID' : 'SENT',
        paidAt: demoPaid ? new Date().toISOString() : null,
        customerClaimedPaidAt: demoClaimed ? new Date().toISOString() : null,
      }
    : liveReq;

  useDocumentTitle(req ? `Pay ${req.businessName}` : 'Payment request');

  // Tick 1s for countdown display & milestone announcements (10:00, 5:00, 1:00, 0:10 only)
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = req?.expiresAt ? Date.parse(req.expiresAt) - nowMs : 0;

  useEffect(() => {
    if (!req?.expiresAt || req.status !== 'SENT') return;
    const secs = Math.floor(remainingMs / 1000);
    for (const milestone of [600, 300, 60, 10]) {
      if (secs <= milestone && secs > milestone - 2 && !announcedMilestones.current.has(milestone)) {
        announcedMilestones.current.add(milestone);
        const label = milestone >= 60 ? `${milestone / 60} minute${milestone === 60 ? '' : 's'}` : '10 seconds';
        setAnnouncement(`Account instructions expire in ${label}.`);
      }
    }
  }, [remainingMs, req?.expiresAt, req?.status]);

  // Immediate recheck on tab regaining focus (Flow §2.4)
  useEffect(() => {
    if (isDemo) return;
    const onFocus = () => { void refetch(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isDemo, refetch]);

  const claimMut = useMutation({
    mutationFn: async () => {
      if (isDemo) {
        setDemoClaimed(true);
        return { ok: true };
      }
      const res = await publicApi.claimPaid(token);
      await refetch();
      return res;
    },
  });

  const attemptMut = useMutation({
    mutationFn: () => publicApi.createAttempt(token),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['public-pay', token] });
      void refetch();
    },
  });

  async function copyAccount(acct: string) {
    try {
      await navigator.clipboard.writeText(acct);
      setCopiedAcct(true);
      setAnnouncement('Account number copied.');
      setTimeout(() => setCopiedAcct(false), 2000);
    } catch { /* ignore */ }
  }

  const rawStatus = req?.status as string | undefined;
  const isExpired = rawStatus === 'EXPIRED' || (rawStatus === 'SENT' && !!req?.expiresAt && remainingMs <= 0);
  const isNotReady = rawStatus === 'DRAFT' || rawStatus === 'SCHEDULED' || rawStatus === 'NOT_REQUESTED';
  const isPaid = rawStatus === 'PAID';
  const isCancelled = rawStatus === 'CANCELLED' || rawStatus === 'REFUNDED';
  const isProcessing = !isPaid && !isExpired && !isCancelled && !!req?.customerClaimedPaidAt;

  return (
    <main
      style={{
        minHeight: '100dvh',
        background: 'var(--bg-canvas)',
        padding: '20px 16px 48px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
      data-flow-id="PGE-00"
    >
      {/* Screen-reader assertive status announcements */}
      <div className="pd-sr-only" aria-live="assertive" aria-atomic="true">
        {announcement}
        {isPaid ? 'Payment verified.' : ''}
      </div>

      <div style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Header bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--nav-bg)', fontWeight: 700, fontSize: 17 }}>
            <LogoMark size={24} />
            <span>paidar</span>
          </div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
            background: 'var(--status-warning-tint)', color: 'var(--status-warning)', border: '1px solid #F3D19E',
          }}>
            <Icon name="flask" size={14} />
            Test mode
          </span>
        </div>

        {/* Preview-only warning banner (Spec §9.6) */}
        {isPreview && (
          <div
            role="note"
            style={{
              padding: '10px 14px', borderRadius: 9,
              background: 'var(--status-info-tint)', color: 'var(--status-info)',
              fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <Icon name="info" size={16} />
            <span>Preview only. Nothing is charged.</span>
          </div>
        )}

        {isLoading && (
          <div style={{ background: '#FFFFFF', borderRadius: 14, padding: 24, border: '1px solid var(--border-default)' }}>
            <p style={{ color: 'var(--text-secondary)' }}>Loading payment details…</p>
          </div>
        )}

        {isError && (
          <div style={{ background: '#FFFFFF', borderRadius: 14, padding: 24, border: '1px solid var(--border-default)' }}>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Payment link not found</h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              This link may be invalid or no longer available. Please ask the business for an updated payment link.
            </p>
          </div>
        )}

        {req && (
          <section
            style={{
              background: '#FFFFFF',
              borderRadius: 14,
              padding: 22,
              border: '1px solid var(--border-default)',
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
            }}
          >
            {/* Business & Amount Header */}
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                Payment request from <strong style={{ color: 'var(--text-primary)' }}>{req.businessName}</strong>
              </p>
              <h1 style={{ fontSize: 34, lineHeight: '40px', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                {formatNaira(req.amountKobo)}
              </h1>
              <p style={{ color: 'var(--text-secondary)', marginTop: 6, fontSize: 14 }}>{req.service}</p>
            </div>

            {/* State: Paid / Verified */}
            {isPaid && (
              <div
                style={{
                  background: 'var(--status-success-tint)',
                  borderRadius: 12,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--status-success)', fontWeight: 700, fontSize: 16 }}>
                  <Icon name="shield" size={20} />
                  <span>Payment verified</span>
                </div>
                <p style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>
                  Confirmed through the payment provider’s transaction records{req.paidAt ? ` on ${formatTime(req.paidAt)}` : ''}.
                </p>
                <Link
                  to={`/receipt/${token}`}
                  style={{
                    height: 44, borderRadius: 9, background: 'var(--status-success)', color: '#FFFFFF',
                    textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <Icon name="external" size={16} />
                  <span>View verified receipt</span>
                </Link>
              </div>
            )}

            {/* State: Not Ready */}
            {isNotReady && (
              <div style={{ background: 'var(--bg-surface-subtle)', borderRadius: 12, padding: 16, border: '1px solid var(--border-default)' }}>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>Not ready for payment yet</p>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
                  {req.businessName} hasn’t released this payment request yet. Check back when they send you the link.
                </p>
              </div>
            )}

            {/* State: Cancelled / Refunded */}
            {isCancelled && (
              <div style={{ background: 'var(--status-neutral-tint)', borderRadius: 12, padding: 16 }}>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>Payment request closed</p>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
                  This payment request is no longer active. Do not transfer to any previous account details.
                </p>
              </div>
            )}

            {/* State: Expired Attempt (Request stays open) */}
            {!isPaid && !isCancelled && !isNotReady && isExpired && (
              <div style={{ background: 'var(--status-warning-tint)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ fontWeight: 600, color: 'var(--status-warning)' }}>Temporary account expired</p>
                <p style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>
                  Your payment request remains open. Generate a fresh bank account below before transferring.
                </p>
                {!isPreview && (
                  <button
                    type="button"
                    disabled={attemptMut.isPending}
                    onClick={() => attemptMut.mutate()}
                    style={{
                      height: 44, borderRadius: 9, border: 0, background: 'var(--action-primary)',
                      color: '#FFFFFF', fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {attemptMut.isPending ? 'Generating…' : 'Generate new account'}
                  </button>
                )}
              </div>
            )}

            {/* State: Active Kora Account Attempt */}
            {!isPaid && !isCancelled && !isNotReady && !isExpired && req.accountNumber && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {isProcessing && (
                  <div style={{ background: 'var(--status-info-tint)', color: 'var(--status-info)', padding: '12px 14px', borderRadius: 9, fontSize: 13.5, fontWeight: 600 }}>
                    We’re checking the payment with the payment provider. This usually takes a moment.
                  </div>
                )}

                <div style={{ background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-default)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Bank name</div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{req.bankName ?? '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Account name</div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{req.accountName ?? req.businessName}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Account number</div>
                      <div className="pd-mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '0.04em' }}>
                        {req.accountNumber}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyAccount(req.accountNumber!)}
                      style={{
                        minHeight: 44, padding: '0 14px', borderRadius: 9, border: '1px solid var(--border-strong)',
                        background: '#FFFFFF', color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      <Icon name={copiedAcct ? 'check' : 'copy'} size={16} />
                      <span>{copiedAcct ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                {req.expiresAt && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: '18px' }}>
                    Payment instructions expire in <strong className="pd-mono">{formatCountdown(remainingMs)}</strong>. Your payment request remains open. You can generate another set of instructions if this attempt expires.
                  </p>
                )}

                <button
                  type="button"
                  disabled={claimMut.isPending}
                  onClick={() => claimMut.mutate()}
                  style={{
                    width: '100%', height: 48, borderRadius: 9, border: 0,
                    background: 'var(--action-primary)', color: '#FFFFFF', fontSize: 15, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {claimMut.isPending ? 'Checking status…' : "I've paid"}
                </button>

                {isDemo && (
                  <button
                    type="button"
                    onClick={() => setDemoPaid(true)}
                    style={{
                      width: '100%', height: 44, borderRadius: 9,
                      border: '1px dashed var(--border-strong)', background: '#FFFFFF',
                      color: 'var(--text-secondary)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    Simulate verified payment (Demo only)
                  </button>
                )}
              </div>
            )}

            {/* Contact business footer */}
            {req.businessPhone && (
              <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Questions for {req.businessName}?</span>
                <a
                  href={`https://wa.me/${req.businessPhone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontWeight: 600, textDecoration: 'none' }}
                >
                  Message on WhatsApp
                </a>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
