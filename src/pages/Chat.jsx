import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useKeyRotation } from '../hooks/useKeyRotation.js';
import client from '../api/client.js';
import { connectSocket, getSocket } from '../api/socket.js';
import { encryptMessage, decryptMessage, encryptBytes } from '../crypto/keys.js';
import { getCurrentKeyPair, findSecretKeyForPublicKey } from '../crypto/keyStorage.js';
import UserList from '../components/UserList.jsx';
import MessageBubble from '../components/MessageBubble.jsx';

function formatLastSeen(iso) {
  if (!iso) return 'never logged in';
  return `last seen ${new Date(iso).toLocaleString()}`;
}

export default function Chat() {
  const { user, logout, rotateKey, hasLocalKeyring } = useAuth();
  useKeyRotation();

  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const selectedUserRef = useRef(null);
  selectedUserRef.current = selectedUser;

  // For a given record carrying senderPublicKey/recipientPublicKey (a
  // message or an attachment), figures out which of the two snapshotted
  // keys was "mine" at send time and looks up the matching secret key from
  // the local keyring — this works across any number of rotations, because
  // every keypair this device has ever used is kept, not just the latest.
  const resolveKeys = useCallback(
    (record, isMine) => {
      const myPublicKeyAtTime = isMine ? record.senderPublicKey : record.recipientPublicKey;
      const otherPublicKeyAtTime = isMine ? record.recipientPublicKey : record.senderPublicKey;
      return {
        mySecretKey: findSecretKeyForPublicKey(user.id, myPublicKeyAtTime),
        otherPublicKeyAtTime,
      };
    },
    [user]
  );

  const decorate = useCallback(
    (raw) => {
      const isMine = raw.from === user.id;
      const { mySecretKey, otherPublicKeyAtTime } = resolveKeys(raw, isMine);
      const text = mySecretKey ? decryptMessage(raw.ciphertext, raw.nonce, otherPublicKeyAtTime, mySecretKey) : null;
      return { ...raw, text };
    },
    [user, resolveKeys]
  );

  useEffect(() => {
    if (!hasLocalKeyring) return;
    client.get('/users').then((res) => setUsers(res.data.data));
  }, [hasLocalKeyring]);

  useEffect(() => {
    if (!hasLocalKeyring) return;
    connectSocket();
    const socket = getSocket();

    function handleIncoming(raw) {
      const current = selectedUserRef.current;
      const otherId = raw.from === user.id ? raw.to : raw.from;
      if (!current || current.id !== otherId) return;
      setMessages((prev) => [...prev, decorate(raw)]);
    }

    socket.on('message:new', handleIncoming);
    return () => socket.off('message:new', handleIncoming);
  }, [hasLocalKeyring, user, decorate]);

  useEffect(() => {
    if (!selectedUser || !hasLocalKeyring) return;
    client.get(`/messages/${selectedUser.id}`).then((res) => {
      setMessages(res.data.data.map(decorate));
    });
  }, [selectedUser, hasLocalKeyring, decorate]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const canChat = hasLocalKeyring;

  async function handleSend(e) {
    e.preventDefault();
    if (!draft.trim() || !selectedUser) return;
    try {
      const mine = getCurrentKeyPair(user.id);
      const { ciphertext, nonce } = encryptMessage(draft, selectedUser.publicKey, mine.secretKey);
      const { data } = await client.post('/messages', {
        to: selectedUser.id,
        ciphertext,
        nonce,
        senderPublicKey: mine.publicKey,
        recipientPublicKey: selectedUser.publicKey,
      });
      setMessages((prev) => [...prev, decorate(data.data)]);
      setDraft('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send message');
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedUser) return;
    try {
      const mine = getCurrentKeyPair(user.id);
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const { cipherBytes, nonce: fileNonce } = encryptBytes(fileBytes, selectedUser.publicKey, mine.secretKey);

      const formData = new FormData();
      formData.append('file', new Blob([cipherBytes]), file.name);
      formData.append('recipientId', selectedUser.id);
      formData.append('nonce', fileNonce);
      formData.append('senderPublicKey', mine.publicKey);
      formData.append('recipientPublicKey', selectedUser.publicKey);
      const uploadRes = await client.post('/attachments', formData);

      const { ciphertext, nonce } = encryptMessage('', selectedUser.publicKey, mine.secretKey);
      const { data } = await client.post('/messages', {
        to: selectedUser.id,
        ciphertext,
        nonce,
        senderPublicKey: mine.publicKey,
        recipientPublicKey: selectedUser.publicKey,
        attachmentId: uploadRes.data.data.id,
      });
      setMessages((prev) => [...prev, decorate(data.data)]);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send attachment');
    }
  }

  async function handleRotateNow() {
    await rotateKey();
    setError('');
  }

  const title = useMemo(() => selectedUser?.username || 'Select a conversation', [selectedUser]);
  const filteredUsers = useMemo(
    () => users.filter((u) => u.username.toLowerCase().includes(search.toLowerCase())),
    [users, search]
  );

  return (
    <div className="chat-page">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <div className="sidebar-username">{user.username}</div>
            <div className="sidebar-lastseen">{formatLastSeen(user.lastLoginAt)}</div>
          </div>
          <button className="link-button" onClick={logout}>
            Log out
          </button>
        </div>
        {canChat && (
          <div className="sidebar-search">
            <input placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        {canChat ? (
          <UserList users={filteredUsers} selectedUserId={selectedUser?.id} onSelect={setSelectedUser} />
        ) : (
          <p className="empty-hint">Set up your device key to see people.</p>
        )}
      </aside>

      <main className="chat-main">
        {!canChat && (
          <div className="key-warning">
            <p>
              No private key found on this device. Either you cleared local storage or this is a new device.
              Old messages encrypted under your previous key will remain unreadable, but you can generate a
              new keypair to continue chatting.
            </p>
            <button onClick={handleRotateNow}>Generate new keypair for this device</button>
          </div>
        )}

        {canChat && (
          <>
            <header className="chat-header">
              <span>{title}</span>
              {selectedUser && <span className="last-seen-badge">{formatLastSeen(selectedUser.lastLoginAt)}</span>}
            </header>
            <div className="message-list">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id || m._id}
                  message={m}
                  isMine={m.from === user.id}
                  resolveKeys={(record) => resolveKeys(record, m.from === user.id)}
                />
              ))}
              <div ref={bottomRef} />
            </div>
            {error && <div className="auth-error">{error}</div>}
            {selectedUser && (
              <form className="composer" onSubmit={handleSend}>
                <button type="button" className="attach-button" onClick={() => fileInputRef.current?.click()}>
                  📎
                </button>
                <input ref={fileInputRef} type="file" hidden onChange={handleFileChange} />
                <input
                  placeholder="Type an encrypted message…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button type="submit">Send</button>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
