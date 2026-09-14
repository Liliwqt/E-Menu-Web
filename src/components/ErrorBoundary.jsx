import React from 'react';
import { buildRecoveryUrl } from '../lib/chunkRecovery';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error:', error, info);
  }

  /**
   * Reloads past the browser's cache.
   *
   * This is the last resort screen, so its reload has to be the one most likely
   * to work. A plain reload re-requests the same URL, and if the cached
   * index.html is what caused the failure the browser hands back the same
   * document. Navigating to a marked URL forces a network fetch.
   */
  handleReload = () => {
    window.location.replace(buildRecoveryUrl(window.location.href));
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)', color: 'var(--text-1)', fontFamily: 'var(--font-ui)' }}>
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <h1 style={{ fontSize: '1.4rem', marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ color: 'var(--text-3)', marginBottom: 20 }}>
              An unexpected error occurred. Reloading usually fixes it.
            </p>
            <button className="btn btn--primary" onClick={this.handleReload}>Reload app</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
