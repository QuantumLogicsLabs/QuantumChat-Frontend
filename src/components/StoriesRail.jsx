import { useEffect, useMemo, useRef, useState } from 'react';
import { QUICK_REACTIONS } from '../utils/emojis.js';
import client from '../api/client.js';
import {
  findSecretKeyForPublicKey,
  getCurrentKeySet,
  getKeyring,
} from '../crypto/keyStorage.js';
import { getSocket } from '../api/socket.js';
import { sealMessage, unsealMessage, pickRandom } from '../crypto/keys.js';
import UserAvatar from './UserAvatar.jsx';
import { motion } from 'framer-motion';
import { Send, Smile, X } from 'lucide-react';
import { COMPOSER_EMOJIS, searchEmojis } from '../utils/emojis.js';
const MAX_STORY_SECONDS = 60;
const TTL_PRESETS = [
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '6 hours', ms: 6 * 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '3 days', ms: 3 * 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
];
const DEFAULT_TTL_MS = TTL_PRESETS[2].ms; // 24h
const MIN_TTL_MS = 15 * 60 * 1000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function bytesToBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToBytes(b64) {
  // Multipart form fields sometimes turn '+' into spaces; normalize before atob.
  const normalized = String(b64 || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/\s/g, '');
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesGcmEncryptBlob(file) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new Uint8Array(await file.arrayBuffer());

  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return {
    cipherBytes: new Uint8Array(cipherBuf),
    keyB64: bytesToBase64(rawKey),
    ivB64: bytesToBase64(iv),
  };
}

async function aesGcmDecryptBytes(cipherBytes, keyB64, ivB64) {
  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(keyB64),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivB64) },
    key,
    cipherBytes
  );
  return new Uint8Array(plain);
}

function probeMediaDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');
    const el = document.createElement(isVideo ? 'video' : 'audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const durationMs = Math.round((el.duration || 0) * 1000);
      URL.revokeObjectURL(url);
      resolve(durationMs);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read media duration'));
    };
    el.src = url;
  });
}

function envelopeUserId(envelope) {
  return String(envelope?.user?.id || envelope?.user || '');
}

function buildStoryEnvelopes(audience, keyB64, ivB64) {
  const secretPayload = JSON.stringify({ keyB64, ivB64 });
  return audience.map((u) => {
    const keys = (u.publicKeys || []).filter(Boolean);
    if (!keys.length) throw new Error(`Missing X5 keys for ${u.username || u.id}`);
    const sealed = sealMessage(secretPayload, pickRandom(keys));
    return { user: String(u.id), ...sealed };
  });
}

function tryParseKeyPayload(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.keyB64 && parsed?.ivB64) return parsed;
  } catch {
    // ignore
  }
  return null;
}

/** Open the AES media key from any of this viewer's story envelopes. */
function unlockStoryKey(story, currentUserId) {
  const uid = String(currentUserId?.id || currentUserId || '');
  if (!uid) return null;
  const envelopes = (story.envelopes || []).filter((e) => envelopeUserId(e) === uid);
  if (!envelopes.length) return null;

  const ring = getKeyring(uid);

  for (const envelope of envelopes) {
    const hinted = envelope.targetPublicKey
      ? findSecretKeyForPublicKey(uid, envelope.targetPublicKey)
      : null;
    if (hinted) {
      const unlocked = tryParseKeyPayload(unsealMessage(envelope, hinted));
      if (unlocked) return unlocked;
    }
    // Fallback: try every local secret (covers stale targetPublicKey hints).
    for (const entry of ring) {
      if (hinted && entry.secretKey === hinted) continue;
      const unlocked = tryParseKeyPayload(unsealMessage(envelope, entry.secretKey));
      if (unlocked) return unlocked;
    }
  }
  return null;
}

function viewerCanSeeStory(story, currentUserId) {
  if (!story?.sealed) return true;
  const uid = String(currentUserId?.id || currentUserId || '');
  return (story.envelopes || []).some((e) => envelopeUserId(e) === uid);
}

import { forwardRef, useImperativeHandle } from 'react';

