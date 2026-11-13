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
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function PublicPayPage() {
  const { token } = useParams<{ token: string }>();
  const [copiedAcct, setCopiedAcct] = useState(false);
  const [copiedAmt, setCopiedAmt] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const startRef = useRef(Date.now());

  const q = useQuery({
    queryKey: ['publicRequest', token],
    queryFn: () => publicApi.getRequest(token!),
    enabled: !!token,
    staleTime: 2000,
  });

  const req = q.data;

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
      <main style={{ maxWidth: 460, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ color: '#666' }}>Loading payment details…</p>
      </main>
    );
  }

  if (q.isError || !req) {
    return (
      <main style={{ maxWidth: 460, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
        <h2>Payment link not found</h2>
        <p style={{ color: '#666' }}>This payment link may be expired, invalid, or removed. Contact the business for fresh details.</p>
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
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? `${h}h ${m}m` : `${m}m ${sec < 10 ? '0' : ''}${sec}s`;
  };

  return (
    <main
      style={{
        maxWidth: 460,
        margin: '0 auto',
        padding: '24px 16px 48px',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        lineHeight: 1.5,
        color: '#111418',
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{req.businessName}</h1>
        <p style={{ color: '#6E6689', margin: 0, fontSize: 15 }}>
          For {req.customerFirstName}: {req.service}
          {QUALIFIER[req.kind] ?? ''}
        </p>
      </div>

      {req.status === 'PAID' && req.receipt && (
        <section
          style={{
            background: '#fff',
            borderRadius: 14,
            border: '1.5px solid #2EE6A6',
            padding: 20,
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: 999,
              background: '#DDF8EE',
              color: '#0B7A55',
              fontWeight: 700,
              fontSize: 14,
              marginBottom: 12,
            }}
          >
            ✓ Payment received
          </span>
          <p style={{ fontSize: 32, fontWeight: 800, margin: '0 0 16px', color: '#140B2B' }}>
            {formatNaira(req.receipt.amountKobo)}
          </p>
          <div style={{ borderTop: '1px solid #E1DBF0', paddingTop: 12, fontSize: 14, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6E6689' }}>Receipt Reference</span>
              <strong>{req.receipt.reference}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6E6689' }}>Date & Time</span>
              <span>{formatDateTime(req.receipt.paidAt)}</span>
            </div>
            {BigInt(req.receipt.jobBalanceKobo) > 0n && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#9A4A06', borderTop: '1px dashed #E1DBF0', paddingTop: 8 }}>
                <span>Remaining Balance</span>
                <strong>{formatNaira(req.receipt.jobBalanceKobo)}</strong>
              </div>
            )}
          </div>
        </section>
      )}

      {req.status === 'SENT' && (
        <section
          style={{
            background: '#fff',
            borderRadius: 14,
            border: '1.5px solid #E1DBF0',
            padding: 20,
            boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
          }}
        >
          <p style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6E6689', margin: '0 0 2px' }}>
            Amount to pay
          </p>
          <p style={{ fontSize: 34, fontWeight: 800, margin: '0 0 16px', color: '#140B2B' }}>
            {formatNaira(req.amountKobo)}
          </p>

          <div style={{ borderTop: '1px solid #E1DBF0', display: 'grid', gap: 12, paddingTop: 12, fontSize: 15 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6E6689' }}>Bank</span>
              <strong>{req.bankName}</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#6E6689' }}>Account number</span>
              <strong style={{ fontSize: 17, letterSpacing: '0.5px' }}>{req.accountNumber}</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6E6689' }}>Account name</span>
              <strong>{req.accountName}</strong>
            </div>

            {timeLeft !== null && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: timeLeft <= 600_000 ? '#FBE4E8' : '#FCEBD0',
                  color: timeLeft <= 600_000 ? '#B4233A' : '#9A4A06',
                  fontWeight: 600,
                  textAlign: 'center',
                  fontSize: 14,
                }}
              >
                {timeLeft <= 0 ? 'Account expired' : `${formatCountdownStr(timeLeft)} left to pay`}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
            <button
              type="button"
              onClick={handleCopyAcct}
              style={{
                minHeight: 48,
                borderRadius: 10,
                border: 'none',
                background: '#6D28D9',
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              {copiedAcct ? 'Account Number Copied ✓' : 'Copy Account Number'}
            </button>

            <button
              type="button"
              onClick={handleCopyAmt}
              style={{
                minHeight: 44,
                borderRadius: 10,
                border: '1.5px solid #C9BFE3',
                background: '#F6F4FB',
                color: '#140B2B',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              {copiedAmt ? `Copied ${plainAmount} ✓` : `Copy Plain Amount (${plainAmount})`}
            </button>
          </div>

          <div style={{ marginTop: 24, borderTop: '1px solid #E1DBF0', paddingTop: 16 }}>
            {claimed || req.customerClaimedPaidAt ? (
              <p style={{ margin: 0, color: '#0B7A55', fontWeight: 600, fontSize: 14, textAlign: 'center' }}>
                ✓ {req.businessName} has been told. This page will update once the bank confirms your payment.
              </p>
            ) : (
              <button
                type="button"
                onClick={handleClaimPaid}
                disabled={claiming}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  color: '#6D28D9',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 8,
                }}
              >
                {claiming ? 'Notifying…' : 'I’ve already made this transfer'}
              </button>
            )}
          </div>
        </section>
      )}

      {req.status === 'EXPIRED' && (
        <section
          style={{
            background: '#fff',
            borderRadius: 14,
            border: '1.5px solid #E1DBF0',
            padding: 20,
            textAlign: 'center',
          }}
        >
          <h2 style={{ fontSize: 18, color: '#B4233A', margin: '0 0 8px' }}>This payment account has expired</h2>
          <p style={{ color: '#6E6689', fontSize: 15, margin: 0 }}>
            To prevent lost transfers, this one-time virtual account closed. Please ask {req.businessName} to generate a fresh payment link for you.
          </p>
        </section>
      )}

      {req.status === 'CANCELLED' && (
        <section
          style={{
            background: '#fff',
            borderRadius: 14,
            border: '1.5px solid #E1DBF0',
            padding: 20,
            textAlign: 'center',
          }}
        >
          <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>Payment cancelled</h2>
          <p style={{ color: '#6E6689', fontSize: 15, margin: 0 }}>
            This payment request was cancelled by {req.businessName}.
          </p>
        </section>
      )}

      <footer style={{ marginTop: 28, textAlign: 'center', fontSize: 13, color: '#8E87A5' }}>
        <p style={{ margin: 0 }}>
          This is a one-time virtual account powered by Paidar and verified by Kora.
        </p>
      </footer>
    </main>
  );
}
