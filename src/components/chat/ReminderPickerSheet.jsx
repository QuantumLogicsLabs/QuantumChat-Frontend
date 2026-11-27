import { useMemo, useState } from 'react';
import { Bell, Clock, Sun, Sunrise } from 'lucide-react';
import BottomSheet from '../ui/BottomSheet.jsx';
import { createReminder } from '../../api/reminders.js';

function inHours(h) {
  return new Date(Date.now() + h * 60 * 60 * 1000);
}

function tomorrowAt(hour) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in LOCAL time.
function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * "Remind me about this message" picker. Only the message id and the chosen
 * time are sent to the server — never the message content.
 *
 * Props: open, message, onClose(), onCreated(date), onError(text)
 */
export default function ReminderPickerSheet({ open, message, onClose, onCreated, onError }) {
  const [busy, setBusy] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState('');

  const minValue = useMemo(() => toLocalInputValue(new Date(Date.now() + 60 * 1000)), [open]);
  const messageId = message?.id || message?._id;

  async function save(date) {
    if (!messageId || busy) return;
    setBusy(true);
    try {
      await createReminder({ messageId, remindAt: date });
      onCreated?.(date);
      setCustomOpen(false);
      setCustomValue('');
      onClose?.();
    } catch (err) {
      onError?.(err.response?.data?.error || 'Could not set reminder');
    } finally {
      setBusy(false);
    }
  }

  function saveCustom() {
    const date = new Date(customValue);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      onError?.('Pick a time in the future');
      return;
    }
    save(date);
  }

  return (
    <BottomSheet open={open && Boolean(message)} onClose={onClose} title="Remind me about this message">
      <div className="qc-msg-actions-list" role="menu">
        <button type="button" role="menuitem" disabled={busy} onClick={() => save(inHours(1))}>
          <Clock size={18} /> In 1 hour
        </button>
        <button type="button" role="menuitem" disabled={busy} onClick={() => save(inHours(3))}>
          <Sun size={18} /> Later today (in 3 hours)
        </button>
        <button type="button" role="menuitem" disabled={busy} onClick={() => save(tomorrowAt(9))}>
          <Sunrise size={18} /> Tomorrow at 9:00 AM
        </button>
        <button type="button" role="menuitem" disabled={busy} onClick={() => setCustomOpen((v) => !v)}>
          <Bell size={18} /> Pick date &amp; time…
        </button>
      </div>
      {customOpen && (
        <div className="qc-reminder-custom">
          <input
            type="datetime-local"
            className="create-group-input"
            value={customValue}
            min={minValue}
            onChange={(e) => setCustomValue(e.target.value)}
          />
          <button type="button" className="confirm-btn" disabled={busy || !customValue} onClick={saveCustom}>
            {busy ? 'Saving…' : 'Set reminder'}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
