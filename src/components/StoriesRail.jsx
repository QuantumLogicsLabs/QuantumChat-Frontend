import { useEffect, useMemo, useRef, useState } from 'react';
import client from '../api/client.js';
import { getToken, findSecretKeyForPublicKey } from '../crypto/keyStorage.js';
import { getSocket } from '../api/socket.js';
import { sealMessage, unsealMessage, pickRandom } from '../crypto/keys.js';
import UserAvatar from './UserAvatar.jsx';

const MAX_STORY_SECONDS = 60;
const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

function bytesToBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
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

function buildStoryEnvelopes(audience, keyB64, ivB64) {
  const secretPayload = JSON.stringify({ keyB64, ivB64 });
  return audience.map((u) => {
    const keys = (u.publicKeys || []).filter(Boolean);
    if (!keys.length) throw new Error(`Missing X5 keys for ${u.username || u.id}`);
    const sealed = sealMessage(secretPayload, pickRandom(keys));
    return { user: u.id, ...sealed };
  });
}

function unlockStoryKey(story, currentUserId) {
  const envelopes = story.envelopes || [];
  const mine = envelopes.find((e) => String(e.user) === String(currentUserId));
  if (!mine?.targetPublicKey) return null;
  const secret = findSecretKeyForPublicKey(currentUserId, mine.targetPublicKey);
  if (!secret) return null;
  const text = unsealMessage(mine, secret);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default function StoriesRail({ currentUser, users = [], onError }) {
  const [stories, setStories] = useState([]);
  const [viewer, setViewer] = useState(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const story of stories) {
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
  }, []);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
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
        const audienceMap = new Map();
        audienceMap.set(String(currentUser.id), {
          id: currentUser.id,
          username: currentUser.username,
          publicKeys: currentUser.publicKeys || [],
        });
        for (const u of users) {
          if (!u?.id || !u.publicKeys?.length) continue;
          audienceMap.set(String(u.id), {
            id: u.id,
            username: u.username,
            publicKeys: u.publicKeys,
          });
        }
        const audience = [...audienceMap.values()];
        if (!audience[0].publicKeys?.length) {
          throw new Error('Your account is missing X5 public keys');
        }
        const envelopes = buildStoryEnvelopes(audience, sealed.keyB64, sealed.ivB64);

        form.append(
          'file',
          new Blob([sealed.cipherBytes], {
            type: file.type || 'application/octet-stream',
          }),
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

      await client.post('/stories', form);
      await loadStories();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to upload story');
    } finally {
      setUploading(false);
    }
  }

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
        onChange={handleFile}
      />

      {grouped
        .filter((g) => String(g.user?.id) !== String(currentUser?.id) || g.items.length > 0)
        .map((g) => (
          <button
            key={String(g.user?.id)}
            type="button"
            className="story-ring"
            onClick={() => setViewer({ group: g, index: 0 })}
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
          onClose={() => setViewer(null)}
          onDeleted={async () => {
            setViewer(null);
            await loadStories();
          }}
        />
      )}
    </div>
  );
}

function StoryViewer({ group, startIndex, currentUserId, onClose, onDeleted }) {
  const [index, setIndex] = useState(startIndex || 0);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [sealedBlocked, setSealedBlocked] = useState(false);
  const story = group.items[index];
  const isOwn = String(group.user?.id) === String(currentUserId);

  useEffect(() => {
    let cancelled = false;
    let objectUrl;
    setMediaUrl(null);
    setSealedBlocked(false);

    (async () => {
      if (story.sealed) {
        const unlocked = unlockStoryKey(story, currentUserId);
        const ivB64 = unlocked?.ivB64 || story.contentIv;
        if (!unlocked?.keyB64 || !ivB64) {
          setSealedBlocked(true);
          return;
        }
        const token = getToken();
        const res = await fetch(`${API_BASE}/stories/${story.id}/media`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          setSealedBlocked(true);
          return;
        }
        const cipherBytes = new Uint8Array(await res.arrayBuffer());
        const plain = await aesGcmDecryptBytes(cipherBytes, unlocked.keyB64, ivB64);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(
          new Blob([plain], { type: story.mimetype || 'application/octet-stream' })
        );
        setMediaUrl(objectUrl);
        return;
      }

      const token = getToken();
      const res = await fetch(`${API_BASE}/stories/${story.id}/media`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to load story media');
      const blob = await res.blob();
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setMediaUrl(objectUrl);
    })().catch(() => {
      if (!cancelled) {
        setMediaUrl(null);
        if (story.sealed) setSealedBlocked(true);
      }
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [story, currentUserId]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
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
        <div className="story-viewer-media">
          {sealedBlocked && <p className="empty-hint">Sealed story — no envelope for your keys</p>}
          {!sealedBlocked && !mediaUrl && <p className="empty-hint">Loading…</p>}
          {mediaUrl && story.mediaType === 'image' && <img src={mediaUrl} alt="" />}
          {mediaUrl && story.mediaType === 'video' && <video src={mediaUrl} autoPlay controls />}
          {mediaUrl && story.mediaType === 'audio' && <audio src={mediaUrl} autoPlay controls />}
        </div>
        {story.caption && <p className="story-caption">{story.caption}</p>}
        <div className="story-viewer-actions">
          {isOwn && (
            <button type="button" onClick={handleDelete}>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
