import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { formatKeyFile, downloadKeyFile } from '../crypto/keyFile.js';
import ThemeToggle from '../components/ThemeToggle.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [keySet, setKeySet] = useState(null); // set once registration succeeds; presence = "show save-keys step"
  const [downloaded, setDownloaded] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await register(form);
      setKeySet(result.keySet);
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    const content = formatKeyFile({ username: form.username, email: form.email, secretKeys: keySet.map((k) => k.secretKey) });
    downloadKeyFile(content);
    setDownloaded(true);
  }

  if (keySet) {
    return (
      <div className="auth-page">
        <div className="auth-page-topbar">
          <ThemeToggle />
        </div>
        <div className="auth-card">
          <h1>Save your private keys</h1>
          <p className="auth-subtitle">
            These 5 keys are the only way to read your messages on another device or browser. We don't store
            them and can't recover them for you — if you lose them and clear this browser's storage, your
            message history is gone for good.
          </p>
          <div className="key-list">
            {keySet.map((k, i) => (
              <code key={i} className="key-list-item">
                {k.secretKey}
              </code>
            ))}
          </div>
          {downloaded && <p className="key-saved-note">Saved as keys.txt — keep it somewhere safe.</p>}
          <button type="button" onClick={handleDownload}>
            Download keys.txt
          </button>
          <button type="button" className="secondary-button" onClick={() => navigate('/chat')}>
            Continue to chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-page-topbar">
        <ThemeToggle />
      </div>
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand">
          <div className="auth-brand-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div className="auth-brand-name">QuantumChat</div>
          <h1>Create account</h1>
        </div>

        <p className="auth-subtitle">
          A pool of 5 X25519 keypairs is generated on your device. The private keys stay only in this
          browser's local storage — we never see them. You'll be able to save a backup on the next screen.
        </p>

        <div className="auth-field">
          <svg className="auth-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 0v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <input
            id="register-username"
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
            minLength={3}
          />
        </div>

        <div className="auth-field">
          <svg className="auth-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
          <input
            id="register-email"
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </div>

        <div className="auth-field">
          <svg className="auth-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <input
            id="register-password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
          />
          <button
            type="button"
            className="auth-password-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button type="submit" disabled={loading}>
          {loading ? 'Creating…' : 'Create account'}
        </button>

        <p>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
