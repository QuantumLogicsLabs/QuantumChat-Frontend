function isRecentlyActive(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 5 * 60 * 1000;
}

function formatShortLastSeen(iso) {
  if (!iso) return 'never seen';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function UserList({ users, selectedUserId, onSelect, loading }) {
  if (loading) {
    return (
      <div className="user-list">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="user-list-item" style={{ pointerEvents: 'none' }}>
            <div className="skeleton skeleton-avatar" />
            <div className="skeleton-user-info">
              <div className="skeleton skeleton-line short" />
              <div className="skeleton skeleton-line medium" style={{ marginTop: '4px' }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="user-list">
      {users.map((u) => (
        <button
          key={u.id}
          className={`user-list-item ${u.id === selectedUserId ? 'active' : ''}`}
          onClick={() => onSelect(u)}
          aria-label={`Chat with ${u.username}, ${isRecentlyActive(u.lastLoginAt) ? 'online' : 'offline'}`}
        >
          <span className="avatar">
            {u.username.slice(0, 2).toUpperCase()}
            {isRecentlyActive(u.lastLoginAt) && <span className="online-dot" />}
          </span>
          <span className="user-list-meta">
            <span className="user-list-name">{u.username}</span>
            <span className="user-list-lastseen">{formatShortLastSeen(u.lastLoginAt)}</span>
          </span>
        </button>
      ))}
      {users.length === 0 && <p className="empty-hint">No other users yet.</p>}
    </div>
  );
}