const StoriesRail = forwardRef(function StoriesRail({ currentUser, users = [], onError }, ref) {
  const [stories, setStories] = useState([]);
  const [viewer, setViewer] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
const [pendingPreviewUrl, setPendingPreviewUrl] = useState(null);
  const inputRef = useRef(null);
const [unavailable, setUnavailable] = useState(false);
  const grouped = useMemo(() => {
    const map = new Map();
    for (const story of stories) {
      if (!viewerCanSeeStory(story, currentUser?.id)) continue;
      const uid = String(story.user?.id || story.user);
      if (!map.has(uid)) {
        map.set(uid, { user: story.user, items: [] });
      }
      map.get(uid).items.push(story);
    }
    const list = [...map.values()];
    list.sort((a, b) => {
      const aOwn = String(a.user?.id) === String(currentUser?.id);
      const bOwn = String(b.user?.id) === String(currentUser?.id);
      if (aOwn && !bOwn) return -1;
      if (!aOwn && bOwn) return 1;
      return 0;
    });
    return list;
  }, [stories, currentUser?.id]);

  async function loadStories() {
    const { data } = await client.get('/stories');
    setStories(data.data || []);
  }

  useEffect(() => {
    loadStories().catch(() => {});
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    function onNew(payload) {
      if (!payload?.id) return;
      if (!viewerCanSeeStory(payload, currentUser?.id)) return;
      setStories((prev) => {
        if (prev.some((s) => String(s.id) === String(payload.id))) return prev;
        return [payload, ...prev];
      });
    }
    function onDeleted({ id } = {}) {
      if (!id) return;
      setStories((prev) => prev.filter((s) => String(s.id) !== String(id)));
    }
    socket.on('story:new', onNew);
    socket.on('story:deleted', onDeleted);
    return () => {
      socket.off('story:new', onNew);
      socket.off('story:deleted', onDeleted);
    };
  }, [currentUser?.id]);

  function handleFileSelected(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
  setPendingFile(file);
  setPendingPreviewUrl(URL.createObjectURL(file));
}
async function uploadStory(file, ttlMs) {
  try {
    setUploading(true);
    let durationMs = 0;
    if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
      durationMs = await probeMediaDuration(file);
      if (durationMs > MAX_STORY_SECONDS * 1000) {
        onError?.(`Stories must be ${MAX_STORY_SECONDS} seconds or shorter`);
        return;
      }
    }

    const form = new FormData();
    const canSeal = typeof crypto !== 'undefined' && crypto.subtle;

    if (canSeal) {
      const sealed = await aesGcmEncryptBlob(file);
      const localKeySet = getCurrentKeySet(currentUser.id);
      const authorPublicKeys = localKeySet.map((k) => k.publicKey).filter(Boolean);
      if (!authorPublicKeys.length) {
        throw new Error('Import your encryption keys before posting a sealed story');
      }
      for (const pk of authorPublicKeys) {
        if (!findSecretKeyForPublicKey(currentUser.id, pk)) {
          throw new Error('Local keyring is incomplete — re-import your keys.txt');
        }
      }

      const audienceMap = new Map();
      audienceMap.set(String(currentUser.id), {
        id: String(currentUser.id),
        username: currentUser.username,
        publicKeys: authorPublicKeys,
      });
      for (const u of users) {
        if (!u?.id || !u.publicKeys?.length) continue;
        if (String(u.id) === String(currentUser.id)) continue;
        audienceMap.set(String(u.id), {
          id: String(u.id),
          username: u.username,
          publicKeys: u.publicKeys,
        });
      }
      const audience = [...audienceMap.values()];
      const envelopes = buildStoryEnvelopes(audience, sealed.keyB64, sealed.ivB64);

      form.append(
        'file',
        new Blob([sealed.cipherBytes], { type: 'application/octet-stream' }),
        file.name || 'story.bin'
      );
      form.append('sealed', 'true');
      form.append('mimetype', file.type || 'application/octet-stream');
      if (file.type.startsWith('image/')) form.append('mediaType', 'image');
      else if (file.type.startsWith('video/')) form.append('mediaType', 'video');
      else if (file.type.startsWith('audio/')) form.append('mediaType', 'audio');
      form.append('contentIv', sealed.ivB64);
      form.append('envelopes', JSON.stringify(envelopes));
    } else {
      form.append('file', file);
    }
    form.append('durationMs', String(durationMs));
   form.append('ttlMs', String(ttlMs));

    await client.post('/stories', form);
    await loadStories();
  } catch (err) {
    onError?.(err.response?.data?.error || err.message || 'Failed to upload story');
  } finally {
    setUploading(false);
  }
}

function closeComposer() {
  if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
  setPendingFile(null);
  setPendingPreviewUrl(null);
}

async function confirmPostStory(ttlMs) {
  const file = pendingFile;
  closeComposer();
  if (file) await uploadStory(file, ttlMs);
}

useImperativeHandle(ref, () => ({
    async openStoryById(storyId) {
      try {
        const { data } = await client.get(`/stories/${storyId}`);
        const story = data.data;
        setUnavailable(false);
        setViewer({ group: { user: story.user, items: [story] }, index: 0 });
      } catch {
        setUnavailable(true);
      }
    },
  }));
  return (
    <div className="stories-rail">
      <p className="stories-privacy-note">
        Sealed stories use X5 envelopes so allowed contacts can decrypt; the server only stores ciphertext.
      </p>
      <button
        type="button"
        className="story-ring add"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        aria-label="Add story"
      >
        <UserAvatar
          userId={currentUser?.id}
          name={currentUser?.username}
          hasAvatar={currentUser?.hasAvatar}
          size="story"
        />
        <span className="story-add-badge">+</span>
        <span className="story-ring-label">{uploading ? 'Uploading…' : 'Your story'}</span>
      </button>
      <input
  ref={inputRef}
  type="file"
  accept="image/*,video/*,audio/*"
  hidden
  onChange={handleFileSelected}
/>

      {grouped
        .filter((g) => String(g.user?.id) !== String(currentUser?.id) || g.items.length > 0)
        .map((g) => (
          <button
            key={String(g.user?.id)}
            type="button"
            className="story-ring"
            onClick={() => {
              setUnavailable(false);
              setViewer({ group: g, index: 0 });
            }}
          >
            <UserAvatar
              userId={g.user?.id}
              name={g.user?.username}
              hasAvatar={g.user?.hasAvatar}
              size="story"
            />
            <span className="story-ring-label">{g.user?.username}</span>
          </button>
        ))}

      {viewer && (
        <StoryViewer
          group={viewer.group}
          startIndex={viewer.index}
          currentUserId={currentUser?.id}
          users={users}
          onError={onError}
          onClose={() => setViewer(null)}
          onDeleted={async () => {
            setViewer(null);
            await loadStories();
          }}
        />
      )}
     {unavailable && (
        <div className="story-viewer-overlay" onClick={() => setUnavailable(false)}>
          <div className="story-unavailable-card" onClick={(e) => e.stopPropagation()}>
            <p>This story is no longer available.</p>
            <button type="button" onClick={() => setUnavailable(false)}>
              OK
            </button>
          </div>
        </div>
      )}
      {pendingFile && (
  <StoryComposer
    file={pendingFile}
    previewUrl={pendingPreviewUrl}
    onCancel={closeComposer}
    onConfirm={confirmPostStory}
    uploading={uploading}
  />
)}
    </div>
  );
});

