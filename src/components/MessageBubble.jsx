import { useEffect, useLayoutEffect, useRef, useState, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  Copy,
  Forward,
  Image as ImageIcon,
  MoreHorizontal,
  Music,
  Pencil,
  Phone,
  Pin,
  Reply,
  Smile,
  Star,
  Trash2,
  Clock,
  Users,
  Video,
} from 'lucide-react';
import AttachmentBubble from './AttachmentBubble.jsx';
import GroupMessageContent from './GroupMessageContent.jsx';
import { COMPOSER_EMOJIS, QUICK_REACTIONS, searchEmojis } from '../utils/emojis.js';
import { parseGroupPayload } from '../utils/groupPayload.js';

const MENU_GAP = 8;
const VIEW_PAD = 12;

function groupReactions(reactions = []) {
  const map = new Map();
  for (const r of reactions) {
    if (!r?.emoji) continue;
    const entry = map.get(r.emoji) || { emoji: r.emoji, count: 0, users: [] };
    entry.count += 1;
    entry.users.push(String(r.user));
    map.set(r.emoji, entry);
  }
  return [...map.values()];
}

function placePopover(anchorRect, popoverEl, { preferMine }) {
  if (!anchorRect || !popoverEl) return { top: 0, left: 0, placement: 'below' };

  const pop = popoverEl.getBoundingClientRect();
  const header = document.querySelector('.chat-header');
  const topLimit = Math.max(VIEW_PAD, header ? header.getBoundingClientRect().bottom + 6 : VIEW_PAD);
  const bottomLimit = window.innerHeight - VIEW_PAD;
  const spaceAbove = anchorRect.top - topLimit;
  const spaceBelow = bottomLimit - anchorRect.bottom;

  let placement = 'below';
  if (spaceBelow < pop.height + MENU_GAP && spaceAbove > spaceBelow) placement = 'above';
  else if (spaceAbove >= pop.height + MENU_GAP && spaceBelow < pop.height + MENU_GAP) placement = 'above';
  else if (spaceBelow >= pop.height + MENU_GAP) placement = 'below';
  else placement = spaceAbove > spaceBelow ? 'above' : 'below';

  let top =
    placement === 'above' ? anchorRect.top - pop.height - MENU_GAP : anchorRect.bottom + MENU_GAP;
  top = Math.min(Math.max(top, topLimit), bottomLimit - pop.height);

  let left = preferMine ? anchorRect.right - pop.width : anchorRect.left;
  left = Math.min(Math.max(VIEW_PAD, left), window.innerWidth - pop.width - VIEW_PAD);

  return { top, left, placement };
}

function formatMessageTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // WhatsApp-style 12-hour clock with a non-breaking space so "am"/"pm" never wraps alone
  return d
    .toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .toLowerCase()
    .replace(/\s+(am|pm)$/, '\u00a0$1');
}

