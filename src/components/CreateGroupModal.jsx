import { useMemo, useState } from 'react';

export default function CreateGroupModal({ users, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
  }, [users, search]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) {
      setError('Group name must be at least 2 characters');
      return;
    }
    if (selected.size < 1) {
      setError('Pick at least one member');
      return;
    }
    setSubmitting(true);
    try {
      await onCreate({ name: name.trim(), memberIds: [...selected] });
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create group');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="modal-header">
          <h2>Create group</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <label className="modal-label" htmlFor="group-name">
          Group name
        </label>
        <input
          id="group-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Project team"
          minLength={2}
          required
        />

        <label className="modal-label" htmlFor="group-member-search">
          Members
        </label>
        <input
          id="group-member-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people…"
        />

        <div className="member-picker">
          {filtered.map((u) => {
            const id = String(u.id);
            const checked = selected.has(id);
            return (
              <label key={id} className={`member-picker-item ${checked ? 'selected' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(id)} />
                <span className="avatar tiny">{(u.username || '?').slice(0, 2).toUpperCase()}</span>
                <span>{u.username}</span>
              </label>
            );
          })}
          {filtered.length === 0 && <p className="empty-hint">No matching users</p>}
        </div>

        {error && <div className="auth-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : `Create (${selected.size + 1})`}
          </button>
        </div>
      </form>
    </div>
  );
}
