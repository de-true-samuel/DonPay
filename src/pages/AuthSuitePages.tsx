import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/endpoints';
import { ME_KEY } from '../auth/AuthProvider';
import { useDocumentTitle } from '../lib/hooks';
import { maskEmail, setPendingVerificationEmail } from '../lib/emailVerify';
import { markOnboarded } from '../lib/onboarding';
import { Icon } from '../ui/Icon';
import { LogoMark } from '../ui/Logo';

/**
 * Shared Desktop Split Composition (Spec §9.2):
 * - Left: Midnight Navy brand panel (#111B33) with abstract payment-to-work fragment
 * - Right: White surface, centered 420px form
 * - Mobile: single column with compact header
 */
export function AuthSplitShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
      {/* Left Obsidian Brand Panel (§6.2) */}
      <aside
        className="pf-auth-brand"
        style={{
          background: 'var(--bg-1)',
          borderRight: '1px solid var(--line-1)',
          color: 'var(--ink-1)',
          padding: '40px 44px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--ink-1)', textDecoration: 'none', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.03em' }}>
            <LogoMark size={28} />
            <span>paidar</span>
          </Link>
        </div>

        <div className="ob-auth-hide-sm" style={{ maxWidth: 420, margin: '48px 0' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 1.15, fontWeight: 700, color: 'var(--ink-1)', marginBottom: 14 }}>
            Payment verified. Work in motion.
          </h2>
          <p style={{ color: 'var(--ink-2)', fontSize: 15, lineHeight: 1.55, marginBottom: 28 }}>
            Create a payment request, share it with your client, and let verified payment activity move the right job into your work queue.
          </p>

          <div className="ob-tile" style={{ padding: 16 }}>
            <div className="ob-overline" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>VERIFIED EVENT</span>
              <span className="pd-mono">KORA-REF</span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="shield" size={16} />
              <span className="pd-mono" style={{ color: 'var(--mint-ink)' }}>₦25,000.00</span>
              <span>confirmed → Job #1 Ready</span>
            </div>
          </div>
        </div>

        <div className="ob-auth-hide-sm ob-overline">
          Nigeria · NGN · Africa/Lagos
        </div>
      </aside>

      {/* Right Form Surface on Canvas */}
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>
        <div style={{ width: '100%', maxWidth: 420 }}>{children}</div>
      </main>
    </div>
  );
}

function passwordStrength(pw: string): { label: 'Weak' | 'Okay' | 'Strong'; color: string; tip: string } {
  if (pw.length < 10) return { label: 'Weak', color: 'var(--flare-ink)', tip: 'Use at least 10 characters.' };
  if (/[A-Z]/.test(pw) && /\d/.test(pw) && pw.length >= 12) {
    return { label: 'Strong', color: 'var(--mint-ink)', tip: 'Strong password.' };
  }
  return { label: 'Okay', color: 'var(--solar-ink)', tip: "Add a word or number you'll remember." };
}

