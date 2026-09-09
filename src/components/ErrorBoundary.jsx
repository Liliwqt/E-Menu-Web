import React from 'react';

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

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)', color: 'var(--text-1)', fontFamily: 'var(--font-ui)' }}>
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <h1 style={{ fontSize: '1.4rem', marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ color: 'var(--text-3)', marginBottom: 20 }}>
              An unexpected error occurred. Reloading usually fixes it.
            </p>
            <button className="btn btn--primary" onClick={() => window.location.reload()}>Reload app</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