export default StoriesRail;

function StoryViewer({ group, startIndex, currentUserId, users = [], onClose, onDeleted, onError }) {
  const [index, setIndex] = useState(startIndex || 0);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [blockedReason, setBlockedReason] = useState('');
const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const replyInputRef = useRef(null);
  const [reacting, setReacting] = useState(false);
const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState('');
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [reactionQuery, setReactionQuery] = useState('');
  const [burst, setBurst] = useState(null);
  const story = group.items[index];
  const isOwn = String(group.user?.id) === String(currentUserId);

  useEffect(() => {
    let cancelled = false;
    let objectUrl;
    setMediaUrl(null);
    setBlockedReason('');

    (async () => {
      if (story.sealed) {
        const unlocked = unlockStoryKey(story, currentUserId);
        const ivB64 = unlocked?.ivB64 || story.contentIv;
        if (!unlocked?.keyB64 || !ivB64) {
          setBlockedReason('Sealed story — no envelope for your keys');
          return;
        }
        const res = await client.get(`/stories/${story.id}/media`, {
          responseType: 'arraybuffer',
        });
        const cipherBytes = new Uint8Array(res.data);
        const plain = await aesGcmDecryptBytes(cipherBytes, unlocked.keyB64, ivB64);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(
          new Blob([plain], { type: story.mimetype || 'application/octet-stream' })
        );
        setMediaUrl(objectUrl);
        return;
      }

      const res = await client.get(`/stories/${story.id}/media`, { responseType: 'blob' });
      if (cancelled) return;
      objectUrl = URL.createObjectURL(res.data);
      setMediaUrl(objectUrl);
    })().catch((err) => {
      if (!cancelled) {
        setMediaUrl(null);
        if (story.sealed) {
          const status = err?.response?.status;
          if (status === 403) {
            setBlockedReason('Sealed story — no envelope for your keys');
          } else if (status === 404) {
            setBlockedReason('Story media is missing on the server');
          } else {
            setBlockedReason('Could not decrypt this sealed story');
          }
        }
      }
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [story, currentUserId]);

 useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';

      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (typing) return; // let the input handle its own arrow keys

      if (e.key === 'ArrowRight') setIndex((i) => Math.min(group.items.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [group.items.length, onClose]);

  async function handleDelete() {
    if (!window.confirm('Delete this story?')) return;
    await client.delete(`/stories/${story.id}`);
    onDeleted?.();
  }
async function handleSendReply() {
    const text = replyText.trim();
    if (!text || sendingReply) return;
    try {
      setSendingReply(true);

      const owner = users.find((u) => String(u.id) === String(group.user?.id));
      const ownerKeys = (owner?.publicKeys || []).filter(Boolean);
      if (!ownerKeys.length) {
        throw new Error("Can't reply — missing this user's encryption keys");
      }

      const selfKeySet = getCurrentKeySet(currentUserId);
      const selfKeys = selfKeySet.map((k) => k.publicKey).filter(Boolean);
      if (!selfKeys.length) {
        throw new Error('Import your encryption keys before replying');
      }

      const payload = JSON.stringify({
        type: 'story_reply',
        storyId: story.id,
        mediaType: story.mediaType,
        caption: story.caption || null,
        text,
      });

      const forRecipient = sealMessage(payload, pickRandom(ownerKeys));
      const forSender = sealMessage(payload, pickRandom(selfKeys));

      await client.post('/messages', {
        to: String(group.user?.id),
        forRecipient,
        forSender,
        replyToStory: story.id,
      });

      setReplyText('');
      if (replyInputRef.current) replyInputRef.current.style.height = 'auto';
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  }
  function autoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  function handleReplyKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendReply();
    }
  }
  async function handleReact(emoji) {
    if (reacting) return;
    try {
      setReacting(true);
      setReactionPickerOpen(false);

      const owner = users.find((u) => String(u.id) === String(group.user?.id));
      const ownerKeys = (owner?.publicKeys || []).filter(Boolean);
      if (!ownerKeys.length) {
        throw new Error("Can't react — missing this user's encryption keys");
      }

      const selfKeySet = getCurrentKeySet(currentUserId);
      const selfKeys = selfKeySet.map((k) => k.publicKey).filter(Boolean);
      if (!selfKeys.length) {
        throw new Error('Import your encryption keys before reacting');
      }

      const payload = JSON.stringify({
        type: 'story_reaction',
        storyId: story.id,
        mediaType: story.mediaType,
        emoji,
      });

      const forRecipient = sealMessage(payload, pickRandom(ownerKeys));
      const forSender = sealMessage(payload, pickRandom(selfKeys));

      await client.post('/messages', {
        to: String(group.user?.id),
        forRecipient,
        forSender,
        replyToStory: story.id,
      });

      setBurst(emoji);
      setTimeout(() => setBurst(null), 700);
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to react');
    } finally {
      setReacting(false);
    }
  }
 const emojiResults = useMemo(
    () => (emojiQuery.trim() ? searchEmojis(emojiQuery, 60) : COMPOSER_EMOJIS.slice(0, 60)),
    [emojiQuery]
  );
  const reactionResults = useMemo(
    () => (reactionQuery.trim() ? searchEmojis(reactionQuery, 60) : COMPOSER_EMOJIS.slice(0, 60)),
    [reactionQuery]
  );

  function insertEmoji(emoji) {
    setReplyText((t) => t + emoji);
  }

  return (
    <div className="story-viewer-overlay" onClick={onClose}>
      <div className="story-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="story-viewer-top">
          <div className="story-viewer-user">
            <UserAvatar
              userId={group.user?.id}
              name={group.user?.username}
              hasAvatar={group.user?.hasAvatar}
              size="sm"
            />
            <span>{group.user?.username}</span>
            {story.sealed ? <span className="story-sealed-badge">Sealed X5</span> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="story-viewer-progress">
          {group.items.map((s, i) => (
            <span key={s.id} className={i === index ? 'on' : ''} />
          ))}
        </div>
        <div
          className="story-viewer-media"
          onDoubleClick={() => !isOwn && handleReact('❤️')}
        >
          {blockedReason && <p className="empty-hint">{blockedReason}</p>}
          {!blockedReason && !mediaUrl && <p className="empty-hint">Loading…</p>}
          {mediaUrl && story.mediaType === 'image' && <img src={mediaUrl} alt="" />}
          {mediaUrl && story.mediaType === 'video' && <video src={mediaUrl} autoPlay controls />}
          {mediaUrl && story.mediaType === 'audio' && <audio src={mediaUrl} autoPlay controls />}
          {burst && <span className="story-reaction-burst">{burst}</span>}
        </div>
        {story.caption && <p className="story-caption">{story.caption}</p>}
       <div className="story-viewer-actions">
          {isOwn && (
            <button type="button" onClick={handleDelete}>
              Delete
            </button>
          )}
        </div>

     {!isOwn && (
          <form
            className="story-reply-bar"
            onSubmit={(e) => {
              e.preventDefault();
              handleSendReply();
            }}
          >
            <div className="story-reply-input-wrap">
              <textarea
                ref={replyInputRef}
                rows={1}
                value={replyText}
                onChange={(e) => {
                  setReplyText(e.target.value);
                  autoGrow(e.target);
                }}
                onKeyDown={handleReplyKeyDown}
                placeholder={`Reply to ${group.user?.username}…`}
                disabled={sendingReply}
              />
              <button
                type="button"
                className={`story-emoji-btn ${emojiPickerOpen ? 'open' : ''}`}
                aria-label={emojiPickerOpen ? 'Close emoji picker' : 'Add emoji to message'}
                onClick={() => {
                  setEmojiPickerOpen((v) => !v);
                  setReactionPickerOpen(false);
                }}
              >
                {emojiPickerOpen ? <X size={17} strokeWidth={2.2} /> : <Smile size={17} strokeWidth={2} />}
              </button>
            </div>

            <button
              type="submit"
              disabled={sendingReply || !replyText.trim()}
              aria-label="Send reply"
              className={`story-reply-send ${replyText.trim() ? 'ready' : ''}`}
            >
              {sendingReply ? <span className="story-reply-spinner" /> : <Send size={16} strokeWidth={2.2} />}
            </button>

            <button
              type="button"
              className={`story-heart-btn ${reactionPickerOpen ? 'open' : ''}`}
              aria-label={reactionPickerOpen ? 'Close reactions' : 'Send a reaction'}
              disabled={reacting}
              onClick={() => {
                setReactionPickerOpen((v) => !v);
                setEmojiPickerOpen(false);
              }}
            >
              {reactionPickerOpen ? <X size={17} strokeWidth={2.2} /> : '❤️'}
            </button>

            {emojiPickerOpen && (
              <div className="story-emoji-picker anchored-left">
                <div className="story-reaction-picker-header">
                  <input
                    type="text"
                    value={emojiQuery}
                    onChange={(e) => setEmojiQuery(e.target.value)}
                    placeholder="Search emoji"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="story-reaction-picker-close"
                    aria-label="Close"
                    onClick={() => setEmojiPickerOpen(false)}
                  >
                    <X size={15} strokeWidth={2.2} />
                  </button>
                </div>
                <div className="story-reaction-picker-grid">
                  {emojiResults.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {reactionPickerOpen && (
              <div className="story-reaction-picker anchored-right">
                <div className="story-reaction-picker-header">
                  <input
                    type="text"
                    value={reactionQuery}
                    onChange={(e) => setReactionQuery(e.target.value)}
                    placeholder="Search emoji"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="story-reaction-picker-close"
                    aria-label="Close"
                    onClick={() => setReactionPickerOpen(false)}
                  >
                    <X size={15} strokeWidth={2.2} />
                  </button>
                </div>
                <div className="story-reaction-picker-grid">
                  {reactionResults.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => handleReact(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>
        )}
        </div>
    </div>
  );
}
function StoryComposer({ file, previewUrl, onCancel, onConfirm, uploading }) {
  const [preset, setPreset] = useState(DEFAULT_TTL_MS);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState(24);
  const [customUnit, setCustomUnit] = useState('hours');

  const unitMultiplier = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };

  function computeTtlMs() {
    if (customMode) {
      const raw = Number(customValue) || 0;
      const ms = raw * (unitMultiplier[customUnit] || unitMultiplier.hours);
      return Math.min(Math.max(ms, MIN_TTL_MS), MAX_TTL_MS);
    }
    return preset;
  }

  return (
    <div className="story-composer-overlay" onClick={onCancel}>
      <div className="story-composer" onClick={(e) => e.stopPropagation()}>
        <div className="story-composer-top">
          <span>New story</span>
          <button type="button" onClick={onCancel} aria-label="Cancel">
            ×
          </button>
        </div>

        <div className="story-composer-preview">
          {/*
            previewUrl is always URL.createObjectURL(file) — a browser-generated
            blob: URL, never raw user text. Media `src` attributes load bytes as
            image/video/audio; they never parse the string as HTML markup, so
            this cannot be a DOM-based XSS sink. Suppressing the CodeQL false
            positive rather than dismissing it silently in the UI.
          */}
          {file.type.startsWith('image/') && (
            // codeql[js/xss-through-dom]
            <img src={previewUrl} alt="" />
          )}
          {file.type.startsWith('video/') && (
            // codeql[js/xss-through-dom]
            <video src={previewUrl} controls />
          )}
          {file.type.startsWith('audio/') && (
            // codeql[js/xss-through-dom]
            <audio src={previewUrl} controls />
          )}
        </div>

        <div className="story-composer-ttl">
          <p className="story-composer-ttl-label">How long should this story last?</p>
          <div className="story-composer-ttl-presets">
            {TTL_PRESETS.map((p) => (
              <button
                key={p.ms}
                type="button"
                className={`story-ttl-preset ${!customMode && preset === p.ms ? 'active' : ''}`}
                onClick={() => {
                  setCustomMode(false);
                  setPreset(p.ms);
                }}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className={`story-ttl-preset ${customMode ? 'active' : ''}`}
              onClick={() => setCustomMode(true)}
            >
              Custom…
            </button>
          </div>

          {customMode && (
            <div className="story-composer-custom-row">
              <input
                type="number"
                min="1"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                aria-label="Custom duration value"
              />
              <select
                value={customUnit}
                onChange={(e) => setCustomUnit(e.target.value)}
                aria-label="Custom duration unit"
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
          )}
        </div>

        <div className="story-composer-actions">
          <button type="button" className="story-composer-cancel" onClick={onCancel} disabled={uploading}>
            Cancel
          </button>
          <button
            type="button"
            className="story-composer-post"
            disabled={uploading}
            onClick={() => onConfirm(computeTtlMs())}
          >
            {uploading ? 'Posting…' : 'Post story'}
          </button>
        </div>
      </div>
    </div>
  );
}