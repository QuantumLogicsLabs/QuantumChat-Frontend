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

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'groups', label: 'Groups' },
];

export default function ConversationList({
  conversations,
  filter,
  onFilterChange,
  selectedKey,
  onSelect,
  onCreateGroup,
  loading,
}) {
  return (
    <div className="conversation-panel">
      <div className="sidebar-filters" role="tablist" aria-label="Conversation filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`sidebar-filter-btn ${filter === f.id ? 'active' : ''}`}
            onClick={() => onFilterChange(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="sidebar-create-row">
        <button type="button" className="create-group-btn" onClick={onCreateGroup}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" />
            <line x1="22" y1="11" x2="16" y2="11" />
          </svg>
          New group
        </button>
      </div>

      {loading ? (
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
      ) : (
        <div className="user-list">
          {conversations.map((c) => (
            <button
              key={c.key}
              className={`user-list-item ${c.key === selectedKey ? 'active' : ''} ${c.unread ? 'unread' : ''}`}
              onClick={() => onSelect(c)}
              aria-label={`${c.type === 'group' ? 'Group' : 'Chat'} ${c.title}${c.unread ? ', unread' : ''}`}
            >
              <span className={`avatar ${c.type === 'group' ? 'group-avatar' : ''}`}>
                {c.type === 'group' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                ) : (
                  <>
                    {(c.title || '?').slice(0, 2).toUpperCase()}
                    {isRecentlyActive(c.lastLoginAt) && <span className="online-dot" />}
                  </>
                )}
              </span>
              <span className="user-list-meta">
                <span className="user-list-name-row">
                  <span className="user-list-name">{c.title}</span>
                  {c.unread && <span className="unread-dot" aria-hidden="true" />}
                </span>
                <span className="user-list-lastseen">{c.subtitle || formatShortLastSeen(c.lastLoginAt)}</span>
              </span>
            </button>
          ))}
          {conversations.length === 0 && (
            <p className="empty-hint">
              {filter === 'unread'
                ? 'No unread conversations.'
                : filter === 'groups'
                  ? 'No groups yet. Create one to get started.'
                  : 'No conversations yet.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
