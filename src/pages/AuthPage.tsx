import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '../api/client';
import { describeError } from '../api/errors';
import { authApi } from '../api/endpoints';
import { ME_KEY, useAuth } from '../auth/AuthProvider';
import { BOT_URL, DEV_LOGIN, MOCK } from '../config';
import type { Provider } from '../contract/contract';
import { useDocumentTitle } from '../lib/hooks';
import { isOnboarded } from '../lib/onboarding';
import { LogoMark } from '../ui/Logo';
import { RiskBanner } from '../shell/Banners';
import { Banner, Button, TextField } from '../ui/primitives';

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
  const [devName, setDevName] = useState('');
  const [devErr, setDevErr] = useState('');
  const [devBusy, setDevBusy] = useState(false);
  const ran = useRef(false);

  const finish = useCallback((p: Provider) => {
    qc.setQueryData(ME_KEY, p);
    clearExpired();
    nav(isOnboarded(p.id) ? from : '/onboarding', { replace: true });
  }, [qc, nav, clearExpired, from]);

  // Exchange the one-time token from the Telegram link. The ref stops React's dev double-run from using it twice.
  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    authApi.exchange(token)
      .then((r) => finish(r.provider))
      .catch((e: unknown) => {
        setFailMsg(e instanceof ApiRequestError && e.status === 401
          ? 'This link has expired or was already used.'
          : describeError(e).message);
        setPhase('failed');
      });
  }, [token, finish]);

  useEffect(() => {
    if (status === 'authed' && !token) nav(from, { replace: true });
  }, [status, token, nav, from]);

  async function devLogin(e: FormEvent) {
    e.preventDefault();
    setDevErr('');
    setDevBusy(true);
    try {
      const r = await authApi.devLogin(devName.trim());
      finish(r.provider);
    } catch (err) {
      setDevErr(describeError(err).fieldErrors?.businessName?.[0] ?? describeError(err).message);
      setDevBusy(false);
    }
  }

  return (
    <div className="pd-night pd-auth">
      <div className="pd-auth__mark">
        <span className="pd-ping" aria-hidden="true"><i /><i /><i /></span>
        <LogoMark size={96} tone="dark" />
      </div>
      <h1 className="pd-auth__word">paidar</h1>
      <RiskBanner />
      {expired && phase !== 'checking' && (
        <Banner tone="warn">Your session ended. Sign in again and you’ll come back to where you were.</Banner>
      )}

      {phase === 'checking' && (
        <p className="pd-auth__msg" role="status">Checking your link…</p>
      )}

      {phase === 'failed' && (
        <div className="pd-auth__block" role="alert">
          <h2>{failMsg}</h2>
          <p>Open the Paidar bot in Telegram and send <code>/login</code> to get a fresh link, or <code>/start</code> if you’re new.</p>
        </div>
      )}

      {phase === 'idle' && (
        <div className="pd-auth__block">
          <h2>Sign in or get started</h2>
          <p>Paidar signs you in through its Telegram bot. Send <code>/login</code> to sign in, or <code>/start</code> if you’re new, then tap the link it gives you.</p>
        </div>
      )}

      {phase !== 'checking' && BOT_URL && (
        <a className="pd-btn pd-btn--primary" href={BOT_URL} target="_blank" rel="noopener noreferrer">
          <span>Open Telegram</span>
        </a>
      )}

      {phase !== 'checking' && DEV_LOGIN && (
        <form className="pd-auth__dev" onSubmit={devLogin}>
          <p>{MOCK ? 'Demo mode: no backend needed.' : 'Developer sign-in.'}</p>
          <TextField label="Business name" value={devName} onChange={(e) => setDevName(e.target.value)}
            placeholder="Tolu’s Glam Studio" error={devErr} autoComplete="organization" />
          <Button type="submit" variant="line" busy={devBusy} disabled={!devName.trim()}>Continue with demo</Button>
        </form>
      )}
    </div>
  );
}