export function SignupPage() {
  useDocumentTitle('Create your account · Paidar');
  const nav = useNavigate();
  const qc = useQueryClient();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const strength = passwordStrength(password);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (fullName.trim().length < 2 || fullName.trim().length > 80) {
      setErr('Enter your full name (2–80 characters).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErr('Enter a valid email address.');
      return;
    }
    if (password.length < 10) {
      setErr('Password must be at least 10 characters.');
      return;
    }
    if (!agreed) {
      setErr('Please accept the Terms and Privacy policy to continue.');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const studioName = `${fullName.trim().split(' ')[0]}'s Studio`;
      const r = await authApi.devLogin(studioName);
      qc.setQueryData(ME_KEY, r.provider);
      setPendingVerificationEmail(email.trim().toLowerCase());
      nav(`/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`, { replace: true });
    } catch (error) {
      setErr((error as Error).message || 'Could not create account.');
      setBusy(false);
    }
  }

  return (
    <AuthSplitShell>
      <div data-flow-id="SGN-00">
        <h1 style={{ fontSize: 26, marginBottom: 6 }}>Create your account</h1>
        <p style={{ color: 'var(--ink-2)', marginBottom: 24 }}>Start tracking verified payments and jobs in under 5 minutes.</p>

        <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="pd-field">
            <label htmlFor="sgn-name" className="pd-label">Full name</label>
            <input
              id="sgn-name"
              type="text"
              className="pd-input"
              autoComplete="name"
              value={fullName}
              onChange={(e) => { setFullName(e.target.value); setErr(''); }}
              placeholder="Tunde Bakare"
              data-flow-id="SGN-01"
            />
          </div>

          <div className="pd-field">
            <label htmlFor="sgn-email" className="pd-label">Email</label>
            <input
              id="sgn-email"
              type="email"
              className="pd-input"
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErr(''); }}
              placeholder="tunde@studio.ng"
              data-flow-id="SGN-02"
            />
          </div>

          <div className="pd-field">
            <label htmlFor="sgn-pw" className="pd-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="sgn-pw"
                type={showPw ? 'text' : 'password'}
                className="pd-input"
                autoComplete="new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErr(''); }}
                placeholder="At least 10 characters"
                data-flow-id="SGN-03"
                style={{ paddingRight: 68 }}
              />
              <button
                type="button"
                aria-pressed={showPw}
                onClick={() => setShowPw((v) => !v)}
                data-flow-id="SGN-04"
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  border: 0, background: 'transparent', color: 'var(--active-ink)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '6px 8px',
                }}
              >
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
            {password && (
              <p style={{ fontSize: 12, marginTop: 4, color: strength.color }}>
                Strength: <strong>{strength.label}</strong> — {strength.tip}
              </p>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }} data-flow-id="SGN-05">
            <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); setErr(''); }} style={{ accentColor: 'var(--volt)' }} />
            <span>I accept the Terms and Privacy notice.</span>
          </label>

          {err && <p role="alert" className="pd-error">{err}</p>}

          <button type="submit" disabled={busy} className="pf-btn pf-btn--primary" data-flow-id="SGN-06">
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p style={{ marginTop: 20, fontSize: 13.5, color: 'var(--ink-2)', textAlign: 'center' }}>
          Already have an account? <Link to="/login" data-flow-id="SGN-08">Log in</Link>
        </p>
      </div>
    </AuthSplitShell>
  );
}

export function VerifyEmailPage() {
  useDocumentTitle('Verify your email · Paidar');
  const [params] = useSearchParams();
  const nav = useNavigate();
  const initial = params.get('email') || 'tunde@studio.ng';
  const [email, setEmail] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function resend() {
    setCooldown(60);
    setNotice(`Sent a fresh verification link to ${email}.`);
  }

  function skipForNow() {
    setPendingVerificationEmail(email);
    nav('/onboarding', { replace: true });
  }

  function completeVerificationDemo() {
    setPendingVerificationEmail(null);
    markOnboarded('verified');
    nav('/onboarding', { replace: true });
  }

  return (
    <AuthSplitShell>
      <div data-flow-id="VFY-00">
        <div className="ob-status ob-status--solar" style={{ padding: 10, borderRadius: 'var(--r-sm)', marginBottom: 14 }}>
          <Icon name="send" size={20} />
        </div>
        <h1 style={{ fontSize: 26, marginBottom: 8 }}>Check your inbox</h1>
        <p style={{ color: 'var(--ink-2)', marginBottom: 20 }} data-flow-id="VFY-01">
          We sent a verification link to <strong style={{ color: 'var(--ink-1)' }}>{maskEmail(email)}</strong>.
        </p>

        {notice && (
          <p role="status" className="ob-status ob-status--mint" style={{ width: '100%', padding: '10px 12px', marginBottom: 14, whiteSpace: 'normal' }}>
            <Icon name="shield" size={16} />
            <span>{notice}</span>
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button type="button" disabled={cooldown > 0} onClick={resend} className="pf-btn pf-btn--primary" data-flow-id="VFY-03">
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
          </button>

          <button type="button" onClick={completeVerificationDemo} className="pf-btn pf-btn--secondary">
            I’ve verified my email
          </button>

          <button type="button" onClick={() => setEditing((v) => !v)} data-flow-id="VFY-04" className="pf-btn pf-btn--sm pf-btn--quiet">
            Change email
          </button>
        </div>

        {editing && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <input
              type="email"
              className="pd-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ flex: 1, minHeight: 42 }}
            />
            <button type="button" className="pf-btn pf-btn--sm pf-btn--primary" onClick={() => { setEditing(false); resend(); }}>
              Update
            </button>
          </div>
        )}

        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--line-1)', textAlign: 'center' }}>
          <button type="button" onClick={skipForNow} data-flow-id="VFY-05" className="pf-btn pf-btn--sm pf-btn--quiet">
            Skip for now, explore the app
          </button>
        </div>
      </div>
    </AuthSplitShell>
  );
}

