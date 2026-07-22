import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import ThemeSwitcher from '../components/ThemeSwitcher.jsx';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setDone(null);
    try {
      const { data } = await client.post('/auth/forgot-password', { email: email.trim() });
      setDone(data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  const resetPath = useMemo(() => {
    if (!done?.resetUrl) return null;
    try {
      return new URL(done.resetUrl).pathname + new URL(done.resetUrl).search;
    } catch {
      return done.resetUrl;
    }
  }, [done]);

  return (
    <div className="auth-page">
      <ThemeSwitcher />
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Forgot password</h1>
        <p className="auth-subtitle">
          Resets login access only. Encrypted message keys stay on your devices — keep your keys.txt backup.
        </p>
        {error && <div className="auth-error" role="alert" aria-live="polite">{error}</div>}
        {done ? (
          <div className="settings-ok">
            <p>{done.message}</p>
            {resetPath && (
              <p>
                Dev link: <Link to={resetPath}>Open reset form</Link>
              </p>
            )}
            <button type="button" className="confirm-btn" onClick={() => navigate('/login')}>
              Back to login
            </button>
          </div>
        ) : (
          <>
            <label className="create-group-label">Email</label>
            <input
              className="create-group-input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <button type="submit" className="confirm-btn" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
            <p className="auth-switch">
              <Link to="/login">Back to login</Link>
            </p>
          </>
        )}
      </form>
    </div>
  );
}
