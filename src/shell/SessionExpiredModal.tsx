import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/endpoints';
import { describeError } from '../api/errors';
import { ME_KEY, useAuth } from '../auth/AuthProvider';

/**
 * GLB-16: Session-expired modal.
 * Keeps the underlying route mounted so dirty form state is preserved after re-authentication.
 */
export function SessionExpiredModal() {
  const { expired, clearExpired } = useAuth();
  const qc = useQueryClient();
  const [businessName, setBusinessName] = useState("Tolu's Glam Studio");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!expired) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res = await authApi.devLogin(businessName.trim() || "Tolu's Glam Studio");
      qc.setQueryData(ME_KEY, res.provider);
      clearExpired();
    } catch (error) {
      setErr(describeError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="pf-sheet-backdrop"
      style={{ alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 80 }}
      data-flow-id="GLB-16"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Session expired"
        className="pf-card"
        style={{ maxWidth: 420, width: '100%' }}
      >
        <h2 style={{ marginBottom: 6 }}>Your session expired</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Log in to continue. Any details you typed on this page will be preserved.
        </p>

        <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label htmlFor="reauth-biz" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Business name
            </label>
            <input
              id="reauth-biz"
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              style={{
                width: '100%', height: 44, padding: '0 12px', borderRadius: 9,
                border: '1px solid var(--border-strong)',
              }}
            />
          </div>

          {err && <p style={{ color: 'var(--status-danger)', fontSize: 13 }}>{err}</p>}

          <button type="submit" disabled={busy} className="pf-btn pf-btn--primary">
            {busy ? 'Signing in…' : 'Log in to continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
