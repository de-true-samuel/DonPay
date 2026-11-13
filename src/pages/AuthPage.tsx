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
  const from = rawFrom && rawFrom.startsWith('/') && !rawFrom.startsWith('/auth') && !rawFrom.startsWith('//') ? rawFrom : '/today';
  const [phase, setPhase] = useState<Phase>(token ? 'checking' : 'idle');
  const [failMsg, setFailMsg] = useState('');
  const [devName, setDevName] = useState("Tolu’s Glam Studio");
  const [devErr, setDevErr] = useState('');
  const [devBusy, setDevBusy] = useState(false);
  const ran = useRef(false);

  const finish = useCallback((p: Provider) => {
    qc.setQueryData(ME_KEY, p);
    clearExpired();
    nav(isOnboarded(p.id) ? from : '/onboarding', { replace: true });
  }, [qc, nav, clearExpired, from]);

  // Exchange session token if coming from magic link
  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    authApi.exchange(token)
      .then((r) => finish(r.provider))
      .catch((e: unknown) => {
        setFailMsg(e instanceof ApiRequestError && e.status === 401
          ? 'This sign-in link has expired or was already used.'
          : describeError(e).message);
        setPhase('failed');
      });
  }, [token, finish]);

  useEffect(() => {
    if (status === 'authed' && !token) nav(from, { replace: true });
  }, [status, token, nav, from]);

  async function submitLogin(e?: FormEvent, businessNameOverride?: string) {
    if (e) e.preventDefault();
    const targetName = (businessNameOverride ?? devName).trim() || "Tolu’s Glam Studio";
    setDevErr('');
    setDevBusy(true);
    try {
      const r = await authApi.devLogin(targetName);
      finish(r.provider);
    } catch (err) {
      setDevErr(describeError(err).fieldErrors?.businessName?.[0] ?? describeError(err).message);
      setDevBusy(false);
    }
  }

  return (
    <div className="pd-auth-portal">
      <div className="pd-auth-hero">
        <div className="pd-auth-logo-badge">
          <span className="pd-auth-pulse-dot" />
          <span>Dynamic Wema Virtual Accounts · 100% Kora Verified</span>
        </div>
        <div className="pd-auth__mark" style={{ margin: '0 auto 12px' }}>
          <span className="pd-ping" aria-hidden="true"><i /><i /><i /></span>
          <LogoMark size={84} tone="dark" />
        </div>
        <h1 className="pd-auth-title">paidar</h1>
        <p className="pd-auth-subtitle">
          Instant bank transfer verification for Nigerian businesses. Collect customer payments with one-time 60-minute accounts and zero fake receipt anxiety.
        </p>
      </div>

      <RiskBanner />
      {expired && phase !== 'checking' && (
        <div style={{ maxWidth: 440, width: '100%', marginBottom: 16 }}>
          <Banner tone="warn">Your session ended. Sign in again to continue where you left off.</Banner>
        </div>
      )}

      {phase === 'checking' && (
        <div className="pd-auth-card" style={{ textAlign: 'center' }}>
          <p className="pd-auth__msg" role="status">Validating your business access…</p>
        </div>
      )}

      {phase === 'failed' && (
        <div className="pd-auth-card" style={{ textAlign: 'center', marginBottom: 16 }}>
          <h3 style={{ color: '#FF8FA0', margin: '0 0 8px' }}>{failMsg}</h3>
          <p style={{ color: '#A99FCB', fontSize: 14, margin: '0 0 16px' }}>
            Please enter your business name below to launch your workspace.
          </p>
        </div>
      )}

      {phase !== 'checking' && (
        <div className="pd-auth-card">
          <div className="pd-auth-cardhead">
            <h2>Access Business Workspace</h2>
            <p>Enter your business name to open your dashboard or start fresh.</p>
          </div>

          <form onSubmit={(e) => void submitLogin(e)}>
            <TextField
              label="Business name"
              value={devName}
              onChange={(e) => setDevName(e.target.value)}
              placeholder="e.g. Tolu’s Glam Studio"
              error={devErr}
              autoComplete="organization"
              autoFocus
            />

            <div className="pd-auth-chips">
              <span style={{ width: '100%', fontSize: 12, color: '#8C82AE', marginBottom: 2 }}>Quick select demo businesses:</span>
              <button
                type="button"
                className="pd-auth-chip"
                onClick={() => {
                  setDevName("Tolu’s Glam Studio");
                  void submitLogin(undefined, "Tolu’s Glam Studio");
                }}
              >
                Tolu’s Glam Studio
              </button>
              <button
                type="button"
                className="pd-auth-chip"
                onClick={() => {
                  setDevName("Amina Couture");
                  void submitLogin(undefined, "Amina Couture");
                }}
              >
                Amina Couture
              </button>
              <button
                type="button"
                className="pd-auth-chip"
                onClick={() => {
                  setDevName("De-True Photography");
                  void submitLogin(undefined, "De-True Photography");
                }}
              >
                De-True Photography
              </button>
            </div>

            <button type="submit" className="pd-btn-glow" disabled={devBusy}>
              {devBusy ? 'Opening Workspace…' : 'Launch Business Dashboard →'}
            </button>
          </form>
        </div>
      )}

      <div className="pd-auth-features">
        <div className="pd-auth-feat">
          <span className="pd-auth-feat-icon">⚡</span>
          <h3>Dynamic 60m Accounts</h3>
          <p>Every request generates a one-time Wema Bank virtual account with an active 60-minute countdown.</p>
        </div>
        <div className="pd-auth-feat">
          <span className="pd-auth-feat-icon">🛡️</span>
          <h3>Automated Bank Settlement</h3>
          <p>Direct Kora credit webhook confirmation. No screenshot checks, no fake SMS alerts.</p>
        </div>
        <div className="pd-auth-feat">
          <span className="pd-auth-feat-icon">💬</span>
          <h3>Provider-Controlled Copy</h3>
          <p>You copy the payment details and paste them into customer WhatsApp or Instagram chats.</p>
        </div>
      </div>
    </div>
  );
}
