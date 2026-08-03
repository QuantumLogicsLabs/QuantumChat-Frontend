import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { QUICK_REACTIONS } from '../utils/emojis.js';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  getToken,
  findSecretKeyForPublicKey,
  getCurrentKeySet,
  getKeyringSyncStatus,
  getStoredUser,
  getKeyring,
} from '../crypto/keyStorage.js';
import { getSocket } from '../api/socket.js';
import { sealMessage, unsealMessage, pickRandom, KEY_SET_SIZE } from '../crypto/keys.js';
import UserAvatar from './UserAvatar.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { motion } from 'framer-motion';
import { Send, Smile, X } from 'lucide-react';
import { COMPOSER_EMOJIS, searchEmojis } from '../utils/emojis.js';
import { shouldNotify, playNotificationSound, showNotificationPopup } from '../utils/notificationDispatch.js';
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

/**
 * Open the AES media key from any of this viewer's story envelopes.
 * Returns { ok: true, payload } on success, or { ok: false, reason, targetPublicKey? }
 * so the UI can show a precise message (no envelope vs. no matching secret vs. decrypt failure).
 */
function unlockStoryKey(story, currentUserId) {
  const uid = String(currentUserId?.id || currentUserId || '');
  if (!uid) return { ok: false, reason: 'no-envelope' };

  const envelopes = (story.envelopes || []).filter((e) => envelopeUserId(e) === uid);
  if (!envelopes.length) return { ok: false, reason: 'no-envelope' };

  const ring = getKeyring(uid);

  for (const envelope of envelopes) {
    const hinted = envelope.targetPublicKey
      ? findSecretKeyForPublicKey(uid, envelope.targetPublicKey)
      : null;

    if (hinted) {
      const payload = tryParseKeyPayload(unsealMessage(envelope, hinted));
      if (payload) return { ok: true, payload };
    }

    // Fallback: try every local secret (covers a stale/mismatched targetPublicKey hint).
    for (const entry of ring) {
      if (hinted && entry.secretKey === hinted) continue;
      const payload = tryParseKeyPayload(unsealMessage(envelope, entry.secretKey));
      if (payload) return { ok: true, payload };
    }
  }

  return {
    ok: false,
    reason: 'no-secret',
    targetPublicKey: envelopes[0]?.targetPublicKey,
  };
}

function viewerCanSeeStory(story, currentUserId) {
  if (!story?.sealed) return true;
  const uid = String(currentUserId?.id || currentUserId || '');
  return (story.envelopes || []).some((e) => envelopeUserId(e) === uid);
}

