import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import ThemeSwitcher from '../components/ThemeSwitcher.jsx';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { updateSessionUser, user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState(token ? 'verifying' : 'missing');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    client
      .post('/auth/verify-email', { token })
      .then((res) => {
        if (cancelled) return;
        if (res.data.data?.user) updateSessionUser?.(res.data.data.user);
        setStatus('ok');
        setTimeout(() => navigate(user ? '/chat' : '/login'), 1200);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setError(err.response?.data?.error || 'Verification failed');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="auth-page">
      <ThemeSwitcher />
      <div className="auth-card">
        <h1>Email verification</h1>
        {status === 'verifying' && <p className="auth-subtitle">Verifying…</p>}
        {status === 'ok' && <div className="settings-ok">Email verified. Redirecting…</div>}
        {status === 'missing' && <div className="auth-error" role="alert" aria-live="polite">Missing verification token.</div>}
        {status === 'error' && <div className="auth-error" role="alert" aria-live="polite">{error}</div>}
        <p className="auth-switch">
          <Link to="/chat">Go to chat</Link> · <Link to="/login">Login</Link>
        </p>
      </div>
    </div>
  );
}
