import { Lock, X } from 'lucide-react';
import { useState } from 'react';

/**
 * Generic PIN prompt used by Chat Lock: unlock a locked chat, confirm
 * removing a lock, or confirm disabling Chat Lock. The caller supplies
 * `onSubmit(pin)`; if it throws, the server's message is shown.
 *
 * `opaque` renders a solid backdrop so whatever is behind (a locked
 * conversation) is not visible while the PIN is being asked for.
 */
export default function ChatLockPinModal({
  title = 'Enter PIN',
  subtitle = 'Enter your Chat Lock PIN',
  confirmLabel = 'Unlock',
  opaque = false,
  onSubmit,
  onClose,
  closeLabel = 'Cancel',
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(pin)) {
      setError('Enter your 4 to 8 digit PIN');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onSubmit(pin);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Incorrect PIN');
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="create-group-overlay"
      style={opaque ? { background: 'var(--bg, #0b1512)', backdropFilter: 'none' } : undefined}
      onClick={opaque ? undefined : onClose}
    >
      <form
        className="create-group-modal"
        style={{ height: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="create-group-modal-header">
          <div className="create-group-modal-icon">
            <Lock size={20} />
          </div>
          <div className="create-group-modal-heading">
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="create-group-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="create-group-body" style={{ flex: '0 0 auto', overflow: 'visible' }}>
          {error && <div className="auth-error">{error}</div>}
          <label className="create-group-field">
            <span className="create-group-label">PIN</span>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              className="create-group-input"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="4 to 8 digits"
              autoFocus
              autoComplete="off"
            />
          </label>
        </div>

        <div className="create-group-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            {closeLabel}
          </button>
          <button type="submit" className="confirm-btn" disabled={busy || pin.length < 4}>
            {busy ? 'Checking…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
