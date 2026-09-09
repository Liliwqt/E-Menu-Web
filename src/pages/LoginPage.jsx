import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, X, Chrome } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isUserAdmin, getUserBranch } from '../config/authConfig';
import { isEmbeddedInKiosk } from '../lib/kioskBridge';
import '../styles/login.css';

const FOOTER_CONTENT = {
  help: {
    title: 'Need Help',
    sections: [
      { heading: 'Contact', body: 'For access or account support, contact your restaurant administrator or system support team. Include your branch name, registered email, and a short description of the issue.' },
      { heading: 'Basic Troubleshooting', body: 'Check your internet connection, confirm that your email address is entered correctly, and refresh the page if the login form does not respond.' },
      { heading: 'Login Assistance', body: 'Use Forgot Password to request a reset link. For branch access changes, ask the administrator to verify that your email is assigned to the correct branch.' },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      { heading: 'User Data', body: 'The portal uses account information such as email addresses and display names to authenticate users and route them to authorized branch tools.' },
      { heading: 'Restaurant Data', body: 'Menu items, order logs, inventory records, analytics, and branch settings are stored for operational reporting and restaurant management.' },
      { heading: 'Analytics and Storage', body: 'Analytics are calculated from real order activity. Firebase services store authentication, database, and configuration data needed to operate the platform.' },
    ],
  },
  cookies: {
    title: 'Cookie Notice',
    sections: [
      { heading: 'Session Usage', body: 'The portal uses browser storage to keep users signed in securely during active sessions.' },
      { heading: 'Authentication Persistence', body: 'When sign-in persistence is enabled, authentication state may remain available on the same device until the user signs out.' },
      { heading: 'Preferences', body: 'Local preferences such as theme choice and AI Analyst cache may be saved in the browser to improve day-to-day usability.' },
    ],
  },
  acceptableUse: {
    title: 'Acceptable Use Policy',
    sections: [
      { heading: 'Authorized Access', body: 'Use this portal only with an account assigned by the restaurant or platform administrator.' },
      { heading: 'Responsible Usage', body: 'Manage menus, inventory, orders, and analytics carefully. Review changes before saving and protect customer and restaurant information.' },
      { heading: 'Prohibited Activities', body: 'Do not share credentials, attempt unauthorized branch access, alter records dishonestly, or export data without permission.' },
    ],
  },
};

