import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { publicApi } from '../api/endpoints';
import { formatNaira } from '../lib/money';
import { formatDateTime } from '../lib/time';

const QUALIFIER: Record<string, string> = { DEPOSIT: ' (deposit)', BALANCE: ' (balance)' };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function PublicPayPage() {
  const { token } = useParams<{ token: string }>();
  const [copiedAcct, setCopiedAcct] = useState(false);
  const [copiedAmt, setCopiedAmt] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const startRef = useRef(Date.now());

  const q = useQuery({
    queryKey: ['publicRequest', token],
    queryFn: () => publicApi.getRequest(token!),
    enabled: !!token,
    staleTime: 2000,
  });

  const req = q.data;

  // Track elapsed seconds since page open for 60s claim button delay (Spec reconciliation #4)
  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Poll status endpoint
  useEffect(() => {
    if (!token || !req) return;
    if (req.status === 'PAID' || req.status === 'CANCELLED') return;

    let timer: number | null = null;
    let cancelled = false;

    async function poll() {
      if (document.hidden) return;
      try {
        const s = await publicApi.getStatus(token!);
        if (s.state.toUpperCase() !== req?.status) {
          void q.refetch();
        }
      } catch {
        /* network blip */
      }
      if (!cancelled) {
        const delay = Date.now() - startRef.current < 120_000 ? 4000 : 10_000;
        timer = window.setTimeout(poll, delay);
      }
    }

    timer = window.setTimeout(poll, 4000);

    const onVisibility = () => {
      if (!document.hidden && timer === null) {
        poll();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [token, req?.status, q]);

  // Countdown timer
  useEffect(() => {
    if (!req?.expiresAt || req.status !== 'SENT') {
      setTimeLeft(null);
      return;
    }

    const target = Date.parse(req.expiresAt);
    const tick = () => {
      const ms = Math.max(0, target - Date.now());
      setTimeLeft(ms);
      if (ms <= 0 && req.status === 'SENT') {
        void q.refetch();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [req?.expiresAt, req?.status, q]);

  if (q.isPending) {
    return (
      <main
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#2330A6',
          color: '#F3F1FF',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: 20,
        }}
      >
        <p style={{ fontSize: 16 }}>Loading payment details…</p>
      </main>
    );
  }

  if (q.isError || !req) {
    return (
      <main
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#2330A6',
          color: '#F3F1FF',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: 20,
        }}
      >
        <div
          style={{
            background: '#F5F4EF',
            color: '#14183F',
            borderRadius: 24,
            padding: '32px 24px',
            maxWidth: 400,
            textAlign: 'center',
            boxShadow: '0 20px 30px rgba(0,0,0,0.3)',
          }}
        >
          <h2 style={{ fontSize: 20, margin: '0 0 8px' }}>We can’t find this payment link.</h2>
          <p style={{ color: '#5E6285', fontSize: 14, margin: 0 }}>
            It may have expired or been removed. Please ask the business for fresh details.
          </p>
        </div>
      </main>
    );
  }

  async function handleCopyAcct() {
    if (!req?.accountNumber) return;
    const ok = await copyText(req.accountNumber);
    if (ok) {
      setCopiedAcct(true);
      setTimeout(() => setCopiedAcct(false), 2000);
    }
  }

  async function handleCopyAmt() {
    if (!req) return;
    const plain = (BigInt(req.amountKobo) / 100n).toString();
    const ok = await copyText(plain);
    if (ok) {
      setCopiedAmt(true);
      setTimeout(() => setCopiedAmt(false), 2000);
    }
  }

  async function handleClaimPaid() {
    if (!token) return;
    setClaiming(true);
    try {
      await publicApi.claimPaid(token);
      setClaimed(true);
    } catch {
      /* ignore */
    } finally {
      setClaiming(false);
    }
  }

  const plainAmount = (BigInt(req.amountKobo) / 100n).toString();
  const formatCountdownStr = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  const isPaid = req.status === 'PAID';
  const isExpired = req.status === 'EXPIRED';
  const isCancelled = req.status === 'CANCELLED';

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#2330A6',
        padding: '32px 16px 60px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        boxSizing: 'border-box',
      }}
    >
      <main
        style={{
          width: 'min(440px, 100%)',
          background: '#F5F4EF',
          borderRadius: 28,
          boxShadow: '0 24px 36px -8px rgba(16, 21, 77, 0.5)',
          color: '#14183F',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Top Brand & Customer Strip (Spec Section 5.14) */}
        <div style={{ padding: '24px 22px 14px', borderBottom: '1px solid rgba(20, 24, 63, 0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ width: 4, height: 16, background: '#2330A6', borderRadius: 2 }} />
            <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: '#14183F' }}>
              {req.businessName}
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: '#5E6285' }}>
            Payment for {req.customerFirstName} · {req.service}
            {QUALIFIER[req.kind] ?? ''}
          </p>
        </div>

        {/* STATE A: WAITING (Spec Section 5.14) */}
        {!isPaid && !isExpired && !isCancelled && (
          <div style={{ padding: '20px 22px 28px' }}>
            <p
              style={{
                fontSize: 12,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: '#5E6285',
                margin: '0 0 2px',
              }}
            >
              Pay exactly
            </p>
            <div
              style={{
                fontSize: 'clamp(36px, 10vw, 48px)',
                fontWeight: 800,
                fontFamily: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
                letterSpacing: '-0.02em',
                color: '#14183F',
                margin: '0 0 10px',
                lineHeight: 1,
              }}
            >
              {formatNaira(req.amountKobo)}
            </div>

            <button
              type="button"
              onClick={handleCopyAmt}
              style={{
                width: '100%',
                padding: '10px 16px',
                borderRadius: 12,
                border: '1.5px solid #14183F',
                background: copiedAmt ? '#0E9F57' : 'transparent',
                color: copiedAmt ? '#fff' : '#14183F',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                marginBottom: 20,
                transition: 'all 0.15s ease',
              }}
            >
              {copiedAmt ? 'Amount Copied ✓' : `Copy amount ${plainAmount}`}
            </button>

            {/* Countdown Ring banner */}
            {timeLeft !== null && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: timeLeft <= 180_000 ? '#FFD9D5' : timeLeft <= 600_000 ? '#FFE3A6' : '#DFE3FF',
                  color: timeLeft <= 180_000 ? '#8A1409' : timeLeft <= 600_000 ? '#6A4200' : '#1B2480',
                  fontWeight: 700,
                  fontSize: 14,
                  marginBottom: 20,
                }}
              >
                <span>Dynamic Account Expiry</span>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 16 }}>
                  {formatCountdownStr(timeLeft)} left to pay
                </span>
              </div>
            )}

            {/* Account Details Box */}
            <div
              style={{
                background: '#fff',
                borderRadius: 16,
                padding: '18px 16px',
                border: '1px solid rgba(20, 24, 63, 0.1)',
                display: 'grid',
                gap: 12,
                marginBottom: 20,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: '#5E6285' }}>Bank</span>
                <strong style={{ fontSize: 15 }}>{req.bankName}</strong>
              </div>

              <div>
                <span style={{ fontSize: 12, color: '#5E6285', display: 'block', marginBottom: 2 }}>
                  Account number
                </span>
                <div
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 22,
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    color: '#14183F',
                    marginBottom: 10,
                  }}
                >
                  {req.accountNumber}
                </div>
                <button
                  type="button"
                  onClick={handleCopyAcct}
                  style={{
                    width: '100%',
                    minHeight: 52,
                    borderRadius: 14,
                    border: 'none',
                    background: copiedAcct ? '#0E9F57' : '#FFB81C',
                    color: '#14183F',
                    fontWeight: 800,
                    fontSize: 16,
                    cursor: 'pointer',
                    boxShadow: copiedAcct ? '0 4px 0 #0A6636' : '0 4px 0 #B97F00',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {copiedAcct ? 'Account Number Copied ✓' : 'Copy account number'}
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderTop: '1px solid #eee', paddingTop: 10 }}>
                <span style={{ color: '#5E6285' }}>Account name</span>
                <strong>{req.accountName}</strong>
              </div>
            </div>

            {/* Reassurance copy (Spec Section 5.14) */}
            <div style={{ fontSize: 13, color: '#5E6285', lineHeight: 1.45, marginBottom: 20 }}>
              <p style={{ margin: '0 0 6px' }}>
                A different amount may be reversed by your bank.
              </p>
              <p style={{ margin: 0 }}>
                This account is for this payment only. Transfer from any Nigerian bank app or USSD.
              </p>
            </div>

            {/* Live Status and "Tell business I've paid" button */}
            <div style={{ borderTop: '1px dashed rgba(20, 24, 63, 0.16)', paddingTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#5E6285', marginBottom: 12 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#2330A6',
                    display: 'inline-block',
                  }}
                />
                <span>Waiting for your transfer…</span>
              </div>

              {claimed || req.customerClaimedPaidAt ? (
                <p style={{ margin: 0, color: '#0E9F57', fontWeight: 700, fontSize: 14, textAlign: 'center' }}>
                  ✓ {req.businessName} has been told. This page will update once the bank confirms your payment.
                </p>
              ) : secondsElapsed >= 60 ? (
                <button
                  type="button"
                  onClick={handleClaimPaid}
                  disabled={claiming}
                  style={{
                    width: '100%',
                    minHeight: 44,
                    background: 'transparent',
                    border: '1.5px solid #14183F',
                    borderRadius: 12,
                    color: '#14183F',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  {claiming ? 'Notifying…' : `Tell ${req.businessName} I’ve paid`}
                </button>
              ) : null}
            </div>
          </div>
        )}

        {/* STATE B: PAID (Spec Section 5.14) */}
        {isPaid && (
          <div style={{ padding: '24px 22px 32px' }}>
            <div
              style={{
                display: 'inline-block',
                fontFamily: 'ui-rounded, system-ui',
                fontWeight: 800,
                fontSize: 28,
                letterSpacing: '0.08em',
                color: '#0E9F57',
                border: '4px solid #0E9F57',
                borderRadius: 8,
                padding: '4px 16px',
                transform: 'rotate(-4deg)',
                marginBottom: 20,
              }}
            >
              PAID ✓
            </div>

            {req.receipt && (
              <div
                style={{
                  background: '#FFFEFA',
                  border: '1px solid rgba(20, 24, 63, 0.12)',
                  borderRadius: '12px 12px 0 0',
                  padding: 20,
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 14,
                  lineHeight: 1.6,
                  boxShadow: '0 8px 20px rgba(0,0,0,0.06)',
                  position: 'relative',
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8, fontFamily: 'system-ui' }}>
                  {req.businessName} Receipt
                </div>
                <div>Service: {req.service}</div>
                <div style={{ borderTop: '1px dashed #ccc', margin: '8px 0' }} />
                <div style={{ fontSize: 24, fontWeight: 800, color: '#0E9F57' }}>
                  {formatNaira(req.receipt.amountKobo)}
                </div>
                <div>Ref: {req.receipt.reference}</div>
                <div>Time: {formatDateTime(req.receipt.paidAt)}</div>

                {BigInt(req.receipt.jobBalanceKobo) > 0n && (
                  <div style={{ borderTop: '1px dashed #ccc', marginTop: 8, paddingTop: 6, color: '#E58A00' }}>
                    Balance remaining: {formatNaira(req.receipt.jobBalanceKobo)}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => window.print()}
              style={{
                width: '100%',
                minHeight: 48,
                marginTop: 20,
                borderRadius: 14,
                border: '2px solid #14183F',
                background: 'transparent',
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Print / Save receipt
            </button>
          </div>
        )}

        {/* STATE C: EXPIRED (Spec Section 5.14) */}
        {isExpired && (
          <div style={{ padding: '32px 22px', textAlign: 'center' }}>
            <div
              style={{
                display: 'inline-block',
                fontWeight: 800,
                fontSize: 24,
                color: '#E5392D',
                border: '3px solid #E5392D',
                borderRadius: 8,
                padding: '4px 14px',
                marginBottom: 16,
              }}
            >
              EXPIRED
            </div>
            <h2 style={{ fontSize: 18, color: '#14183F', margin: '0 0 8px' }}>
              This payment account has expired.
            </h2>
            <p style={{ color: '#5E6285', fontSize: 14, margin: 0, lineHeight: 1.5 }}>
              To prevent lost transfers, this one-time account closed. Please ask {req.businessName} for a fresh payment link.
            </p>
          </div>
        )}

        {/* STATE D: CANCELLED (Spec Section 5.14) */}
        {isCancelled && (
          <div style={{ padding: '32px 22px', textAlign: 'center' }}>
            <h2 style={{ fontSize: 18, color: '#14183F', margin: '0 0 8px' }}>
              Payment request cancelled
            </h2>
            <p style={{ color: '#5E6285', fontSize: 14, margin: 0, lineHeight: 1.5 }}>
              This payment request was cancelled. If you think this is a mistake, ask {req.businessName}.
            </p>
          </div>
        )}
      </main>

      {/* Footer promise (Spec Section 5.14) */}
      <footer style={{ marginTop: 24, textAlign: 'center', fontSize: 13, color: '#BBC1F7' }}>
        This account is for this payment only · Powered by Paidar
      </footer>
    </div>
  );
}
