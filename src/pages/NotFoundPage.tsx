import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/hooks';
import { LogoMark } from '../ui/Logo';
import { Status } from '../ui/StatusChip';

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
      <div className="pf-card" style={{ maxWidth: 480, width: '100%', textAlign: 'center', padding: 32, display: 'grid', gap: 16, justifyItems: 'center' }}>
        <LogoMark size={36} />
        <Status tone="slate" icon="minus-circle" label="404 · Not found" />
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 4vw, 40px)', lineHeight: 1.05, letterSpacing: '-0.03em' }}>
          We can’t find that page.
        </h1>
        <p style={{ color: 'var(--ink-2)' }}>
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
