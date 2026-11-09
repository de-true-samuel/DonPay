import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/** If a screen crashes, say so plainly and offer a way back, instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[paidar] screen crashed', error, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="pd-crash" role="alert">
        <h1>Something broke on this screen</h1>
        <p>Your payments are safe. Nothing you did here was lost on the server. Reloading usually fixes it.</p>
        <div className="pd-actions">
          <button className="pd-btn pd-btn--primary" onClick={() => window.location.reload()}><span>Reload</span></button>
          <a className="pd-btn pd-btn--line" href="/today"><span>Go to Today</span></a>
        </div>
      </div>
    );
  }
}
