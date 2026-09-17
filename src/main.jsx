import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SubscriptionProvider } from './context/SubscriptionContext';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { LiveAnalystProvider } from './context/LiveAnalystProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { stripRecoveryMarker } from './lib/chunkRecovery';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';

// A stale-chunk retry arrives on a marked URL — see lib/chunkRecovery.js. The
// marker has done its job by the time the app is running, so the address bar goes
// back to the URL the user actually asked for. Done before the render below, so
// nothing observes the marked URL.
const cleanedHref = stripRecoveryMarker(window.location.href);
if (cleanedHref) window.history.replaceState(null, '', cleanedHref);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <SubscriptionProvider>
              <LiveAnalystProvider>
                <App />
              </LiveAnalystProvider>
            </SubscriptionProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
