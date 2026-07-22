import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import client from '../api/client.js';
import ThemeSwitcher from '../components/ThemeSwitcher.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await client.post('/auth/reset-password', { token, newPassword: password });
      setOk(data.data.message || 'Password reset');
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err.response?.data?.error || 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <ThemeSwitcher />
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Reset password</h1>
        <p className="auth-subtitle">Choose a new login password. This does not change your encryption keys.</p>
        {!token && <div className="auth-error" role="alert" aria-live="polite">Missing reset token. Use the link from your email.</div>}
        {error && <div className="auth-error" role="alert" aria-live="polite">{error}</div>}
        {ok && <div className="settings-ok">{ok}</div>}
        <label className="create-group-label">New password</label>
        <input
          className="create-group-input"
          type="password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          disabled={!token}
        />
        <button type="submit" className="confirm-btn" disabled={busy || !token || password.length < 8}>
          {busy ? 'Saving…' : 'Reset password'}
        </button>
        <p className="auth-switch">
          <Link to="/login">Back to login</Link>
        </p>
      </form>
    </div>
  );
}
