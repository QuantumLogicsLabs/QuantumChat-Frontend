import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Archive, Ban, BellOff, Check, Mail, MoreVertical, Phone, Search, Users, UserPlus, UserX, VolumeX, X } from 'lucide-react';
import client from '../api/client.js';
import UserAvatar from './UserAvatar.jsx';
import { createPortal } from 'react-dom';

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
  { id: 'friends', label: 'Friends' },
  { id: 'discover', label: 'Discover' },
  { id: 'archived', label: 'Archived' },
];

export default function ConversationList({
  conversations,
  filter,
  onFilterChange,
  selectedKey,
  onSelect,
  onCreateGroup,
  onDiscoverJoin,
  onHide,
  onBlock,
  onMute,
  onArchive,
  loading,
  searchQuery = '',
  friendCandidates = [],
  friendCandidatesLoading = false,
  incomingRequests = [],
  myFriends = [],
  myFriendsLoading = false,
  contactQuery = '',
  onContactQueryChange,
  contactLookupResult = null,
  contactLookupLoading = false,
  contactLookupError = '',
  onLookupContact,
  onSendFriendRequest,
  onCancelFriendRequest,
  onAcceptFriendRequest,
  onDeclineFriendRequest,
  onOpenFriend,
}) {
  const [discoverItems, setDiscoverItems] = useState([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState('');
  const [joiningId, setJoiningId] = useState(null);
  const [openMenuKey, setOpenMenuKey] = useState(null);
  const panelRef = useRef(null);
const [menuPos, setMenuPos] = useState(null);
  useEffect(() => {
    if (!openMenuKey) return undefined;

    function closeMenu(e) {
if (!e.target.closest('.conv-row-menu-wrap') && !e.target.closest('.conv-row-dropdown')) {
    setOpenMenuKey(null);
    setMenuPos(null);
  }
}
    function closeOnEscape(e) {
      if (e.key === 'Escape') setOpenMenuKey(null);
    }

    document.addEventListener('pointerdown', closeMenu);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenuKey]);

  function runMenuAction(action) {
    setOpenMenuKey(null);
    action?.();
  }

  const loadDiscover = useCallback(async (q) => {
    setDiscoverLoading(true);
    setDiscoverError('');
    try {
      const { data } = await client.get('/groups/discover', {
        params: q?.trim() ? { q: q.trim() } : undefined,
      });
      setDiscoverItems(data.data || []);
    } catch (err) {
      setDiscoverError(err.response?.data?.error || err.message || 'Failed to load public groups');
      setDiscoverItems([]);
    } finally {
      setDiscoverLoading(false);
    }
  }, []);

  useEffect(() => {
    if (filter !== 'discover') return undefined;
    loadDiscover(searchQuery);
    return undefined;
  }, [filter, searchQuery, loadDiscover]);

  async function handleJoin(item) {
    if (!onDiscoverJoin || joiningId) return;
    setJoiningId(item.id);
    try {
      const result = await onDiscoverJoin(item);
      if (result?.pending) {
        setDiscoverItems((prev) =>
          prev.map((g) => (String(g.id) === String(item.id) ? { ...g, joinRequestPending: true } : g))
        );
      } else if (result?.joined) {
        setDiscoverItems((prev) => prev.filter((g) => String(g.id) !== String(item.id)));
      }
    } catch {
      /* toast handled upstream */
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <div className="conversation-panel" ref={panelRef}>
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
          <UserPlus size={16} strokeWidth={2} aria-hidden="true" />
          New group
        </button>
      </div>

      {filter === 'discover' ? (
        <div className="user-list discover-list">
          {discoverLoading ? (
            [1, 2, 3].map((i) => (
              <div key={i} className="user-list-item" style={{ pointerEvents: 'none' }}>
                <div className="skeleton skeleton-avatar" />
                <div className="skeleton-user-info">
                  <div className="skeleton skeleton-line short" />
                  <div className="skeleton skeleton-line medium" style={{ marginTop: '4px' }} />
                </div>
              </div>
            ))
          ) : discoverError ? (
            <p className="empty-hint">{discoverError}</p>
          ) : discoverItems.length === 0 ? (
            <p className="empty-hint">
              {searchQuery.trim()
                ? 'No public groups match your search.'
                : 'No public groups to join right now.'}
            </p>
          ) : (
            discoverItems.map((g, index) => (
              <motion.div
                key={g.id}
                className="user-list-item discover-item"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: Math.min(index * 0.02, 0.16) }}
              >
                <span className="avatar-container group">
                  <span className="avatar group-avatar">
                    <Users size={18} strokeWidth={2} aria-hidden="true" />
                  </span>
                </span>
                <span className="user-list-meta">
                  <span className="user-list-name-row">
                    <span className="user-list-name">{g.name}</span>
                    <span className="discover-badge">
                      {g.joinPolicy === 'request' ? 'Request' : 'Open'}
                    </span>
                  </span>
                  <span className="user-list-lastseen">
                    {g.description?.trim()
                      ? g.description.trim().slice(0, 64)
                      : `${g.memberCount || 0} members`}
                  </span>
                </span>
                <button
                  type="button"
                  className="discover-join-btn"
                  disabled={Boolean(joiningId) || g.joinRequestPending}
                  onClick={() => handleJoin(g)}
                >
                  {g.joinRequestPending
                    ? 'Pending'
                    : joiningId === g.id
                      ? '…'
                      : g.joinPolicy === 'request'
                        ? 'Request'
                        : 'Join'}
                </button>
              </motion.div>
            ))
          )}
        </div>
      ) : filter === 'friends' ? (
        <div className="user-list friends-list">
          <div className="friend-requests-incoming">
            <p className="friend-requests-heading">
              Requests
              {incomingRequests.length > 0 ? (
                <span className="friend-section-count">{incomingRequests.length}</span>
              ) : null}
            </p>
            {incomingRequests.length === 0 ? (
              <div className="friends-empty-card" role="status">
                <UserPlus size={20} strokeWidth={1.75} aria-hidden="true" />
                <p className="friends-empty-title">No pending requests</p>
                <p className="friends-empty-copy">When someone wants to connect, their request shows up here.</p>
              </div>
            ) : (
              incomingRequests.map((r) => (
                <div key={r.id} className="user-list-item friend-request-item">
                  <UserAvatar
                    userId={r.user.id}
                    name={r.user.displayName || r.user.username}
                    hasAvatar={Boolean(r.user.hasAvatar)}
                  />
                  <span className="user-list-meta">
                    <span className="user-list-name">{r.user.displayName || r.user.username}</span>
                    <span className="user-list-lastseen">@{r.user.username}</span>
                  </span>
                  <div className="friend-request-actions">
                    <button
                      type="button"
                      className="friend-action-btn accept"
                      aria-label={`Accept request from ${r.user.displayName || r.user.username}`}
                      onClick={() => onAcceptFriendRequest?.(r.id)}
                    >
                      <Check size={15} strokeWidth={2.5} />
                    </button>
                    <button
                      type="button"
                      className="friend-action-btn decline"
                      aria-label={`Decline request from ${r.user.displayName || r.user.username}`}
                      onClick={() => onDeclineFriendRequest?.(r.id)}
                    >
                      <X size={15} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="friend-connections">
            <p className="friend-requests-heading">
              Your friends
              {myFriends.length > 0 ? (
                <span className="friend-section-count">{myFriends.length}</span>
              ) : null}
            </p>
            {myFriendsLoading ? (
              [1, 2].map((i) => (
                <div key={i} className="user-list-item friend-skeleton-item" style={{ pointerEvents: 'none' }}>
                  <div className="skeleton skeleton-avatar" />
                  <div className="skeleton-user-info">
                    <div className="skeleton skeleton-line short" />
                    <div className="skeleton skeleton-line medium" style={{ marginTop: '4px' }} />
                  </div>
                </div>
              ))
            ) : myFriends.length === 0 ? (
              <div className="friends-empty-card" role="status">
                <Users size={20} strokeWidth={1.75} aria-hidden="true" />
                <p className="friends-empty-title">No friends yet</p>
                <p className="friends-empty-copy">
                  Accept a request above, or add someone from People below.
                </p>
              </div>
            ) : (
              myFriends
                .filter((u) => {
                  const q = searchQuery.trim().toLowerCase();
                  if (!q) return true;
                  return `${u.displayName || ''} ${u.username || ''}`.toLowerCase().includes(q);
                })
                .map((u, index) => (
                  <motion.div
                    key={u.id}
                    className="user-list-item friend-connection-item"
                    role="button"
                    tabIndex={0}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: Math.min(index * 0.02, 0.16) }}
                    onClick={() => onOpenFriend?.(u)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpenFriend?.(u);
                      }
                    }}
                  >
                    <UserAvatar
                      userId={u.id}
                      name={u.displayName || u.username}
                      hasAvatar={Boolean(u.hasAvatar)}
                    />
                    <span className="user-list-meta">
                      <span className="user-list-name">{u.displayName || u.username}</span>
                      <span className="user-list-lastseen">@{u.username}</span>
                    </span>
                    <span className="friend-chat-hint">Chat</span>
                  </motion.div>
                ))
            )}
          </div>

          <div className="friend-contact-lookup">
            <p className="friend-requests-heading">
              <Mail size={14} strokeWidth={2.2} aria-hidden="true" />
              Find via phone or email
            </p>
            <form
              className="friend-contact-form"
              onSubmit={(e) => {
                e.preventDefault();
                onLookupContact?.();
              }}
            >
              <div className="friend-contact-input-wrap">
                <Phone size={15} strokeWidth={2} aria-hidden="true" className="friend-contact-input-icon" />
                <input
                  type="text"
                  className="friend-contact-input"
                  value={contactQuery}
                  onChange={(e) => onContactQueryChange?.(e.target.value)}
                  placeholder="Email or phone number"
                  autoComplete="off"
                  inputMode="email"
                  aria-label="Find friend by email or phone"
                />
              </div>
              <button
                type="submit"
                className="friend-contact-submit"
                disabled={contactLookupLoading || !contactQuery.trim()}
              >
                {contactLookupLoading ? '…' : <Search size={15} strokeWidth={2.4} aria-hidden="true" />}
                <span>Find</span>
              </button>
            </form>
            {contactLookupError ? (
              <p className="friend-contact-error" role="alert">{contactLookupError}</p>
            ) : null}
            {contactLookupResult ? (
              <motion.div
                className="user-list-item friend-candidate-item"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <UserAvatar
                  userId={contactLookupResult.id}
                  name={contactLookupResult.displayName || contactLookupResult.username}
                  hasAvatar={Boolean(contactLookupResult.hasAvatar)}
                />
                <span className="user-list-meta">
                  <span className="user-list-name">
                    {contactLookupResult.displayName || contactLookupResult.username}
                  </span>
                  <span className="user-list-lastseen">
                    @{contactLookupResult.username}
                    {contactLookupResult.matchedBy
                      ? ` · matched by ${contactLookupResult.matchedBy}`
                      : ''}
                  </span>
                </span>
                {contactLookupResult.requestStatus === 'friends' ? (
                  <button
                    type="button"
                    className="friend-action-btn add"
                    onClick={() => onOpenFriend?.(contactLookupResult)}
                  >
                    Chat
                  </button>
                ) : contactLookupResult.requestStatus === 'pending_sent' ? (
                  <button
                    type="button"
                    className="friend-action-btn cancel"
                    onClick={() => onCancelFriendRequest?.(contactLookupResult.requestId)}
                  >
                    Cancel
                  </button>
                ) : contactLookupResult.requestStatus === 'pending_received' ? (
                  <div className="friend-request-actions">
                    <button
                      type="button"
                      className="friend-action-btn accept"
                      onClick={() => onAcceptFriendRequest?.(contactLookupResult.requestId)}
                    >
                      <Check size={15} strokeWidth={2.5} />
                    </button>
                    <button
                      type="button"
                      className="friend-action-btn decline"
                      onClick={() => onDeclineFriendRequest?.(contactLookupResult.requestId)}
                    >
                      <X size={15} strokeWidth={2.5} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="friend-action-btn add"
                    onClick={() => onSendFriendRequest?.(contactLookupResult.id)}
                  >
                    Add
                  </button>
                )}
              </motion.div>
            ) : null}
          </div>

          <p className="friend-requests-heading">People</p>
          {friendCandidatesLoading ? (
            [1, 2, 3].map((i) => (
              <div key={i} className="user-list-item friend-skeleton-item" style={{ pointerEvents: 'none' }}>
                <div className="skeleton skeleton-avatar" />
                <div className="skeleton-user-info">
                  <div className="skeleton skeleton-line short" />
                  <div className="skeleton skeleton-line medium" style={{ marginTop: '4px' }} />
                </div>
              </div>
            ))
          ) : friendCandidates.length === 0 ? (
            <div className="friends-empty-card" role="status">
              <Users size={20} strokeWidth={1.75} aria-hidden="true" />
              <p className="friends-empty-title">
                {searchQuery.trim() ? 'No matches' : 'No one new right now'}
              </p>
              <p className="friends-empty-copy">
                {searchQuery.trim()
                  ? 'Try a different name or username.'
                  : 'Search above to find people, or wait for new accounts to appear.'}
              </p>
            </div>
          ) : (
            friendCandidates.map((u, index) => (
              <motion.div
                key={u.id}
                className="user-list-item friend-candidate-item"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: Math.min(index * 0.02, 0.16) }}
              >
                <UserAvatar userId={u.id} name={u.displayName || u.username} hasAvatar={Boolean(u.hasAvatar)} />
                <span className="user-list-meta">
                  <span className="user-list-name">{u.displayName || u.username}</span>
                  <span className="user-list-lastseen">@{u.username}</span>
                </span>
                {u.requestStatus === 'pending_sent' ? (
                  <button
                    type="button"
                    className="friend-action-btn cancel"
                    onClick={() => onCancelFriendRequest?.(u.requestId)}
                  >
                    Cancel
                  </button>
                ) : u.requestStatus === 'pending_received' ? (
                  <div className="friend-request-actions">
                    <button
                      type="button"
                      className="friend-action-btn accept"
                      aria-label={`Accept request from ${u.displayName || u.username}`}
                      onClick={() => onAcceptFriendRequest?.(u.requestId)}
                    >
                      <Check size={15} strokeWidth={2.5} />
                    </button>
                    <button
                      type="button"
                      className="friend-action-btn decline"
                      aria-label={`Decline request from ${u.displayName || u.username}`}
                      onClick={() => onDeclineFriendRequest?.(u.requestId)}
                    >
                      <UserX size={15} strokeWidth={2.5} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="friend-action-btn add"
                    onClick={() => onSendFriendRequest?.(u.id)}
                  >
                    Add
                  </button>
                )}
              </motion.div>
            ))
          )}
        </div>
      ) : loading ? (
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
          {conversations.map((c, index) => (
            <motion.div
              key={c.key}
              className={`user-list-item ${c.key === selectedKey ? 'active' : ''} ${c.unread ? 'unread' : ''} ${openMenuKey === c.key ? 'menu-open' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                setOpenMenuKey(null);
                 setMenuPos(null);
                onSelect(c);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(c);
                }
              }}
              aria-label={`${c.type === 'group' ? 'Group' : 'Chat'} ${c.title}${c.unread ? ', unread' : ''}${c.muted ? ', muted' : ''}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: Math.min(index * 0.02, 0.16) }}
              whileHover={{ y: -1 }}
            >
              <span className={`avatar-container ${c.type === 'group' ? 'group' : ''}`}>
                {c.type === 'group' ? (
                  <span className="avatar group-avatar">
                    <Users size={18} strokeWidth={2} aria-hidden="true" />
                  </span>
                ) : (
                  <span className="avatar-wrap" style={{ position: 'relative' }}>
                    <UserAvatar
                      userId={c.id}
                      name={c.title}
                      hasAvatar={Boolean(c.peer?.hasAvatar)}
                      className="conv-row-avatar"
                    />
                    {(c.online ?? isRecentlyActive(c.lastLoginAt)) && <span className="online-dot" />}
                  </span>
                )}
              </span>
              <span className="user-list-meta">
                <span className="user-list-name-row">
                  <span className="user-list-name">{c.title}</span>
                  {c.muted && (
                    <span className="conv-muted-icon" title="Muted" aria-label="Muted">
                      <BellOff size={12} strokeWidth={2} aria-hidden="true" />
                    </span>
                  )}
                  {c.unread && <span className="unread-dot" aria-hidden="true" />}
                  <span className="conv-row-time">{formatShortLastSeen(c.lastLoginAt)}</span>
                </span>
                <span className="user-list-lastseen">{c.subtitle}</span>
              </span>
              {(onHide || onBlock || onMute || onArchive) && (
                <div className="conv-row-menu-wrap" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className={`conv-row-menu ${openMenuKey === c.key ? 'open' : ''}`}
                    aria-label={`Options for ${c.title}`}
                    aria-haspopup="menu"
                    aria-expanded={openMenuKey === c.key}
                   onClick={(e) => {
  if (openMenuKey === c.key) {
    setOpenMenuKey(null);
    setMenuPos(null);
    return;
  }
  const rect = e.currentTarget.getBoundingClientRect();
  setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
  setOpenMenuKey(c.key);
}}
                  >
                    <MoreVertical size={16} />
                  </button>
                  {openMenuKey === c.key && menuPos && createPortal(
  <div
    className="conv-row-dropdown open"
    role="menu"
    aria-label={`Conversation options for ${c.title}`}
    style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, left: 'auto' }}
  >
    <div className="conv-row-dropdown-title">Conversation options</div>
    {onMute && (
      <button type="button" role="menuitem" onClick={() => runMenuAction(() => onMute(c))}>
        <VolumeX size={14} /> {c.muted ? 'Unmute' : 'Mute'}
      </button>
    )}
    {onArchive && (
      <button type="button" role="menuitem" onClick={() => runMenuAction(() => onArchive(c))}>
        <Archive size={14} /> {c.archived ? 'Unarchive' : 'Archive'}
      </button>
    )}
    {c.type === 'dm' && onHide && (
      <button type="button" role="menuitem" onClick={() => runMenuAction(() => onHide(c.peer || c))}>
        <X size={14} /> Hide chat
      </button>
    )}
    {c.type === 'dm' && onBlock && (
      <button
        type="button"
        role="menuitem"
        className="danger"
        onClick={() => runMenuAction(() => onBlock(c.peer || c))}
      >
        <Ban size={14} /> Block user
      </button>
    )}
  </div>,
  document.body
)}
                </div>
              )}
            </motion.div>
          ))}
          {conversations.length === 0 && (
            <p className="empty-hint">
              {searchQuery.trim()
                ? 'No users or groups match your search.'
                : filter === 'unread'
                  ? 'No unread conversations.'
                  : filter === 'groups'
                    ? 'No groups yet. Create one to get started.'
                    : filter === 'archived'
                      ? 'No archived conversations.'
                      : 'No conversations yet.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}