function formatVoiceTimer(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ReadReceipt({ status }) {
  if (!status) return null;

  if (status === 'sending') {
    return (
      <span className="read-receipt sending" title="Sending">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" opacity="0.35" />
        </svg>
      </span>
    );
  }

  if (status === 'sent') {
    return (
      <span className="read-receipt sent" title="Sent">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }

  return (
    <span className={`read-receipt ${status}`} title={status === 'read' ? 'Read' : 'Delivered'}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="18 6 7 17 2 12" />
        <polyline points="24 6 13 17 10 14" />
      </svg>
    </span>
  );
}

function MessageBubble({
  message,
  isMine,
  currentUserId,
  resolveSecretKey,
  resolveAttachmentKey,
  grouped,
  senderLabel,
  replyPreview,
  starred,
  pinned,
  showReadReceipts = true,
  onDelete,
  onDeleteForMe,
  onReact,
  onReply,
  onEdit,
  onCopy,
  onForward,
  onStar,
  onPin,
  onJumpToReply,
  onImagePreview,
  onImageReady,
  onOpenStory,
  onVotePoll,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [reactSearchOpen, setReactSearchOpen] = useState(false);
  const [reactQuery, setReactQuery] = useState('');
  const [coords, setCoords] = useState({ top: 0, left: 0, placement: 'below', ready: false });

  const rootRef = useRef(null);
  const moreRef = useRef(null);
  const reactBtnRef = useRef(null);
  const popoverRef = useRef(null);
  const anchorRef = useRef(null);
  const messageId = message.id || message._id;
  const reactionGroups = groupReactions(message.reactions);
  const myReaction = (message.reactions || []).find((r) => String(r.user) === String(currentUserId))?.emoji;
  const anyPopover = menuOpen || reactOpen;
  const reactionSearchResults = useMemo(
    () => (reactQuery.trim() ? searchEmojis(reactQuery, 96) : COMPOSER_EMOJIS.slice(0, 96)),
    [reactQuery]
  );

  const keyResolver = resolveSecretKey || resolveAttachmentKey;
 const structured = useMemo(() => parseGroupPayload(message.text), [message.text]);
const storyReplyPayload = useMemo(() => {
    if (!message.text) return null;
    try {
      const parsed = JSON.parse(message.text);
      return parsed?.type === 'story_reply' || parsed?.type === 'story_reaction' ? parsed : null;
    } catch {
      return null;
    }
  }, [message.text]);
  const isStoryReply = Boolean(storyReplyPayload);
  const isStoryReaction = storyReplyPayload?.type === 'story_reaction';
  const isStructured = Boolean(message.group) && structured.type && structured.type !== 'text';
  const hasTextContent = !isStructured && !isStoryReply && message.text && message.text.length > 0;
  const isDecryptionFail = message.text === null;

  const callMeta = useMemo(() => {
    if (!message.text) return null;
    try {
      const obj = JSON.parse(message.text);
      if (obj && obj.__type === 'call') return obj;
    } catch (e) {
      return null;
    }
    return null;
  }, [message.text]);

  const meetingMeta = useMemo(() => {
    if (!message.text) return null;
    try {
      const obj = JSON.parse(message.text);
      if (obj && obj.__type === 'meeting') return obj;
    } catch (e) {
      return null;
    }
    return null;
  }, [message.text]);

  const receiptStatus = useMemo(() => {
    if (!isMine) return null;
    if (message._status === 'sending') return 'sending';
    if (message.readAt && showReadReceipts) return 'read';
    if (message.deliveredAt || message.readAt) return 'delivered';
    return 'sent';
  }, [isMine, message.readAt, message.deliveredAt, message._status, showReadReceipts]);

  const relativeTime = useMemo(() => formatMessageTime(message.createdAt), [message.createdAt]);
  const fullTime = useMemo(() => new Date(message.createdAt).toLocaleString(), [message.createdAt]);

  // Rendered twice: once as an invisible inline spacer that reserves room on the
  // last line of text, and once absolutely positioned on top of that space. This
  // is what lets the timestamp sit on the text's last line (and makes short
  // bubbles wide enough to hold it) without relying on floats.
  const timeMeta = (
    <>
      {message.expiresAt ? (
        <span
          className="message-expiry-badge"
          title={`Disappears ${new Date(message.expiresAt).toLocaleString()}`}
        >
          <Clock size={11} strokeWidth={2.5} aria-hidden="true" />
        </span>
      ) : null}
      {relativeTime}
      {message.editedAt ? <span className="message-edited"> · edited</span> : null}
      {isMine && <ReadReceipt status={receiptStatus} />}
    </>
  );

  function closeAll() {
    setMenuOpen(false);
    setReactOpen(false);
    setReactSearchOpen(false);
    setReactQuery('');
    setCoords((prev) => ({ ...prev, ready: false }));
  }

  function updatePlacement() {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const next = placePopover(anchor, popoverRef.current, { preferMine: isMine });
    setCoords({ ...next, ready: true });
  }

  useLayoutEffect(() => {
    if (!anyPopover) {
      setCoords((prev) => ({ ...prev, ready: false }));
      return undefined;
    }
    updatePlacement();
    const id = requestAnimationFrame(updatePlacement);
    return () => cancelAnimationFrame(id);
  }, [anyPopover, menuOpen, reactOpen, isMine]);

  useEffect(() => {
    if (!anyPopover) return undefined;

    function onDocClick(e) {
      if (rootRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      closeAll();
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') closeAll();
    }
    function onReposition() {
      updatePlacement();
    }

    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    const list = document.querySelector('.message-list');
    list?.addEventListener('scroll', onReposition, { passive: true });

    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      list?.removeEventListener('scroll', onReposition);
    };
  }, [anyPopover, isMine]);

  const popover =
    anyPopover &&
    createPortal(
      <div
        ref={popoverRef}
        className={`message-popover ${isMine ? 'mine' : 'theirs'} ${coords.placement} ${coords.ready ? 'ready' : ''}`}
        style={{ top: coords.top, left: coords.left }}
        role={menuOpen ? 'menu' : 'listbox'}
        aria-label={menuOpen ? 'Message options' : 'Pick a reaction'}
      >
        {menuOpen && (
          <>
            {onReply && (
              <button type="button" role="menuitem" onClick={() => { closeAll(); onReply(message); }}>
                <span className="message-menu-icon" aria-hidden="true"><Reply size={16} strokeWidth={2} /></span>
                <span>Reply</span>
              </button>
            )}
            {hasTextContent && onCopy && (
              <button type="button" role="menuitem" onClick={() => { closeAll(); onCopy(message); }}>
                <span className="message-menu-icon" aria-hidden="true"><Copy size={16} strokeWidth={2} /></span>
                <span>Copy</span>
              </button>
            )}
            {hasTextContent &&
              onForward &&
              message.forwardPolicy?.allowForward !== false &&
              !(
                message.forwardPolicy?.forwardUntil &&
                new Date(message.forwardPolicy.forwardUntil).getTime() < Date.now()
              ) && (
              <button type="button" role="menuitem" onClick={() => { closeAll(); onForward(message); }}>
                <span className="message-menu-icon" aria-hidden="true"><Forward size={16} strokeWidth={2} /></span>
                <span>Forward</span>
              </button>
            )}
            {onStar && (
              <button type="button" role="menuitem" onClick={() => { closeAll(); onStar(messageId); }}>
                <span className="message-menu-icon" aria-hidden="true"><Star size={16} strokeWidth={2} /></span>
                <span>{starred ? 'Unstar' : 'Star'}</span>
              </button>
            )}
            {onPin && (
              <button type="button" role="menuitem" onClick={() => { closeAll(); onPin(messageId); }}>
                <span className="message-menu-icon" aria-hidden="true"><Pin size={16} strokeWidth={2} /></span>
                <span>{pinned ? 'Unpin' : 'Pin'}</span>
              </button>
            )}
            {isMine && onEdit && !message.attachment && !isStructured && (
              <button type="button" role="menuitem" onClick={() => { closeAll(); onEdit(message); }}>
                <span className="message-menu-icon" aria-hidden="true"><Pencil size={16} strokeWidth={2} /></span>
                <span>Edit</span>
              </button>
            )}
            {onDeleteForMe && (
              <button type="button" role="menuitem" onClick={() => { closeAll(); onDeleteForMe(messageId); }}>
                <span className="message-menu-icon" aria-hidden="true"><Trash2 size={16} strokeWidth={2} /></span>
                <span>Delete for me</span>
              </button>
            )}
            {isMine && onDelete && (
              <button type="button" className="danger" role="menuitem" onClick={() => { closeAll(); onDelete(messageId); }}>
                <span className="message-menu-icon" aria-hidden="true"><Trash2 size={16} strokeWidth={2} /></span>
                <span>Delete for everyone</span>
              </button>
            )}
          </>
        )}

        {reactOpen && onReact && (
          <div className="reaction-picker-inline">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="option"
                aria-selected={myReaction === emoji}
                className={myReaction === emoji ? 'active' : ''}
                onClick={() => {
                  closeAll();
                  onReact(messageId, emoji);
                }}
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              className={`reaction-search-toggle ${reactSearchOpen ? 'active' : ''}`}
              aria-label="Search more emojis"
              title="Search more emojis"
              onClick={() => setReactSearchOpen((v) => !v)}
            >
              +
            </button>

            {reactSearchOpen && (
              <div className="reaction-search-panel" aria-label="Search emojis">
                <input
                  type="text"
                  className="reaction-search-input"
                  placeholder="Search emoji (heart, laugh, fire)"
                  value={reactQuery}
                  onChange={(e) => setReactQuery(e.target.value)}
                  autoFocus
                />
                <div className="reaction-search-grid" aria-label="Emoji search results">
                  {reactionSearchResults.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-selected={myReaction === emoji}
                      className={myReaction === emoji ? 'active' : ''}
                      onClick={() => {
                        closeAll();
                        onReact(messageId, emoji);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>,
      document.body
    );

  return (
    <>
      <motion.div
        ref={rootRef}
        className={`message-row ${isMine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''} ${anyPopover ? 'popover-open' : ''} ${pinned ? 'pinned' : ''} ${starred ? 'starred' : ''}`}
        initial={false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className={`message-bubble-wrap ${isMine ? 'mine' : 'theirs'}`}>
          <div className={`message-bubble ${isMine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''}${message.expiresAt ? ' has-expiry' : ''}${isStoryReaction ? ' story-reaction-pill' : ''}`}>
            {senderLabel && !isMine && !grouped && (
              <div className="message-sender-label">
                {senderLabel}
                {message.kind === 'ai' && <span className="verified-ai-badge">AI</span>}
              </div>
            )}
            {message.kind === 'ai' && !senderLabel && (
              <div className="message-sender-label">
                QuantumAI <span className="verified-ai-badge">AI</span>
              </div>
            )}
            {(pinned || starred) && (
              <div className="message-flags">
                {pinned && <span title="Pinned"><Pin size={12} /></span>}
                {starred && <span title="Starred"><Star size={12} /></span>}
              </div>
            )}
            {message.kind === 'ai_note' && (
              <div className="message-forwarded-label">Encrypted QuantumAI note</div>
            )}
            {message.forwardedFrom?.username && (
              <div className="message-forwarded-label">Forwarded from {message.forwardedFrom.username}</div>
            )}
            {replyPreview && (
              <button
                type="button"
                className="message-reply-preview"
                onClick={() => onJumpToReply?.(message.replyTo?.id || message.replyTo?._id)}
                disabled={!onJumpToReply}
              >
                <span className="message-reply-label">{replyPreview.label}</span>
                <span className="message-reply-text">{replyPreview.text}</span>
              </button>
            )}
            {message.attachment && structured.type !== 'file' && (
              <AttachmentBubble
                attachment={message.attachment}
                isMine={isMine}
                resolveSecretKey={keyResolver}
                onImagePreview={onImagePreview}
                onImageReady={onImageReady}
              />
            )}
            {callMeta ? (
              <div className="call-message">
                <div className="call-message-icon"><Phone size={20} /></div>
                <div className="call-message-body">
                  <div className="call-message-title">Voice call</div>
                  <div className="call-message-sub">
                    {callMeta.answered
                      ? `Duration ${formatVoiceTimer(callMeta.durationSeconds || 0)}`
                      : 'Missed call'}
                  </div>
                </div>
              </div>
            ) : meetingMeta ? (
              <div className="call-message">
                <div className="call-message-icon"><Users size={20} /></div>
                <div className="call-message-body">
                  <div className="call-message-title">{meetingMeta.video ? 'Video meeting' : 'Voice meeting'}</div>
                  <div className="call-message-sub">
                    {meetingMeta.answered
                      ? `${meetingMeta.participantCount || 1} participants · ${formatVoiceTimer(meetingMeta.durationSeconds || 0)}`
                      : 'No one joined'}
                  </div>
                </div>
              </div>
            ) : message.group && message.text != null ? (
              <GroupMessageContent
                message={message}
                payload={structured}
                currentUserId={currentUserId}
                onVotePoll={onVotePoll}
                resolveSecretKey={keyResolver}
                attachment={message.attachment}
                isMine={isMine}
                onImagePreview={onImagePreview}
                onImageReady={onImageReady}
              />
              ) : isStoryReaction ? (
              <button
                type="button"
                className="story-reaction-bubble story-reaction-bubble-clickable"
                onClick={() => onOpenStory?.(storyReplyPayload.storyId)}
              >
                <span className="story-reaction-emoji">{storyReplyPayload.emoji}</span>
                <span className="story-reaction-label">
                  {isMine ? 'You reacted to their story' : 'Reacted to your story'}
                </span>
              </button>
            ) : isStoryReply ? (
              <div>
                <button
                  type="button"
                  className="story-reply-quote story-reply-quote-clickable"
                  onClick={() => onOpenStory?.(storyReplyPayload.storyId)}
                >
                  <div className="story-reply-thumb">
                    {storyReplyPayload.mediaType === 'video' ? (
                      <Video size={16} strokeWidth={2} />
                    ) : storyReplyPayload.mediaType === 'audio' ? (
                      <Music size={16} strokeWidth={2} />
                    ) : (
                      <ImageIcon size={16} strokeWidth={2} />
                    )}
                  </div>
                  <div className="story-reply-quote-meta">
                    <span className="story-reply-quote-label">
                      {isMine ? 'You replied to their story' : 'Replied to your story'}
                    </span>
                    {storyReplyPayload.caption ? (
                      <span className="story-reply-quote-caption">{storyReplyPayload.caption}</span>
                    ) : null}
                  </div>
                </button>
                <div>{storyReplyPayload.text}</div>
              </div>
            ) : hasTextContent ? (
              <span className="message-text">{message.text}</span>
            ) : isDecryptionFail ? (
              <em>[Unable to decrypt message]</em>
            ) : null}
            <span className="message-time-spacer" aria-hidden="true">{timeMeta}</span>
            <span className={`message-time ${isStoryReaction ? 'story-reaction-time' : ''}`} title={fullTime}>
              {timeMeta}
            </span>
          </div>

          <div className="message-action-cluster">
            {onReact && (
              <button
                ref={reactBtnRef}
                type="button"
                className={`message-react-btn ${reactOpen || myReaction ? 'visible' : ''}`}
                aria-label="Add reaction"
                onClick={() => {
                  anchorRef.current = reactBtnRef.current;
                  setReactOpen((v) => !v);
                  setReactSearchOpen(false);
                  setReactQuery('');
                  setMenuOpen(false);
                }}
              >
                <Smile size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
            <button
              ref={moreRef}
              type="button"
              className={`message-more-btn ${anyPopover ? 'visible' : ''}`}
              aria-label="Message options"
              aria-expanded={anyPopover}
              onClick={() => {
                anchorRef.current = moreRef.current;
                setMenuOpen((v) => !v);
                setReactOpen(false);
              }}
            >
              <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
            </button>
      </div>
    </div>

        {popover}

        {reactionGroups.length > 0 && (
          <div className={`message-reactions ${isMine ? 'mine' : 'theirs'}`}>
            {reactionGroups.map((g) => (
              <button
                key={g.emoji}
                type="button"
                className={`reaction-chip ${g.users.includes(String(currentUserId)) ? 'mine' : ''}`}
                onClick={() => onReact?.(messageId, g.emoji)}
                aria-label={`React with ${g.emoji}`}
                disabled={!onReact}
              >
                <span>{g.emoji}</span>
                {g.count > 1 && <span className="reaction-count">{g.count}</span>}
              </button>
            ))}
          </div>
        )}
      </motion.div>
    </>
  );
}

export default memo(MessageBubble);
