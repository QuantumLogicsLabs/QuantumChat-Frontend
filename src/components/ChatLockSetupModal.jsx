import { Lock, X } from 'lucide-react';
import { useState } from 'react';
import { useChatLock } from '../context/ChatLockContext.jsx';

/**
 * Create the Chat Lock PIN (first time) or change it (when `changing`).
 * `onDone` runs after the PIN is saved, e.g. to go on and lock the chat the
 * user originally asked to lock.
 */
export default function ChatLockSetupModal({ changing = false, onClose, onDone }) {
  const { setPin } = useChatLock();
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const digits = (v) => v.replace(/\D/g, '');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(pin)) {
      setError('PIN must be 4 to 8 digits');
      return;
    }
    if (pin !== confirm) {
      setError('PINs do not match');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await setPin({ pin, currentPin: changing ? currentPin : undefined });
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not save PIN');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="create-group-overlay" onClick={onClose}>
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
            <h2>{changing ? 'Change Chat Lock PIN' : 'Set a Chat Lock PIN'}</h2>
            <p>Locked chats ask for this PIN before they open</p>
          </div>
          <button type="button" className="create-group-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="create-group-body" style={{ flex: '0 0 auto', overflow: 'visible' }}>
          {error && <div className="auth-error">{error}</div>}
          {changing && (
            <label className="create-group-field">
              <span className="create-group-label">Current PIN</span>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                className="create-group-input"
                value={currentPin}
                onChange={(e) => setCurrentPin(digits(e.target.value))}
                autoComplete="off"
              />
            </label>
          )}
          <label className="create-group-field">
            <span className="create-group-label">New PIN (4 to 8 digits)</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              className="create-group-input"
              value={pin}
              onChange={(e) => setPinValue(digits(e.target.value))}
              autoFocus
              autoComplete="off"
            />
          </label>
          <label className="create-group-field">
            <span className="create-group-label">Confirm PIN</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              className="create-group-input"
              value={confirm}
              onChange={(e) => setConfirm(digits(e.target.value))}
              autoComplete="off"
            />
          </label>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            If you forget this PIN you will not be able to open locked chats, so choose one you will remember.
          </p>
        </div>

        <div className="create-group-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="confirm-btn" disabled={busy || pin.length < 4 || confirm.length < 4}>
            {busy ? 'Saving…' : 'Save PIN'}
          </button>
        </div>
      </form>
    </div>
  );
}
