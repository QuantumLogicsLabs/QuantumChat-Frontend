import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import ThemeSwitcher from '../components/ThemeSwitcher.jsx';

function getFriendlyLoginError(serverError, statusCode) {
  const msg = (serverError || '').toLowerCase();

  if (statusCode === 429) {
    return {
      text: "You've made too many attempts. Take a breather and try again in a minute.",
      action: null,
    };
  }

  if (statusCode === 401 || msg.includes('invalid email or password')) {
    return {
      text: "We couldn't find an account matching those credentials. Double-check your details and try again.",
      action: { label: 'Register an account instead', to: '/register' },
    };
  }

  if (msg.includes('authenticator') || msg.includes('2fa')) {
    return {
      text: serverError || 'Invalid authenticator code. Try again.',
      action: null,
    };
  }

  if (statusCode === 400 || msg.includes('required')) {
    return {
      text: 'Please fill in both your email and password.',
      action: null,
    };
  }

  if (statusCode >= 500) {
    return {
      text: 'Our servers are experiencing an issue. Please try again in a few moments.',
      action: null,
    };
  }

  if (msg.includes('network') || msg.includes('econnrefused')) {
    return {
      text: 'Network error: Cannot connect to the server. Please check your internet connection.',
      action: null,
    };
  }

  return {
    text: serverError || 'An unexpected error occurred. Please try again.',
    action: null,
  };
}

export default function Login() {
  const { login, verify2fa } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pending2fa, setPending2fa] = useState(null);
  const [totpCode, setTotpCode] = useState('');

  useEffect(() => {
    document.title = 'Log in — QuantumChat';
    return () => {
      document.title = 'QuantumChat';
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (pending2fa) {
      if (!/^\d{6}$/.test(totpCode.trim())) {
        setError({ text: 'Enter the 6-digit code from your authenticator app.', action: null });
        return;
      }
      setLoading(true);
      try {
        await verify2fa({ tempToken: pending2fa.tempToken, token: totpCode.trim() });
        navigate('/chat');
      } catch (err) {
        const serverMsg = err.response?.data?.error;
        const status = err.response?.status;
        setError(getFriendlyLoginError(serverMsg, status));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!form.email.trim()) {
      setError({ text: 'Please enter your email address.', action: null });
      return;
    }

    if (!form.password) {
      setError({ text: 'Please enter your password.', action: null });
      return;
    }

    setLoading(true);
    try {
      const result = await login(form);
      if (result?.requires2fa) {
        setPending2fa({ tempToken: result.tempToken });
        setTotpCode('');
        return;
      }
      navigate('/chat');
    } catch (err) {
      const serverMsg = err.response?.data?.error;
      const status = err.response?.status;
      setError(getFriendlyLoginError(serverMsg, status));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-theme-container auth-page-topbar">
        <ThemeSwitcher />
      </div>

      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand">
          <Link to="/" className="auth-brand-home" aria-label="QuantumChat home">
            <span className="auth-brand-icon">
              <Shield size={22} strokeWidth={2} aria-hidden="true" />
            </span>
          </Link>
          <p className="auth-brand-name">QuantumChat</p>
          <h1>{pending2fa ? 'Two-factor authentication' : 'Welcome back'}</h1>
          <p className="auth-subtitle">
            {pending2fa
              ? 'Enter the 6-digit code from your authenticator app.'
              : 'Sign in to decrypt your conversations.'}
          </p>
        </div>

        {!pending2fa ? (
          <>
            <label className="auth-label" htmlFor="login-email">
              Email address
            </label>
            <div className="auth-field">
              <svg className="auth-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <input
                id="login-email"
                type="email"
                placeholder="name@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                autoComplete="email"
              />
            </div>

            <div className="auth-label-row">
              <label className="auth-label" htmlFor="login-password">
                Password
              </label>
              <Link to="/forgot-password" className="auth-text-btn">
                Forgot password?
              </Link>
            </div>
            <div className="auth-field">
              <svg className="auth-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Your password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="auth-label" htmlFor="login-totp">
              Authenticator code
            </label>
            <div className="auth-field">
              <input
                id="login-totp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoComplete="one-time-code"
                autoFocus
              />
            </div>
            <button
              type="button"
              className="auth-text-btn"
              onClick={() => {
                setPending2fa(null);
                setTotpCode('');
                setError(null);
              }}
            >
              Back to password
            </button>
          </>
        )}

        {error && (
          <div className="auth-error" role="alert" aria-live="polite">
            <span>{error.text}</span>
            {error.action && (
              <Link to={error.action.to} className="auth-error-action">
                {error.action.label}
              </Link>
            )}
          </div>
        )}

        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? (pending2fa ? 'Verifying…' : 'Signing in…') : pending2fa ? 'Verify' : 'Sign in'}
        </button>

        {!pending2fa && (
          <p>
            Don&apos;t have an account? <Link to="/register">Create one</Link>
          </p>
        )}
      </form>
    </div>
  );
}
