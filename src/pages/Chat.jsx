import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import client from '../api/client.js';
import { connectSocket, getSocket } from '../api/socket.js';
import { sealMessage, unsealMessage, sealBytes, pickRandom } from '../crypto/keys.js';
import { parseKeyFile } from '../crypto/keyFile.js';
import { getCurrentKeySet, findSecretKeyForPublicKey } from '../crypto/keyStorage.js';
import UserList from '../components/UserList.jsx';
import MessageBubble from '../components/MessageBubble.jsx';

function formatLastSeen(iso) {
  if (!iso) return 'never logged in';
  return `last seen ${new Date(iso).toLocaleString()}`;
}

export default function Chat() {
  const { user, logout, regenerateKeys, importKeys, hasLocalKeyring } = useAuth();

  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [importError, setImportError] = useState('');
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const keyFileInputRef = useRef(null);
  const selectedUserRef = useRef(null);
  selectedUserRef.current = selectedUser;

  // Scroll to bottom helper
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    if (messageListRef.current) {
      const el = messageListRef.current;
      el.scrollTo({
        top: el.scrollHeight,
        behavior,
      });
    }
    setHasUnread(false);
  }, []);

  // Track scroll position of message list to toggle unread message bubble helper
  const handleScroll = useCallback(() => {
    if (!messageListRef.current) return;
    const el = messageListRef.current;
    const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 150;
    if (!isUp) {
      setHasUnread(false);
    }
  }, []);

  // Every sealed-box envelope names the public key it was sealed to
  // (targetPublicKey). Opening it just means finding that key's private
  // half in the local keyring — a public key never appears here, because
  // unsealing structurally requires a private key (see crypto/keys.js).
  const resolveMySecretKey = useCallback((targetPublicKeyHex) => findSecretKeyForPublicKey(user.id, targetPublicKeyHex), [user]);

  const decorate = useCallback(
    (raw) => {
      const isMine = raw.from === user.id;
      const envelope = isMine ? raw.forSender : raw.forRecipient;
      const mySecretKey = resolveMySecretKey(envelope.targetPublicKey);
      const text = mySecretKey ? unsealMessage(envelope, mySecretKey) : null;
      return { ...raw, text };
    },
    [user, resolveMySecretKey]
  );

  useEffect(() => {
    if (!hasLocalKeyring) return;
    setLoadingUsers(true);
    client
      .get('/users')
      .then((res) => setUsers(res.data.data))
      .finally(() => setLoadingUsers(false));
  }, [hasLocalKeyring]);

  useEffect(() => {
    if (!hasLocalKeyring) return;
    connectSocket();
    const socket = getSocket();

    function handleIncoming(raw) {
      const current = selectedUserRef.current;
      const otherId = raw.from === user.id ? raw.to : raw.from;
      if (!current || current.id !== otherId) return;

      setMessages((prev) => {
        const next = [...prev, decorate(raw)];
        
        // Conditional scroll context
        if (messageListRef.current) {
          const el = messageListRef.current;
          const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 150;
          if (isUp) {
            setHasUnread(true);
          } else {
            setTimeout(() => scrollToBottom('smooth'), 50);
          }
        }
        return next;
      });
    }

    socket.on('message:new', handleIncoming);
    return () => socket.off('message:new', handleIncoming);
  }, [hasLocalKeyring, user, decorate, scrollToBottom]);

  // Socket.IO gives instant delivery where it's available (local dev), but
  // the deployed backend runs serverless (Vercel) and has no socket server
  // at all — without this, a new message only ever showed up after a full
  // page reload. Polling is a blunt fallback, but it works everywhere.
  useEffect(() => {
    if (!selectedUser || !hasLocalKeyring) return undefined;

    let cancelled = false;
    const fetchMessages = () => {
      client.get(`/messages/${selectedUser.id}`).then((res) => {
        if (cancelled) return;
        const next = res.data.data.map(decorate);
        // Skip the state update (and the auto-scroll-to-bottom it triggers)
        // when polling turns up nothing new — otherwise re-reading history
        // gets yanked back to the bottom every 3 seconds.
        setMessages((prev) => {
          const same = prev.length === next.length && prev.every((m, i) => (m.id || m._id) === (next[i].id || next[i]._id));
          return same ? prev : next;
        });
      });
    };

    fetchMessages();
    const intervalId = setInterval(fetchMessages, 3000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [selectedUser, hasLocalKeyring, decorate]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const canChat = hasLocalKeyring;

  function handleSelectUser(u) {
    setSelectedUser(u);
    setSidebarOpen(false);
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!draft.trim() || !selectedUser) return;
    try {
      // Both sides pick a random key from the target's current 5-key pool —
      // this conversation's ciphertext ends up spread across multiple keys
      // instead of always the same one.
      const myKey = pickRandom(getCurrentKeySet(user.id));
      const recipientPublicKey = pickRandom(selectedUser.publicKeys);
      // Sealed twice: once to the recipient (so they can read it), once to
      // my own key (so I can read my own sent history back — the ephemeral
      // key from either seal is discarded right after sealing).
      const forRecipient = sealMessage(draft, recipientPublicKey);
      const forSender = sealMessage(draft, myKey.publicKey);
      const { data } = await client.post('/messages', { to: selectedUser.id, forRecipient, forSender });
      setMessages((prev) => [...prev, decorate(data.data)]);
      setDraft('');
      setTimeout(() => scrollToBottom('smooth'), 50);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send message');
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedUser) return;
    try {
      const myKey = pickRandom(getCurrentKeySet(user.id));
      const recipientPublicKey = pickRandom(selectedUser.publicKeys);
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      // Attachments are sealed to the recipient only (not doubled like text)
      // to avoid uploading every file twice — the sender keeps their own
      // copy locally, so they don't need a server-side readable copy too.
      const sealed = sealBytes(fileBytes, recipientPublicKey);

      const formData = new FormData();
      formData.append('file', new Blob([sealed.cipherBytes]), file.name);
      formData.append('recipientId', selectedUser.id);
      formData.append('nonce', sealed.nonce);
      formData.append('ephemeralPublicKey', sealed.ephemeralPublicKey);
      formData.append('targetPublicKey', sealed.targetPublicKey);
      const uploadRes = await client.post('/attachments', formData);

      const forRecipient = sealMessage('', recipientPublicKey);
      const forSender = sealMessage('', myKey.publicKey);
      const { data } = await client.post('/messages', {
        to: selectedUser.id,
        forRecipient,
        forSender,
        attachmentId: uploadRes.data.data.id,
      });
      setMessages((prev) => [...prev, decorate(data.data)]);
      setTimeout(() => scrollToBottom('smooth'), 50);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send attachment');
    }
  }

  async function handleGenerateKeys() {
    await regenerateKeys();
    setError('');
  }

  async function handleImportKeyFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const secretKeys = parseKeyFile(text);
      importKeys(secretKeys);
      setImportError('');
    } catch (err) {
      setImportError(err.message || 'Failed to import keys.txt');
    }
  }

  const title = useMemo(() => selectedUser?.username || 'Select a conversation', [selectedUser]);
  const filteredUsers = useMemo(
    () => users.filter((u) => u?.username?.toLowerCase().includes(search.toLowerCase())),
    [users, search]
  );

  return (
    <div className="chat-page">
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="sidebar-brand-mark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-username">{user.username}</div>
              <div className="sidebar-lastseen">{formatLastSeen(user.lastLoginAt)}</div>
            </div>
          </div>
          <button className="link-button" onClick={logout} aria-label="Log out of application">
            Log out
          </button>
        </div>
        {canChat && (
          <div className="sidebar-search">
            <input placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users list" />
          </div>
        )}
        {canChat ? (
          <UserList
            users={filteredUsers}
            selectedUserId={selectedUser?.id}
            onSelect={handleSelectUser}
            loading={loadingUsers}
          />
        ) : (
          <p className="empty-hint">Set up your device key to see people.</p>
        )}
      </aside>

      <main className="chat-main">
        {!canChat && (
          <div className="key-warning">
            <p>
              No private keys found on this device. Either you cleared local storage or this is a new device.
              If you saved a keys.txt backup when you signed up, import it to keep reading your existing
              messages. Otherwise you can generate a fresh 5-key set, but old messages will stay unreadable.
            </p>
            {importError && <div className="auth-error">{importError}</div>}
            <div className="key-warning-actions">
              <button onClick={() => keyFileInputRef.current?.click()}>Import keys.txt</button>
              <input ref={keyFileInputRef} type="file" accept=".txt" hidden onChange={handleImportKeyFile} />
              <button className="secondary-button" onClick={handleGenerateKeys}>
                Generate new keys instead
              </button>
            </div>
          </div>
        )}

        {canChat && (
          <>
            <header className="chat-header">
              <div className="chat-header-left">
                <button
                  className="mobile-menu-btn"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open conversation sidebar"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                </button>
                <span>{title}</span>
              </div>
              {selectedUser && <span className="last-seen-badge">{formatLastSeen(selectedUser.lastLoginAt)}</span>}
            </header>

            {!selectedUser ? (
              <div className="chat-empty-state">
                <div className="chat-empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <h2>No conversation selected</h2>
                <p>Choose a person from the sidebar to start chatting</p>
              </div>
            ) : (
              <>
                <div
                  className="message-list"
                  ref={messageListRef}
                  onScroll={handleScroll}
                >
                  {loadingMessages ? (
                    <>
                      <div className="skeleton-message-bubble theirs skeleton" />
                      <div className="skeleton-message-bubble mine skeleton" />
                      <div className="skeleton-message-bubble theirs skeleton" style={{ width: '45%' }} />
                      <div className="skeleton-message-bubble mine skeleton" style={{ width: '35%' }} />
                    </>
                  ) : (
                    messages.map((m, index) => {
                      const prev = messages[index - 1];
                      // Message is grouped if sent by same user within 2 minutes of the previous message
                      const isGrouped =
                        prev &&
                        prev.from === m.from &&
                        new Date(m.createdAt) - new Date(prev.createdAt) < 120000;

                      return (
                        <MessageBubble
                          key={m.id || m._id}
                          message={m}
                          isMine={m.from === user.id}
                          resolveAttachmentKey={(attachment) =>
                            resolveMySecretKey(attachment.targetPublicKey)
                          }
                          grouped={isGrouped}
                        />
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>

                {hasUnread && (
                  <button
                    className="scroll-bottom-pill"
                    onClick={() => scrollToBottom('smooth')}
                    aria-label="Scroll to bottom to view new messages"
                  >
                    <span>New messages</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <polyline points="19 12 12 19 5 12" />
                    </svg>
                  </button>
                )}

                {error && <div className="auth-error">{error}</div>}

                <form className="composer" onSubmit={handleSend}>
                  <button
                    type="button"
                    className="attach-button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach file to message"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>
                  <input ref={fileInputRef} type="file" hidden onChange={handleFileChange} />
                  <input
                    placeholder="Type an encrypted message…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    aria-label="Type message body"
                  />
                  <button type="submit" className="send-button" aria-label="Send encrypted message">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                </form>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
