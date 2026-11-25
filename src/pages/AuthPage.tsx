import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { SignIn } from '@clerk/react';
import { CLERK_KEY, DEV_LOGIN } from '../config';
import { ApiRequestError } from '../api/client';
import { describeError } from '../api/errors';
import { authApi } from '../api/endpoints';
import { ME_KEY, useAuth } from '../auth/AuthProvider';
import type { Provider } from '../contract/contract';
import { useDocumentTitle } from '../lib/hooks';
import { isOnboarded, markOnboarded } from '../lib/onboarding';
import { RiskBanner } from '../shell/Banners';
import { Banner } from '../ui/primitives';
import { AuthSplitShell } from './AuthSuitePages';

type Phase = 'idle' | 'checking' | 'failed';

const PRESETS = ["Tolu's Glam Studio", 'Amina Couture', 'De-True Tailoring'];

export function AuthPage() {
  useDocumentTitle('Log in · Paidar');
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
    !rawFrom.startsWith('/login') &&
    !rawFrom.startsWith('//')
      ? rawFrom
      : '/app';

  const [phase, setPhase] = useState<Phase>(token ? 'checking' : 'idle');
  const [failMsg, setFailMsg] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [businessName, setBusinessName] = useState("Tolu's Glam Studio");
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ran = useRef(false);

  const finish = useCallback(
    (p: Provider) => {
      qc.setQueryData(ME_KEY, p);
      clearExpired();
      nav(isOnboarded(p.id) ? from : '/onboarding', { replace: true });
    },
    [qc, nav, clearExpired, from],
  );

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
            : describeError(e).message,
        );
        setPhase('failed');
      });
  }, [token, finish]);

  useEffect(() => {
    if (status === 'authed' && !token) nav(from, { replace: true });
  }, [status, token, nav, from]);

  async function submitWorkspace(e?: FormEvent, targetName?: string) {
    if (e) e.preventDefault();
    const finalName = (targetName ?? businessName).trim() || email.split('@')[0]?.trim() || "Tolu's Glam Studio";
    setErr('');
    setBusy(true);
    try {
      const r = await authApi.devLogin(finalName);
      markOnboarded(r.provider.id);
      finish(r.provider);
    } catch (error) {
      setErr(describeError(error).fieldErrors?.businessName?.[0] ?? describeError(error).message);
      setBusy(false);
    }
  }

  return (
    <AuthSplitShell>
      <div data-flow-id="LGN-00">
        <RiskBanner />

        {expired && (
          <Banner tone="warn">Your session ended. Log in again to continue.</Banner>
        )}

        {phase === 'checking' && (
          <div style={{ padding: '24px 0' }}>
            <h1 style={{ fontSize: 24, marginBottom: 6 }}>Opening your workspace…</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Checking your sign-in link.</p>
          </div>
        )}

        {phase === 'failed' && (
          <div>
            <h1 style={{ fontSize: 24, marginBottom: 8 }}>Link didn’t work</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 18 }}>{failMsg}</p>
            <button type="button" className="pf-btn pf-btn--secondary" onClick={() => setPhase('idle')}>
              Back to log in
            </button>
          </div>
        )}

        {phase === 'idle' && (
          <>
            {CLERK_KEY ? (
              <div>
                <h1 style={{ fontSize: 26, marginBottom: 16 }}>Log in to your workspace</h1>
                <SignIn routing="hash" />
              </div>
            ) : (
              <div>
                <h1 style={{ fontSize: 26, marginBottom: 6 }}>Log in</h1>
                <p style={{ color: 'var(--text-secondary)', marginBottom: 22 }}>
                  Access your payment requests, work queue, and ledger.
                </p>

                <form onSubmit={(e) => void submitWorkspace(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {DEV_LOGIN ? (
                    <div>
                      <label htmlFor="lgn-biz" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                        Business or studio name
                      </label>
                      <input
                        id="lgn-biz"
                        type="text"
                        value={businessName}
                        onChange={(e) => { setBusinessName(e.target.value); setErr(''); }}
                        placeholder="e.g. Tolu's Glam Studio"
                        style={{ width: '100%', height: 46, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
                      />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {PRESETS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => { setBusinessName(p); void submitWorkspace(undefined, p); }}
                            style={{
                              padding: '4px 10px', borderRadius: 999, border: '1px solid var(--border-default)',
                              background: 'var(--bg-surface-subtle)', fontSize: 12, cursor: 'pointer',
                            }}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label htmlFor="lgn-email" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                          Email
                        </label>
                        <input
                          id="lgn-email"
                          type="email"
                          autoComplete="username"
                          value={email}
                          onChange={(e) => { setEmail(e.target.value); setErr(''); }}
                          placeholder="tunde@studio.ng"
                          data-flow-id="LGN-01"
                          style={{ width: '100%', height: 46, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
                        />
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <label htmlFor="lgn-pw" style={{ fontSize: 13, fontWeight: 600 }}>Password</label>
                          <Link
                            to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`}
                            data-flow-id="LGN-05"
                            style={{ fontSize: 12.5, textDecoration: 'none' }}
                          >
                            Forgot password?
                          </Link>
                        </div>
                        <div style={{ position: 'relative' }}>
                          <input
                            id="lgn-pw"
                            type={showPw ? 'text' : 'password'}
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => { setPassword(e.target.value); setErr(''); }}
                            data-flow-id="LGN-02"
                            style={{ width: '100%', height: 46, padding: '0 64px 0 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
                          />
                          <button
                            type="button"
                            aria-pressed={showPw}
                            onClick={() => setShowPw((v) => !v)}
                            data-flow-id="LGN-03"
                            style={{
                              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                              border: 0, background: 'transparent', color: 'var(--action-primary)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '6px 8px',
                            }}
                          >
                            {showPw ? 'Hide' : 'Show'}
                          </button>
                        </div>
                      </div>

                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }} data-flow-id="LGN-04">
                        <input type="checkbox" checked={keepSignedIn} onChange={(e) => setKeepSignedIn(e.target.checked)} />
                        <span>Keep me signed in</span>
                      </label>
                    </>
                  )}

                  {err && <p role="alert" style={{ color: 'var(--status-danger)', fontSize: 13 }}>{err}</p>}

                  <button type="submit" disabled={busy} className="pf-btn pf-btn--primary" style={{ height: 48 }} data-flow-id="LGN-06">
                    {busy ? 'Signing in…' : 'Log in'}
                  </button>
                </form>

                <p style={{ marginTop: 20, fontSize: 13.5, color: 'var(--text-secondary)', textAlign: 'center' }}>
                  New here? <Link to="/signup" data-flow-id="LGN-08">Create an account</Link>
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </AuthSplitShell>
  );
}
