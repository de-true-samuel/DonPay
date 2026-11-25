import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/hooks';
import { LogoMark } from '../ui/Logo';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <main
      style={{
        minHeight: '60dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      data-flow-id="GLB-20"
    >
      <div className="pf-card" style={{ maxWidth: 460, width: '100%', textAlign: 'center', padding: 32 }}>
        <div style={{ display: 'inline-flex', marginBottom: 14 }}>
          <LogoMark size={32} />
        </div>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>We can’t find that page.</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
          The link may have expired or the page may have moved.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/app" className="pf-btn pf-btn--primary">Go to dashboard</Link>
          <Link to="/" className="pf-btn pf-btn--secondary">Go home</Link>
        </div>
      </div>
    </main>
  );
}
