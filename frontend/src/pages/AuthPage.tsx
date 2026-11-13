import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '../api/client';
import { describeError } from '../api/errors';
import { authApi } from '../api/endpoints';
import { ME_KEY, useAuth } from '../auth/AuthProvider';
import { MOCK } from '../config';
import type { Provider } from '../contract/contract';
import { useDocumentTitle } from '../lib/hooks';
import { isOnboarded } from '../lib/onboarding';
import { LogoMark } from '../ui/Logo';
import { RiskBanner } from '../shell/Banners';
import { Banner, TextField } from '../ui/primitives';

type Phase = 'idle' | 'checking' | 'failed';

export function AuthPage() {
  useDocumentTitle('Sign in');
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
  const [devName, setDevName] = useState("Tolu’s Glam Studio");
  const [devErr, setDevErr] = useState('');
  const [devBusy, setDevBusy] = useState(false);
  const ran = useRef(false);

  const telegramBotUrl =
    import.meta.env.VITE_TELEGRAM_BOT_URL || 'https://t.me/paidar_bot';

  const finish = useCallback(
    (p: Provider) => {
      qc.setQueryData(ME_KEY, p);
      clearExpired();
      nav(isOnboarded(p.id) ? from : '/onboarding', { replace: true });
    },
    [qc, nav, clearExpired, from]
  );

  // Exchange session token if coming from magic link
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

  async function submitDevLogin(e?: FormEvent, businessNameOverride?: string) {
    if (e) e.preventDefault();
    const targetName = (businessNameOverride ?? devName).trim() || "Tolu’s Glam Studio";
    setDevErr('');
    setDevBusy(true);
    try {
      const r = await authApi.devLogin(targetName);
      finish(r.provider);
    } catch (err) {
      setDevErr(
        describeError(err).fieldErrors?.businessName?.[0] ?? describeError(err).message
      );
      setDevBusy(false);
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
        padding: '40px 20px',
        position: 'relative',
        zIndex: 1,
      }}
    >
      {/* Logo & Mark (Spec Section 5.1) */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ display: 'inline-block', marginBottom: 10, color: 'var(--paper)' }}>
          <LogoMark size={64} />
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 40,
            letterSpacing: '-0.03em',
            color: 'var(--paper)',
            margin: 0,
          }}
        >
          paidar
        </h1>
      </div>

      <RiskBanner />

      {expired && phase !== 'checking' && (
        <div style={{ maxWidth: 380, width: '100%', marginBottom: 16 }}>
          <Banner tone="warn">
            Your session ended. Sign in again to continue where you left off.
          </Banner>
        </div>
      )}

      {/* Checking Token state */}
      {phase === 'checking' && (
        <div
          style={{
            width: 'min(380px, 100%)',
            background: 'var(--paper)',
            borderRadius: 'var(--r-ticket)',
            padding: 32,
            textAlign: 'center',
            color: 'var(--paper-ink)',
            boxShadow: '0 22px 22px rgba(16, 21, 77, 0.45)',
          }}
        >
          <div style={{ display: 'inline-block', marginBottom: 14 }}>
            <LogoMark size={48} />
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>
            Signing you in…
          </h2>
          <p style={{ color: 'var(--paper-muted)', fontSize: 14, marginTop: 6 }}>
            Verifying your Telegram access token.
          </p>
        </div>
      )}

      {/* Expired / Failed Link state: Ticket torn in two (Spec Section 5.1) */}
      {phase === 'failed' && (
        <div
          style={{
            width: 'min(380px, 100%)',
            marginBottom: 20,
          }}
        >
          <div
            style={{
              background: 'var(--paper)',
              borderRadius: 'var(--r-ticket) var(--r-ticket) 0 0',
              padding: '24px 22px',
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
              This link has expired or was already used
            </h2>
            <p style={{ color: 'var(--paper-muted)', fontSize: 14, margin: 0 }}>
              {failMsg || 'Please request a fresh login link from the Paidar Telegram bot.'}
            </p>
          </div>
          <div
            style={{
              background: 'var(--paper)',
              borderRadius: '0 0 var(--r-ticket) var(--r-ticket)',
              padding: '18px 22px',
              transform: 'rotate(-1.5deg)',
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
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Normal Idle State: Single Boarding-Pass Ticket (Spec Section 5.1) */}
      {phase === 'idle' && (
        <div style={{ width: 'min(380px, 100%)' }}>
          <article
            style={{
              background: 'var(--paper)',
              borderRadius: 'var(--r-ticket)',
              boxShadow: '0 24px 32px rgba(16, 21, 77, 0.45)',
              color: 'var(--paper-ink)',
              overflow: 'hidden',
            }}
          >
            {/* Top part */}
            <div style={{ padding: '28px 24px 18px' }}>
              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  fontSize: 22,
                  letterSpacing: '-0.02em',
                  margin: '0 0 6px',
                }}
              >
                Your Telegram is your key.
              </h2>
              <p style={{ color: 'var(--paper-muted)', fontSize: 14, margin: 0 }}>
                Instant sign-in without passwords. Send /login or /start to receive your secure link.
              </p>
            </div>

            {/* Cut line + Notches */}
            <div className="pd-ticket__cut" aria-hidden="true">
              <i />
              <i />
            </div>

            {/* Stub: 3-step numbered sequence */}
            <div style={{ padding: '18px 24px 28px' }}>
              <ol
                style={{
                  margin: '0 0 24px',
                  padding: 0,
                  listStyle: 'none',
                  display: 'grid',
                  gap: 12,
                }}
              >
                <li style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 800,
                      color: 'var(--ground)',
                      fontSize: 16,
                    }}
                  >
                    1.
                  </span>
                  <span style={{ fontSize: 15 }}>Open Telegram</span>
                </li>
                <li style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 800,
                      color: 'var(--ground)',
                      fontSize: 16,
                    }}
                  >
                    2.
                  </span>
                  <span style={{ fontSize: 15 }}>
                    Send <strong>/start</strong> (or <strong>/login</strong> if registered)
                  </span>
                </li>
                <li style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 800,
                      color: 'var(--ground)',
                      fontSize: 16,
                    }}
                  >
                    3.
                  </span>
                  <span style={{ fontSize: 15 }}>Tap the instant link the bot sends you</span>
                </li>
              </ol>

              {/* Primary Key: Open Telegram Button (Marigold Pressed Key) */}
              <a
                href={telegramBotUrl}
                target="_blank"
                rel="noreferrer"
                className="pd-btn-primary pd-btn--block"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textDecoration: 'none',
                  boxSizing: 'border-box',
                }}
              >
                Open Telegram
              </a>
            </div>
          </article>

          {/* Dev/Demo sign-in (Spec Section 5.1 & Acceptance T16) */}
          {(MOCK || import.meta.env.DEV) && (
            <div
              style={{
                marginTop: 24,
                background: 'rgba(245, 244, 239, 0.92)',
                borderRadius: 'var(--r-ticket)',
                border: '2px dashed var(--urgent)',
                padding: '20px 22px',
                color: 'var(--paper-ink)',
              }}
            >
              <div
                style={{
                  display: 'inline-block',
                  background: 'var(--tag-urgent-bg)',
                  color: 'var(--tag-urgent-ink)',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 6,
                  marginBottom: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Developer Only · Demo Mode
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>
                Quick Test Workspace
              </h3>
              <p style={{ fontSize: 13, color: 'var(--paper-muted)', margin: '0 0 14px' }}>
                Bypass Telegram in mock/dev builds.
              </p>

              <form onSubmit={(e) => void submitDevLogin(e)}>
                <TextField
                  label="Business name"
                  value={devName}
                  onChange={(e) => setDevName(e.target.value)}
                  placeholder="e.g. Tolu’s Glam Studio"
                  error={devErr}
                />

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    margin: '10px 0 16px',
                  }}
                >
                  {["Tolu’s Glam Studio", "Amina Couture", "De-True Studio"].map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => {
                        setDevName(b);
                        void submitDevLogin(undefined, b);
                      }}
                      style={{
                        background: 'rgba(20, 24, 63, 0.08)',
                        border: '1px solid rgba(20, 24, 63, 0.16)',
                        borderRadius: 8,
                        padding: '4px 10px',
                        fontSize: 12,
                        cursor: 'pointer',
                        fontFamily: 'var(--font-ui)',
                        fontWeight: 600,
                        color: 'var(--paper-ink)',
                      }}
                    >
                      {b}
                    </button>
                  ))}
                </div>

                <button
                  type="submit"
                  className="pd-btn pd-btn--line pd-btn--block"
                  disabled={devBusy}
                >
                  {devBusy ? 'Opening Workspace…' : 'Continue with demo'}
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