export function ForgotPasswordPage() {
  useDocumentTitle('Reset password · Paidar');
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSent(true);
    setCooldown(60);
  }

  return (
    <AuthSplitShell>
      <div data-flow-id="FPW-00">
        <h1 style={{ fontSize: 26, marginBottom: 8 }}>Reset your password</h1>
        {!sent ? (
          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ color: 'var(--ink-2)' }}>Enter your account email and we’ll send you a reset link.</p>
            <div className="pd-field">
              <label htmlFor="fpw-email" className="pd-label">Email</label>
              <input
                id="fpw-email"
                type="email"
                className="pd-input"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-flow-id="FPW-01"
              />
            </div>
            <button type="submit" className="pf-btn pf-btn--primary" data-flow-id="FPW-02">Send reset link</button>
          </form>
        ) : (
          <div data-flow-id="FPW-03" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p className="ob-tile" style={{ padding: 14, fontSize: 14, color: 'var(--ink-2)' }}>
              If that email has an account, we’ve sent a reset link.
            </p>
            <button type="button" disabled={cooldown > 0} onClick={() => setCooldown(60)} className="pf-btn pf-btn--secondary">
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
            </button>
          </div>
        )}
        <p style={{ marginTop: 20, fontSize: 13.5 }}>
          <Link to="/login" data-flow-id="FPW-04">Back to log in</Link>
        </p>
      </div>
    </AuthSplitShell>
  );
}

export function ResetPasswordPage() {
  useDocumentTitle('Set new password · Paidar');
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <AuthSplitShell>
        <div data-flow-id="RPW-05">
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>This link has expired.</h1>
          <p style={{ color: 'var(--ink-2)', marginBottom: 18 }}>Reset links last 1 hour and are single-use.</p>
          <Link to="/forgot-password" className="pf-btn pf-btn--primary">Request a new one</Link>
        </div>
      </AuthSplitShell>
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 10) { setErr('Password must be at least 10 characters.'); return; }
    if (pw !== confirm) { setErr('Passwords do not match.'); return; }
    setErr('');
    setDone(true);
    setTimeout(() => nav('/login', { replace: true }), 2000);
  }

  return (
    <AuthSplitShell>
      <div data-flow-id="RPW-00">
        <h1 style={{ fontSize: 26, marginBottom: 8 }}>Set a new password</h1>
        {done ? (
          <p className="ob-status ob-status--mint" style={{ width: '100%', padding: 14 }}>
            <Icon name="shield" size={16} />
            <span>Password updated. Redirecting to log in…</span>
          </p>
        ) : (
          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="pd-field">
              <label htmlFor="rpw-new" className="pd-label">New password</label>
              <input
                id="rpw-new"
                type={show ? 'text' : 'password'}
                className="pd-input"
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                data-flow-id="RPW-01"
              />
            </div>
            <div className="pd-field">
              <label htmlFor="rpw-confirm" className="pd-label">Confirm password</label>
              <input
                id="rpw-confirm"
                type={show ? 'text' : 'password'}
                className="pd-input"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                data-flow-id="RPW-02"
              />
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-2)' }}>
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} data-flow-id="RPW-03" style={{ accentColor: 'var(--volt)' }} />
              <span>Show passwords</span>
            </label>
            {err && <p className="pd-error" role="alert">{err}</p>}
            <button type="submit" className="pf-btn pf-btn--primary" data-flow-id="RPW-04">Set new password</button>
          </form>
        )}
      </div>
    </AuthSplitShell>
  );
}
