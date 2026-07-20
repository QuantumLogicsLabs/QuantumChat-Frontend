import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

export default function ForwardModal({ conversations = [], onClose, onForward, busy }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations.filter((c) => c.type === 'dm');
    return conversations.filter(
      (c) => c.type === 'dm' && (c.title || '').toLowerCase().includes(q)
    );
  }, [conversations, query]);

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Forward message">
      <div className="forward-modal">
        <div className="forward-modal-header">
          <h2>Forward message</h2>
          <button type="button" className="create-group-close" onClick={onClose} aria-label="Close" disabled={busy}>
            <X size={16} />
          </button>
        </div>
        <p className="forward-modal-copy">
          Choose a contact. The message is re-encrypted for them. Forwarding may be blocked if the sender disabled it.
        </p>
        <div className="forward-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts…"
            aria-label="Search contacts"
            disabled={busy}
          />
        </div>
        <div className="forward-list">
          {filtered.length === 0 ? (
            <p className="empty-hint">No contacts found.</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.key}
                type="button"
                className="forward-list-item"
                disabled={busy}
                onClick={() => onForward(c)}
              >
                <span className="avatar">{(c.title || '?').slice(0, 2).toUpperCase()}</span>
                <span className="user-list-name">{c.title}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
