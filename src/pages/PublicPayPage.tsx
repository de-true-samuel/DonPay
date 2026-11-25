import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { publicApi } from '../api/endpoints';
import type { PublicRequest } from '../contract/contract';
import { hapticClaim } from '../lib/feedback';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira, toBig } from '../lib/money';
import { formatTime } from '../lib/time';
import { CopyChip } from '../ui/CopyChip';
import { CountdownRing } from '../ui/CountdownRing';
import { Icon } from '../ui/Icon';
import { LogoMark } from '../ui/Logo';
import { Money } from '../ui/Money';
import { Status } from '../ui/StatusChip';
import { TicketCard } from '../ui/TicketCard';

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
      hapticClaim();
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

  const rawStatus = req?.status as string | undefined;
  const isExpired = rawStatus === 'EXPIRED' || (rawStatus === 'SENT' && !!req?.expiresAt && remainingMs <= 0);
  const isNotReady = rawStatus === 'DRAFT' || rawStatus === 'SCHEDULED' || rawStatus === 'NOT_REQUESTED';
  const isPaid = rawStatus === 'PAID';
  const isCancelled = rawStatus === 'CANCELLED' || rawStatus === 'REFUNDED';
  const isProcessing = !isPaid && !isExpired && !isCancelled && !!req?.customerClaimedPaidAt;

  const plainDigits = req ? (toBig(req.amountKobo) / 100n).toString() : '';
  const sentIso = req?.expiresAt ? new Date(Date.parse(req.expiresAt) - 60 * 60_000).toISOString() : new Date().toISOString();

  return (
    <main
      style={{
        minHeight: '100dvh',
        padding: '20px 16px 48px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
      data-flow-id="PGE-00"
    >
      {/* Screen-reader assertive timer announcements & polite live verification */}
      <div className="pd-sr-only" aria-live="assertive" aria-atomic="true">
        {announcement}
      </div>
      <div className="pd-sr-only" aria-live="polite" aria-atomic="true">
        {isPaid ? `Payment of ${formatNaira(req?.amountKobo ?? '0')} verified.` : ''}
      </div>

      <div style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Lean Customer Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-1)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '-0.03em' }}>
            <LogoMark size={24} />
            <span>paidar</span>
          </div>
          <span className="ob-status ob-status--solar" style={{ borderRadius: 'var(--r-pill)', fontSize: 12 }}>
            <Icon name="flask" size={14} />
            <span>Test mode</span>
          </span>
        </div>

        {/* Preview-only banner (Spec §9.6) */}
        {isPreview && (
          <div role="note" className="ob-status ob-status--ion" style={{ width: '100%', padding: '10px 14px', borderRadius: 'var(--r-md)' }}>
            <Icon name="info" size={16} />
            <span>Preview only. Nothing is charged.</span>
          </div>
        )}

        {isLoading && (
          <div className="ob-tile" style={{ padding: 24 }}>
            <p style={{ color: 'var(--ink-2)' }}>Loading payment details…</p>
          </div>
        )}

        {isError && (
          <div className="ob-tile" style={{ padding: 24 }}>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Payment link not found</h1>
            <p style={{ color: 'var(--ink-2)' }}>
              This link may be invalid or no longer available. Please ask the business for an updated payment link.
            </p>
          </div>
        )}

        {req && (
          <TicketCard
            hero={!isExpired && !isCancelled && !isNotReady}
            state={
              isPaid
                ? 'paid'
                : isCancelled
                  ? 'cancelled'
                  : isExpired
                    ? 'expired'
                    : isNotReady
                      ? 'draft'
                      : isProcessing
                        ? 'claims'
                        : 'waiting'
            }
            stamp={isPaid ? 'PAID' : isExpired ? 'EXPIRED' : isCancelled ? 'CANCELLED' : undefined}
            title={req.businessName}
            subtitle={`${req.customerFirstName ? `For ${req.customerFirstName} · ` : ''}${req.service}`}
            amountKobo={req.amountKobo}
            aside={
              !isPaid && !isCancelled && !isNotReady && !isExpired && req.expiresAt ? (
                <CountdownRing sentAt={sentIso} expiresAt={req.expiresAt} size="md" />
              ) : undefined
            }
            status={
              isPaid ? (
                <Status tone="mint" icon="shield" label="Verified" />
              ) : isCancelled ? (
                <Status tone="slate" icon="x-circle" label="Closed" struck />
              ) : isExpired ? (
                <Status tone="slate" icon="minus-circle" label="Expired" />
              ) : isNotReady ? (
                <Status tone="slate" icon="minus-circle" label="Not ready" />
              ) : isProcessing ? (
                <Status tone="solar" icon="radar" label="Checking bank" pulse />
              ) : (
                <Status tone="ion" icon="zap" label="Account active" />
              )
            }
            footer={
              req.businessPhone ? (
                <div style={{ borderTop: '1px solid var(--line-1)', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                  <span style={{ color: 'var(--ink-3)' }}>Questions for {req.businessName}?</span>
                  <a
                    href={`https://wa.me/${req.businessPhone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontWeight: 600 }}
                  >
                    Message on WhatsApp
                  </a>
                </div>
              ) : undefined
            }
          >
            <div style={{ padding: '0 22px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Paid State */}
              {isPaid && (
                <div style={{ background: 'var(--mint-bg)', border: '1px solid var(--mint-bd)', borderRadius: 'var(--r-md)', padding: 16, display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--mint-ink)', fontWeight: 700, fontSize: 15 }}>
                    <Icon name="shield" size={20} />
                    <span>Payment verified</span>
                  </div>
                  <p style={{ fontSize: 13.5, color: 'var(--ink-1)' }}>
                    Confirmed through Kora’s transaction records{req.paidAt ? ` on ${formatTime(req.paidAt)}` : ''}.
                  </p>
                  <Link to={`/receipt/${token}`} className="pf-btn pf-btn--secondary" style={{ width: '100%' }}>
                    <Icon name="external" size={16} />
                    <span>Download receipt</span>
                  </Link>
                </div>
              )}

              {/* Not Ready */}
              {isNotReady && (
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-md)', padding: 16 }}>
                  <p style={{ fontWeight: 600, color: 'var(--ink-1)', marginBottom: 4 }}>Not ready for payment yet</p>
                  <p style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                    {req.businessName} hasn’t released this payment request yet. Check back when they send you the link.
                  </p>
                </div>
              )}

              {/* Cancelled / Refunded */}
              {isCancelled && (
                <div style={{ background: 'var(--slate-bg)', border: '1px solid var(--slate-bd)', borderRadius: 'var(--r-md)', padding: 16 }}>
                  <p style={{ fontWeight: 600, color: 'var(--ink-1)', marginBottom: 4 }}>Payment request closed</p>
                  <p style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                    This payment request is no longer active. Do not transfer to any previous account details.
                  </p>
                </div>
              )}

              {/* Expired State */}
              {!isPaid && !isCancelled && !isNotReady && isExpired && (
                <div style={{ background: 'var(--slate-bg)', border: '1px solid var(--slate-bd)', borderRadius: 'var(--r-md)', padding: 16, display: 'grid', gap: 12 }}>
                  <p style={{ fontWeight: 600, color: 'var(--ink-1)' }}>Temporary account expired</p>
                  <p style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                    This dynamic transfer window is no longer valid. Your payment request remains open—generate a fresh transfer account before paying.
                  </p>
                  {!isPreview && (
                    <button
                      type="button"
                      className="pf-btn pf-btn--primary"
                      disabled={attemptMut.isPending}
                      onClick={() => attemptMut.mutate()}
                    >
                      {attemptMut.isPending ? 'Generating…' : 'Generate new account'}
                    </button>
                  )}
                </div>
              )}

              {/* Active Kora Transfer Instructions */}
              {!isPaid && !isCancelled && !isNotReady && !isExpired && req.accountNumber && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {isProcessing && (
                    <div className="ob-status ob-status--solar" style={{ width: '100%', padding: '12px 14px', borderRadius: 'var(--r-md)', whiteSpace: 'normal' }}>
                      <Icon name="radar" size={16} pulse />
                      <span>We’re checking with the bank for your transfer. Leave this page open for automatic confirmation.</span>
                    </div>
                  )}

                  <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-md)', padding: 16, display: 'grid', gap: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div>
                        <div className="ob-overline">Exact Amount</div>
                        <Money kobo={req.amountKobo} size="md" />
                      </div>
                      <CopyChip value={plainDigits} label="Copy amount" copyLabel="Amount" />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingTop: 10, borderTop: '1px solid var(--line-1)' }}>
                      <div>
                        <div className="ob-overline">Bank Name</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)', marginTop: 2 }}>{req.bankName ?? 'Wema Bank'}</div>
                      </div>
                      <div>
                        <div className="ob-overline">Account Name</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)', marginTop: 2 }}>{req.accountName ?? req.businessName}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 10, borderTop: '1px solid var(--line-1)' }}>
                      <div>
                        <div className="ob-overline">Dynamic Account Number</div>
                        <div className="pd-mono" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-1)', marginTop: 2 }}>
                          {req.accountNumber}
                        </div>
                      </div>
                      <CopyChip value={req.accountNumber} label="Copy" copyLabel="Account number" />
                    </div>
                  </div>

                  {req.expiresAt && (
                    <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                      Transfer the exact amount via bank app or USSD within <strong className="pd-mono" style={{ color: 'var(--solar-ink)' }}>{formatCountdown(remainingMs)}</strong>. Single-use dynamic account.
                    </p>
                  )}

                  <button
                    type="button"
                    disabled={claimMut.isPending}
                    onClick={() => claimMut.mutate()}
                    className="pf-btn pd-btn--hero pf-btn--primary"
                    style={{ width: '100%' }}
                  >
                    {claimMut.isPending ? 'Checking status…' : 'I have transferred the money'}
                  </button>

                  {isDemo && (
                    <button
                      type="button"
                      onClick={() => setDemoPaid(true)}
                      className="pf-btn pf-btn--secondary"
                      style={{ width: '100%', borderStyle: 'dotted', borderColor: 'var(--ultra-bd)', color: 'var(--ultra-ink)' }}
                    >
                      Simulate verified payment (Demo only)
                    </button>
                  )}
                </div>
              )}
            </div>
          </TicketCard>
        )}
      </div>
    </main>
  );
}
