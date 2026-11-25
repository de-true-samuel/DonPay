import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/hooks';
import { LogoMark } from '../ui/Logo';

export function ServerErrorPage() {
  useDocumentTitle('Something broke on our side');
  const errorId = `ERR-${Date.now().toString(36).toUpperCase().slice(-6)}`;

  return (
    <main style={{ minHeight: '100dvh', background: 'var(--bg-canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="pf-card" style={{ maxWidth: 460, width: '100%', textAlign: 'center', padding: 32 }}>
        <div style={{ display: 'inline-flex', marginBottom: 14 }}>
          <LogoMark size={32} />
        </div>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Something broke on our side.</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
          Your financial records and jobs are safe. Please try again.
        </p>
        <p className="pd-mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
          Error ID: {errorId}
        </p>
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
    <main style={{ minHeight: '100dvh', background: 'var(--bg-canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="pf-card" style={{ maxWidth: 460, width: '100%', textAlign: 'center', padding: 32 }}>
        <div style={{ display: 'inline-flex', marginBottom: 14 }}>
          <LogoMark size={32} />
        </div>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>We’ll be right back.</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
          Paidar is undergoing brief maintenance. None of your payment records or jobs were lost.
        </p>
        <button type="button" className="pf-btn pf-btn--secondary" onClick={() => window.location.reload()}>
          Check again
        </button>
      </div>
    </main>
  );
}