const StoriesRail = forwardRef(function StoriesRail({ currentUser, users = [], onError, notifSettings }, ref) {
  const { keyringInSync, keyringNeedsResync, refreshUserFromServer, verifyKeySync } = useAuth();
  const [stories, setStories] = useState([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [viewer, setViewer] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const inputRef = useRef(null);

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
    setStoriesLoading(true);
    try {
      const { data } = await client.get('/stories');
      setStories(data.data || []);
    } catch {
      setStories([]);
    } finally {
      setStoriesLoading(false);
    }
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
      const isOwn = String(payload.user?.id) === String(currentUser?.id);
      setStories((prev) => {
        if (prev.some((s) => String(s.id) === String(payload.id))) return prev;
        return [payload, ...prev];
      });

      if (!isOwn) {
        const mode = notifSettings?.statusNotifications;
        // 'favorites_only' has no dedicated favorites list yet — approximated as friends-only.
        const isFriend = (currentUser?.friends || []).map(String).includes(String(payload.user?.id));
        const allowed = mode !== 'off' && (mode !== 'favorites_only' || isFriend);
        if (allowed && shouldNotify(notifSettings, { kind: 'status' })) {
          playNotificationSound(notifSettings);
          showNotificationPopup(
            { title: payload.user?.username || 'Someone', body: 'Posted a new story' },
            notifSettings,
            () => {},
          );
        }
      }
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

      // Make sure our local keyring is actually in sync with the server before
      // sealing anything to it — this is the fix for stories being undecryptable.
      if (keyringNeedsResync || !keyringInSync) {
        await verifyKeySync().catch(() => refreshUserFromServer().catch(() => null));
      }
      const ownerUser = getStoredUser() || currentUser;
      const sync = getKeyringSyncStatus(ownerUser.id, ownerUser.publicKeys || []);
      if (sync.status !== 'synced') {
        onError?.(
          'Encryption keys are out of sync with the server. Use Settings → Regenerate & resync keys before posting stories.'
        );
        return false;
      }

      let durationMs = 0;
      if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        durationMs = await probeMediaDuration(file);
        if (durationMs > MAX_STORY_SECONDS * 1000) {
          onError?.(`Stories must be ${MAX_STORY_SECONDS} seconds or shorter`);
          return false;
        }
      }

      const form = new FormData();
      const canSeal = typeof crypto !== 'undefined' && crypto.subtle;

      if (canSeal) {
        const sealed = await aesGcmEncryptBlob(file);

        // Seal the author envelope to keys this device actually holds (same
        // pattern as chat forSender), not a possibly stale session publicKeys list.
        const ownerKeySet = getCurrentKeySet(ownerUser.id, KEY_SET_SIZE);
        const ownerPublicKeys = ownerKeySet.map((k) => k.publicKey).filter(Boolean);
        if (ownerPublicKeys.length !== KEY_SET_SIZE) {
          throw new Error('Your local keyring is incomplete — import keys.txt or regenerate keys');
        }
        for (const pk of ownerPublicKeys) {
          if (!findSecretKeyForPublicKey(ownerUser.id, pk)) {
            throw new Error('Local keyring is incomplete — re-import your keys.txt');
          }
        }

        const audienceMap = new Map();
        audienceMap.set(String(ownerUser.id), {
          id: String(ownerUser.id),
          username: ownerUser.username,
          publicKeys: ownerPublicKeys,
        });
        for (const u of users) {
          if (!u?.id || !u.publicKeys?.length) continue;
          if (String(u.id) === String(ownerUser.id)) continue;
          audienceMap.set(String(u.id), {
            id: String(u.id),
            username: u.username,
            publicKeys: u.publicKeys,
          });
        }
        const audience = [...audienceMap.values()];
        if (!audience[0].publicKeys?.length) {
          throw new Error('Your account is missing X5 public keys');
        }

        const serverKeys = new Set((ownerUser.publicKeys || []).map((k) => k.toLowerCase()));
        const localKeys = new Set(ownerPublicKeys.map((k) => k.toLowerCase()));
        const keysMatchServer = ownerPublicKeys.every((k) => serverKeys.has(k.toLowerCase()));
        if (!keysMatchServer || serverKeys.size !== localKeys.size) {
          throw new Error(
            'Local encryption keys do not match the server — regenerate & resync keys before posting stories'
          );
        }

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
      return true;
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to upload story');
      return false;
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
    if (!file || uploading) return;
    const ok = await uploadStory(file, ttlMs);
    if (ok) closeComposer();
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
        className={`story-ring add${uploading ? ' uploading' : ''}`}
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
        <span className="story-add-badge">{uploading ? '…' : '+'}</span>
        <span className="story-ring-label">{uploading ? 'Uploading…' : 'Your story'}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        hidden
        onChange={handleFileSelected}
      />

      {storiesLoading &&
        [1, 2, 3].map((i) => (
          <div key={i} className="story-ring story-ring-skeleton" aria-hidden="true">
            <div className="skeleton skeleton-avatar story-skeleton-avatar" />
            <span className="skeleton skeleton-line story-skeleton-label" />
          </div>
        ))}

      {!storiesLoading &&
        grouped
          .filter((g) => String(g.user?.id) !== String(currentUser?.id) || g.items.length > 0)
          .map((g) => {
            const hasSealed = g.items.some((s) => s.sealed);
            return (
              <button
                key={String(g.user?.id)}
                type="button"
                className={`story-ring${hasSealed ? ' sealed' : ''}`}
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
                {hasSealed ? <span className="story-ring-sealed-dot" title="Sealed story" aria-label="Sealed" /> : null}
                <span className="story-ring-label">{g.user?.username}</span>
              </button>
            );
          })}

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
            <p className="story-unavailable-title">Story unavailable</p>
            <p>This story expired or was deleted.</p>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
        const ivB64 = unlocked.ok ? unlocked.payload?.ivB64 : story.contentIv;
        if (!unlocked.ok || !unlocked.payload?.keyB64 || !ivB64) {
          if (unlocked.reason === 'no-envelope') {
            setBlockedReason('Sealed story — no envelope for your account');
          } else if (unlocked.reason === 'no-secret') {
            setBlockedReason(
              'Sealed story — your local keyring is missing the secret for this story (keys may be out of sync; try Regenerate & resync keys)'
            );
          } else {
            setBlockedReason('Sealed story — could not decrypt with your keys');
          }
          return;
        }
        const res = await client.get(`/stories/${story.id}/media`, {
          responseType: 'arraybuffer',
        });
        const cipherBytes = new Uint8Array(res.data);
        const plain = await aesGcmDecryptBytes(cipherBytes, unlocked.payload.keyB64, ivB64);
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
            setBlockedReason('Sealed story — decryption failed');
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
      if (confirmDelete) return;
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
  }, [group.items.length, onClose, confirmDelete]);

  async function handleDelete() {
    setConfirmDelete(true);
  }

  async function confirmDeleteStory() {
    if (deleting) return;
    try {
      setDeleting(true);
      await client.delete(`/stories/${story.id}`);
      setConfirmDelete(false);
      onDeleted?.();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to delete story');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
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
          {blockedReason && (
            <div className="story-decrypt-error" role="alert">
              <p className="story-decrypt-error-title">Can’t open this story</p>
              <p>{blockedReason}</p>
            </div>
          )}
          {!blockedReason && !mediaUrl && (
            <div className="story-media-loading" aria-live="polite">
              <div className="skeleton skeleton-line story-media-loading-bar" />
              <p className="empty-hint">Decrypting…</p>
            </div>
          )}
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

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this story?"
        message="This story will be removed for everyone who can see it. This can’t be undone."
        confirmLabel="Delete story"
        cancelLabel="Keep story"
        danger
        busy={deleting}
        onCancel={() => {
          if (!deleting) setConfirmDelete(false);
        }}
        onConfirm={confirmDeleteStory}
      />
    </div>
  );
}

function StoryComposer({ file, previewUrl, onCancel, onConfirm, uploading }) {
  const [preset, setPreset] = useState(DEFAULT_TTL_MS);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState(24);
  const [customUnit, setCustomUnit] = useState('hours');
  const imagePreviewRef = useRef(null);
  const videoPreviewRef = useRef(null);
  const audioPreviewRef = useRef(null);

  const unitMultiplier = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };

  useEffect(() => {
    let safePreviewUrl = '';
    try {
      const parsed = new URL(previewUrl);
      if (parsed.protocol === 'blob:') safePreviewUrl = parsed.href;
    } catch {
      // Leave media sources unset for malformed preview URLs.
    }

    const previewElements = [
      imagePreviewRef.current,
      videoPreviewRef.current,
      audioPreviewRef.current,
    ].filter(Boolean);

    for (const element of previewElements) {
      if (safePreviewUrl) element.src = safePreviewUrl;
      else element.removeAttribute('src');
    }

    return () => {
      for (const element of previewElements) element.removeAttribute('src');
    };
  }, [previewUrl]);

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
          {file.type.startsWith('image/') && <img ref={imagePreviewRef} alt="" />}
          {file.type.startsWith('video/') && <video ref={videoPreviewRef} controls />}
          {file.type.startsWith('audio/') && <audio ref={audioPreviewRef} controls />}
        </div>

        <div className="story-composer-ttl">
          <p className="story-composer-ttl-label">Visible for</p>
          <div className="story-composer-ttl-presets" role="group" aria-label="Story duration">
            {TTL_PRESETS.map((p) => (
              <button
                key={p.ms}
                type="button"
                className={`story-ttl-preset ${!customMode && preset === p.ms ? 'active' : ''}`}
                disabled={uploading}
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
              disabled={uploading}
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
                disabled={uploading}
                onChange={(e) => setCustomValue(e.target.value)}
                aria-label="Custom duration value"
              />
              <select
                value={customUnit}
                disabled={uploading}
                onChange={(e) => setCustomUnit(e.target.value)}
                aria-label="Custom duration unit"
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
          )}
          <p className="story-composer-ttl-hint">
            Min 15 minutes · max 7 days. Media is sealed before upload.
          </p>
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
            {uploading ? 'Encrypting & posting…' : 'Post story'}
          </button>
        </div>
      </div>
    </div>
  );
}