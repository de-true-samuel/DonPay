import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/hooks';
import { CopyChip } from '../ui/CopyChip';
import { LogoMark } from '../ui/Logo';
import { Status } from '../ui/StatusChip';

export function ServerErrorPage() {
  useDocumentTitle('Something broke on our side');
  const errorId = `ERR-${Date.now().toString(36).toUpperCase().slice(-6)}`;

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="pf-card" style={{ maxWidth: 480, width: '100%', textAlign: 'center', padding: 32, display: 'grid', gap: 16, justifyItems: 'center' }}>
        <LogoMark size={36} />
        <Status tone="flare" icon="alert" label="500 · Server error" />
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 4vw, 40px)', lineHeight: 1.05, letterSpacing: '-0.03em' }}>
          Something broke on our side.
        </h1>
        <p style={{ color: 'var(--ink-2)' }}>
          Your financial records and jobs are safe. Please try again.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span className="pd-mono" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
            {errorId}
          </span>
          <CopyChip value={errorId} label="Copy ID" copyLabel="Error ID" />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="pf-btn pf-btn--primary" onClick={() => window.location.reload()}>
            Try again
          </button>
          <Link to="/app" className="pf-btn pf-btn--secondary">Go to dashboard</Link>
        </div>
      </div>
    </main>
  );
}

export function MaintenancePage() {
  useDocumentTitle('Scheduled maintenance');
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="pf-card" style={{ maxWidth: 480, width: '100%', textAlign: 'center', padding: 32, display: 'grid', gap: 16, justifyItems: 'center' }}>
        <LogoMark size={36} />
        <Status tone="solar" icon="clock" label="Scheduled maintenance" />
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 4vw, 40px)', lineHeight: 1.05, letterSpacing: '-0.03em' }}>
          We’ll be right back.
        </h1>
        <p style={{ color: 'var(--ink-2)' }}>
          Paidar is undergoing brief maintenance. None of your payment records or jobs were lost.
        </p>
        <button type="button" className="pf-btn pf-btn--secondary" onClick={() => window.location.reload()}>
          Check again
        </button>
      </div>
    </main>
  );
}
