import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '../api/client';
import { describeError } from '../api/errors';
import { authApi } from '../api/endpoints';
import { ME_KEY, useAuth } from '../auth/AuthProvider';
import type { Provider } from '../contract/contract';
import { useDocumentTitle } from '../lib/hooks';
import { isOnboarded } from '../lib/onboarding';
import { LogoMark } from '../ui/Logo';
import { RiskBanner } from '../shell/Banners';
import { Banner } from '../ui/primitives';

type Phase = 'idle' | 'checking' | 'failed';

const PRESETS = [
  'Tolu’s Glam Studio',
  'Amina Couture',
  'De-True Tailoring',
];

export function AuthPage() {
  useDocumentTitle('Sign in to Paidar');
  const [params] = useSearchParams();
  const token = params.get('t');
  const nav = useNavigate();
  const qc = useQueryClient();
  const { status, expired, clearExpired } = useAuth();
  const loc = useLocation();
  const rawFrom = (loc.state as { from?: string } | null)?.from;
  const from =
    rawFrom &&
    rawFrom.startsWith('/') &&
    !rawFrom.startsWith('/auth') &&
    !rawFrom.startsWith('//')
      ? rawFrom
      : '/today';

  const [phase, setPhase] = useState<Phase>(token ? 'checking' : 'idle');
  const [failMsg, setFailMsg] = useState('');
  const [businessName, setBusinessName] = useState('Tolu’s Glam Studio');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ran = useRef(false);

  const finish = useCallback(
    (p: Provider) => {
      qc.setQueryData(ME_KEY, p);
      clearExpired();
      nav(isOnboarded(p.id) ? from : '/onboarding', { replace: true });
    },
    [qc, nav, clearExpired, from]
  );

  // Exchange session token if coming from a direct sign-in link
  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    authApi
      .exchange(token)
      .then((r) => finish(r.provider))
      .catch((e: unknown) => {
        setFailMsg(
          e instanceof ApiRequestError && e.status === 401
            ? 'This sign-in link has expired or was already used.'
            : describeError(e).message
        );
        setPhase('failed');
      });
  }, [token, finish]);

  useEffect(() => {
    if (status === 'authed' && !token) nav(from, { replace: true });
  }, [status, token, nav, from]);

  async function submitLogin(e?: FormEvent, targetName?: string) {
    if (e) e.preventDefault();
    const finalName = (targetName ?? businessName).trim() || 'Tolu’s Glam Studio';
    setErr('');
    setBusy(true);
    try {
      const r = await authApi.devLogin(finalName);
      finish(r.provider);
    } catch (error) {
      setErr(
        describeError(error).fieldErrors?.businessName?.[0] ?? describeError(error).message
      );
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '36px 20px 48px',
        position: 'relative',
        zIndex: 1,
      }}
    >
      {/* Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-block', marginBottom: 12, color: 'var(--paper)' }}>
          <LogoMark size={60} />
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 38,
            letterSpacing: '-0.03em',
            color: 'var(--paper)',
            margin: 0,
            lineHeight: 1,
          }}
        >
          paidar
        </h1>
        <p
          style={{
            color: 'var(--muted-on-ground)',
            fontSize: 14,
            marginTop: 8,
            fontWeight: 500,
          }}
        >
          Payment tickets for independent businesses
        </p>
      </div>

      <RiskBanner />

      {expired && phase !== 'checking' && (
        <div style={{ maxWidth: 420, width: '100%', marginBottom: 16 }}>
          <Banner tone="warn">
            Your session ended. Sign in again to continue where you left off.
          </Banner>
        </div>
      )}

      {/* Checking Token state */}
      {phase === 'checking' && (
        <div
          style={{
            width: 'min(420px, 100%)',
            background: 'var(--paper)',
            borderRadius: 'var(--r-ticket)',
            padding: 36,
            textAlign: 'center',
            color: 'var(--paper-ink)',
            boxShadow: '0 24px 32px rgba(16, 21, 77, 0.45)',
          }}
        >
          <div style={{ display: 'inline-block', marginBottom: 16 }}>
            <LogoMark size={48} />
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21 }}>
            Signing you in…
          </h2>
          <p style={{ color: 'var(--paper-muted)', fontSize: 14, marginTop: 8 }}>
            Verifying your workspace link.
          </p>
        </div>
      )}

      {/* Expired / Failed Link state: Ticket torn in two */}
      {phase === 'failed' && (
        <div style={{ width: 'min(420px, 100%)', marginBottom: 20 }}>
          <div
            style={{
              background: 'var(--paper)',
              borderRadius: 'var(--r-ticket) var(--r-ticket) 0 0',
              padding: '24px 24px',
              borderBottom: '2px dashed var(--urgent)',
              color: 'var(--paper-ink)',
            }}
          >
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 18,
                color: 'var(--urgent)',
                margin: '0 0 6px',
              }}
            >
              Link expired or already used
            </h2>
            <p style={{ color: 'var(--paper-muted)', fontSize: 14, margin: 0 }}>
              {failMsg || 'Please sign in directly with your business name below.'}
            </p>
          </div>
          <div
            style={{
              background: 'var(--paper)',
              borderRadius: '0 0 var(--r-ticket) var(--r-ticket)',
              padding: '18px 24px',
              transform: 'rotate(-1.2deg)',
              transformOrigin: 'top left',
              boxShadow: '0 16px 24px rgba(16, 21, 77, 0.35)',
              textAlign: 'center',
            }}
          >
            <button
              type="button"
              className="pd-btn pd-btn--line"
              style={{ width: '100%' }}
              onClick={() => {
                setPhase('idle');
                setFailMsg('');
              }}
            >
              Sign in with business name
            </button>
          </div>
        </div>
      )}

      {/* Normal Idle State: Elegant Workspace Ticket */}
      {phase === 'idle' && (
        <div style={{ width: 'min(420px, 100%)' }}>
          <article
            style={{
              background: 'var(--paper)',
              borderRadius: 'var(--r-ticket)',
              boxShadow: '0 24px 36px rgba(16, 21, 77, 0.45)',
              color: 'var(--paper-ink)',
              overflow: 'hidden',
            }}
          >
            {/* Top part: Workspace Access Form */}
            <div style={{ padding: '28px 26px 20px' }}>
              <div
                style={{
                  display: 'inline-block',
                  background: 'rgba(35, 48, 166, 0.08)',
                  color: 'var(--ground)',
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 999,
                  marginBottom: 12,
                  letterSpacing: '0.02em',
                }}
              >
                Provider Portal
              </div>
              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  fontSize: 22,
                  letterSpacing: '-0.02em',
                  margin: '0 0 6px',
                  color: 'var(--paper-ink)',
                }}
              >
                Sign in to your workspace
              </h2>
              <p
                style={{
                  color: 'var(--paper-muted)',
                  fontSize: 14,
                  margin: '0 0 20px',
                  lineHeight: 1.45,
                }}
              >
                Enter your business or studio name to access your payment tickets, queues, and ledger.
              </p>

              <form onSubmit={(e) => void submitLogin(e)}>
                <div style={{ marginBottom: 14 }}>
                  <label
                    htmlFor="biz-name"
                    style={{
                      display: 'block',
                      fontFamily: 'var(--font-ui)',
                      fontSize: 13,
                      fontWeight: 700,
                      color: 'var(--paper-ink)',
                      marginBottom: 6,
                    }}
                  >
                    Business name
                  </label>
                  <input
                    id="biz-name"
                    type="text"
                    className="pd-input"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Tolu’s Glam Studio"
                    autoComplete="organization"
                    required
                    style={{
                      minHeight: 48,
                      fontSize: 15,
                      fontWeight: 600,
                      border: '1.5px solid rgba(20, 24, 63, 0.18)',
                    }}
                  />
                  {err && (
                    <p style={{ color: 'var(--urgent)', fontSize: 13, fontWeight: 600, margin: '6px 0 0' }}>
                      {err}
                    </p>
                  )}
                </div>

                {/* Quick Presets */}
                <div style={{ marginBottom: 18 }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--paper-muted)',
                      display: 'block',
                      marginBottom: 6,
                    }}
                  >
                    Quick switch:
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {PRESETS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setBusinessName(p);
                          void submitLogin(undefined, p);
                        }}
                        style={{
                          background:
                            businessName === p
                              ? 'var(--paper-ink)'
                              : 'rgba(20, 24, 63, 0.06)',
                          color:
                            businessName === p
                              ? 'var(--paper)'
                              : 'var(--paper-ink)',
                          border: '1px solid rgba(20, 24, 63, 0.14)',
                          borderRadius: 8,
                          padding: '5px 10px',
                          fontSize: 12,
                          cursor: 'pointer',
                          fontFamily: 'var(--font-ui)',
                          fontWeight: 600,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Primary Marigold Key */}
                <button
                  type="submit"
                  className="pd-btn-primary pd-btn--block"
                  disabled={busy || !businessName.trim()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {busy ? 'Opening Workspace…' : 'Enter Workspace'}
                </button>
              </form>
            </div>

            {/* Cut line + Notches */}
            <div className="pd-ticket__cut" aria-hidden="true">
              <i />
              <i />
            </div>

            {/* Stub: Reassurances & Core Product Value */}
            <div
              style={{
                padding: '18px 24px 22px',
                background: 'rgba(20, 24, 63, 0.02)',
              }}
            >
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>🎟</span>
                  <span style={{ fontSize: 13, color: 'var(--paper-muted)', lineHeight: 1.35 }}>
                    <strong>Dynamic Virtual Accounts:</strong> single-use Kora account per payment.
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>📋</span>
                  <span style={{ fontSize: 13, color: 'var(--paper-muted)', lineHeight: 1.35 }}>
                    <strong>Provider-Controlled:</strong> you copy & paste details directly to your client.
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>⚡</span>
                  <span style={{ fontSize: 13, color: 'var(--paper-muted)', lineHeight: 1.35 }}>
                    <strong>Instant Payment Ping:</strong> real-time notification the second money clears.
                  </span>
                </div>
              </div>
            </div>
          </article>
        </div>
      )}
    </div>
  );
}