export default function LoginPage() {
  const navigate = useNavigate();
  const {
    login, register, loginWithGoogle, isAuthenticated, loading, error, user,
    workspace, workspaceLoaded, forgotPassword,
  } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  // When embedded in the Android kiosk WebView, Google OAuth popups cannot open,
  // so default to the email/password form instead of the Google button.
  const embedded = isEmbeddedInKiosk();
  const [mode, setMode] = useState(embedded ? 'login' : 'google');
  const [resetSuccess, setResetSuccess] = useState('');
  const [resetCooldown, setResetCooldown] = useState(0);
  const [activeFooterContent, setActiveFooterContent] = useState(null);
  const cooldownRef = useRef(null);

  const footerContent = activeFooterContent ? FOOTER_CONTENT[activeFooterContent] : null;

  useEffect(() => () => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?.email || !workspaceLoaded) return;
    if (isUserAdmin(user.email)) {
      navigate('/home-admin', { replace: true });
      return;
    }
    const branchId = getUserBranch(workspace);
    if (!branchId) {
      navigate('/setup', { replace: true });
      return;
    }
    navigate(`/home/${branchId}`, { replace: true });
  }, [isAuthenticated, user, workspace, workspaceLoaded, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError('');
    setResetSuccess('');

    if (!email.trim()) {
      setLocalError('Please enter your email');
      return;
    }

    if (isForgotPassword) {
      const success = await forgotPassword(email.trim());
      if (success) {
        setResetSuccess('Password reset link sent! Please check your email.');
        setResetCooldown(180);
        if (cooldownRef.current) clearInterval(cooldownRef.current);
        cooldownRef.current = setInterval(() => {
          setResetCooldown((prev) => {
            if (prev <= 1) {
              clearInterval(cooldownRef.current);
              cooldownRef.current = null;
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
      return;
    }

    if (!password) {
      setLocalError('Please enter your password');
      return;
    }

    const success = mode === 'register'
      ? await register(email.trim(), password)
      : await login(email.trim(), password);
    if (!success) setLocalError('');
  }

  async function handleGoogle() {
    setLocalError('');
    const success = await loginWithGoogle();
    if (!success) setLocalError('');
  }

  return (
    <div className="lg__page">
      <div className="lg__box">
        <div className="lg__logoSection">
          <h1 className="lg__brandName">E-Menu Portal</h1>
          <div className="lg__tagline">Restaurant Operations Management Platform</div>
        </div>

        {mode === 'google' ? (
          <div className="lg__form">
            <p className="lg__googleLead">
              Sign in with your Google account to manage your restaurant operations. We use Google to
              securely identify you and sync your access across the web dashboard and Android kiosk app.
            </p>
            <button type="button" className="lg__google lg__google--primary" onClick={handleGoogle} disabled={loading}>
              <Chrome size={18} />
              {loading ? 'Signing in…' : 'Continue with Google'}
            </button>

            {(localError || error) && (
              <div className="lg__error" role="alert">
                {localError || (typeof error === 'object' ? error.message : error)}
              </div>
            )}

            <div className="lg__divider"><span>or</span></div>

            <button
              type="button"
              className="lg__link lg__link--centered"
              onClick={() => {
                setMode('login');
                setLocalError('');
              }}
            >
              Sign in with email and password
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="lg__form">
            <div className="lg__group">
              <label htmlFor="email" className="lg__label">Email</label>
              <input
                id="email"
                type="email"
                placeholder="Enter your email"
                className="lg__input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>

            {!isForgotPassword && (
              <div className="lg__group">
                <label htmlFor="password" className="lg__label">Password</label>
                <div className="lg__passwordWrap">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    className="lg__input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  />
                  <button
                    type="button"
                    className="lg__toggle"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Mask password' : 'Reveal password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>
            )}

            {(localError || error) && (
              <div className="lg__error" role="alert">
                {localError || (typeof error === 'object' ? error.message : error)}
              </div>
            )}

            {resetSuccess && <div className="lg__ok" role="status">{resetSuccess}</div>}

            {!isForgotPassword ? (
              <>
                <div className="lg__options">
                  <label className="lg__stay">
                    <input
                      type="checkbox"
                      checked={staySignedIn}
                      onChange={(e) => setStaySignedIn(e.target.checked)}
                      disabled={loading}
                    />
                    Stay signed in
                  </label>
                  <button
                    type="button"
                    className="lg__link"
                    onClick={() => {
                      setIsForgotPassword(true);
                      setLocalError('');
                      setResetSuccess('');
                    }}
                  >
                    Forgot Password?
                  </button>
                </div>

                <button type="submit" className="lg__submit" disabled={loading}>
                  {loading && <span className="lg__spinner" aria-hidden="true" />}
                  {loading ? (mode === 'register' ? 'Creating account…' : 'Logging in…') : (mode === 'register' ? 'Create account' : 'Log In')}
                </button>
                <p className="lg__switch">
                  {mode === 'register' ? 'Already have an account?' : 'New to E-Menu Portal?'}{' '}
                  <button
                    type="button"
                    className="lg__link"
                    onClick={() => { setMode((current) => current === 'register' ? 'login' : 'register'); setLocalError(''); }}
                  >
                    {mode === 'register' ? 'Log in' : 'Create an account'}
                  </button>
                </p>
                <div className="lg__divider"><span>or</span></div>
                {!embedded && (
                  <button
                    type="button"
                    className="lg__link lg__link--centered"
                    onClick={() => { setMode('google'); setLocalError(''); }}
                  >
                    Back to Google sign-in
                  </button>
                )}
              </>
            ) : (
              <>
                <button type="submit" className="lg__submit" disabled={loading || resetCooldown > 0}>
                  {loading && <span className="lg__spinner" aria-hidden="true" />}
                  {loading
                    ? 'Sending…'
                    : resetCooldown > 0
                      ? `Resend in ${Math.floor(resetCooldown / 60)}:${String(resetCooldown % 60).padStart(2, '0')}`
                      : 'Send Reset Link'}
                </button>
                <button
                  type="button"
                  className="lg__back"
                  onClick={() => {
                    setIsForgotPassword(false);
                    setLocalError('');
                    setResetSuccess('');
                  }}
                >
                  Back to Login
                </button>
              </>
            )}
          </form>
        )}

        <div className="lg__footer">
          <button type="button" className="lg__footerLink" onClick={() => setActiveFooterContent('help')}>Need Help</button>
          <button type="button" className="lg__footerLink" onClick={() => setActiveFooterContent('privacy')}>Privacy Policy</button>
          <button type="button" className="lg__footerLink" onClick={() => setActiveFooterContent('cookies')}>Cookie Notice</button>
          <button type="button" className="lg__footerLink" onClick={() => setActiveFooterContent('acceptableUse')}>Acceptable Use Policy</button>
        </div>
        <div className="lg__powered">Powered by Touch</div>
      </div>

      {footerContent && (
        <div className="lg__modalOverlay" onClick={() => setActiveFooterContent(null)}>
          <div
            className="lg__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="footer-info-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="lg__modalHead">
              <h2 id="footer-info-title">{footerContent.title}</h2>
              <button type="button" className="lg__modalClose" onClick={() => setActiveFooterContent(null)} aria-label="Close dialog">
                <X size={16} />
              </button>
            </div>
            <div className="lg__modalBody">
              {footerContent.sections.map((section) => (
                <section key={section.heading}>
                  <h3>{section.heading}</h3>
                  <p>{section.body}</p>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
