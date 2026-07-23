import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Copy, Link2, Shield, Trash2, UserMinus, UserPlus, X } from 'lucide-react';
import client from '../api/client.js';
import { getToken } from '../crypto/keyStorage.js';
import { isGroupAdmin } from '../utils/groupPayload.js';
import useFocusTrap from '../hooks/useFocusTrap.js';


const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function GroupSettingsModal({
  group,
  currentUserId,
  users = [],
  onClose,
  onUpdated,
  onLeftOrDeleted,
}) {
  const [tab, setTab] = useState('info');
  const [name, setName] = useState(group?.name || '');
  const [description, setDescription] = useState(group?.description || '');
  const [onlyAdminsCanPost, setOnlyAdminsCanPost] = useState(Boolean(group?.onlyAdminsCanPost));
  const [onlyAdminsCanAddMembers, setOnlyAdminsCanAddMembers] = useState(
    group?.onlyAdminsCanAddMembers !== false
  );
  const [quantumAIEnabled, setQuantumAIEnabled] = useState(Boolean(group?.quantumAI?.enabled));
  const [quantumAIPolicy, setQuantumAIPolicy] = useState(group?.quantumAI?.invocationPolicy || 'members');
  const [quantumAIContext, setQuantumAIContext] = useState(group?.quantumAI?.maxContextMessages ?? 5);
  const [quantumAIDailyLimit, setQuantumAIDailyLimit] = useState(group?.quantumAI?.dailyLimit ?? 50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [addSearch, setAddSearch] = useState('');
  const [selectedAdd, setSelectedAdd] = useState(() => new Set());
  const [gallery, setGallery] = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const photoRef = useRef(null);
  const containerRef = useRef(null);

  useFocusTrap(containerRef, true);


  const admin = isGroupAdmin(group, currentUserId);
  const isOwner = String(group?.createdBy) === String(currentUserId);
  const memberIds = useMemo(() => new Set((group?.members || []).map((m) => String(m.id || m._id))), [group]);
  const adminIds = useMemo(() => new Set((group?.admins || []).map(String)), [group]);

  const candidates = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    return users.filter((u) => {
      const id = String(u.id);
      if (memberIds.has(id)) return false;
      if (!q) return true;
      return (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
    });
  }, [users, memberIds, addSearch]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, busy]);

  useEffect(() => {
    if (tab !== 'media' || !group?.id) return;
    let cancelled = false;
    setGalleryLoading(true);
    client
      .get(`/groups/${group.id}/messages`, { params: { limit: 200 } })
      .then((res) => {
        if (cancelled) return;
        const items = (res.data.data || [])
          .filter((m) => m.kind === 'file' || m.attachment)
          .map((m) => ({
            id: m.id || m._id,
            kind: m.kind,
            attachment: m.attachment,
            from: m.from,
            createdAt: m.createdAt,
          }));
        setGallery(items);
      })
      .catch(() => setGallery([]))
      .finally(() => {
        if (!cancelled) setGalleryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, group?.id]);

  async function refreshAndClosePayload(payload) {
    onUpdated?.(payload);
  }

  async function saveInfo() {
    setBusy(true);
    setError('');
    try {
      const { data } = await client.patch(`/groups/${group.id}`, {
        name: name.trim(),
        description: description.trim(),
        onlyAdminsCanPost,
        onlyAdminsCanAddMembers,
        quantumAI: {
          enabled: quantumAIEnabled,
          invocationPolicy: quantumAIPolicy,
          maxContextMessages: Number(quantumAIContext),
          dailyLimit: Number(quantumAIDailyLimit),
        },
      });
      await refreshAndClosePayload(data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('photo', file);
      const { data } = await client.post(`/groups/${group.id}/photo`, form);
      await refreshAndClosePayload(data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload photo');
    } finally {
      setBusy(false);
    }
  }

  async function addSelectedMembers() {
    if (!selectedAdd.size) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await client.post(`/groups/${group.id}/members`, {
        memberIds: [...selectedAdd],
      });
      setSelectedAdd(new Set());
      await refreshAndClosePayload(data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add members');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(memberId) {
    setBusy(true);
    setError('');
    try {
      const { data } = await client.delete(`/groups/${group.id}/members/${memberId}`);
      if (data.data?.deleted || String(memberId) === String(currentUserId)) {
        onLeftOrDeleted?.(group.id);
        onClose?.();
        return;
      }
      await refreshAndClosePayload(data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove member');
    } finally {
      setBusy(false);
    }
  }

  async function toggleAdmin(memberId, makeAdmin) {
    setBusy(true);
    setError('');
    try {
      const { data } = makeAdmin
        ? await client.post(`/groups/${group.id}/admins/${memberId}`)
        : await client.delete(`/groups/${group.id}/admins/${memberId}`);
      await refreshAndClosePayload(data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update admin');
    } finally {
      setBusy(false);
    }
  }

  async function setInvite({ enabled, rotate }) {
    setBusy(true);
    setError('');
    try {
      const { data } = await client.post(`/groups/${group.id}/invite`, { enabled, rotate });
      await refreshAndClosePayload(data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update invite link');
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup() {
    if (!window.confirm(`Delete “${group.name}” for everyone? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await client.delete(`/groups/${group.id}`);
      onLeftOrDeleted?.(group.id);
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete group');
      setBusy(false);
    }
  }

  const inviteUrl =
    group?.inviteEnabled && group?.inviteCode
      ? `${window.location.origin}/join/${group.inviteCode}`
      : '';

  const photoUrl = group?.hasPhoto
    ? `${API}/api/groups/${group.id}/photo?token=${encodeURIComponent(getToken() || '')}`
    : null;

  // Auth header photo fetch won't work via img src with query token unless backend supports it.
  // Prefer blob URL fetched with client.
  const [photoBlob, setPhotoBlob] = useState(null);
  useEffect(() => {
    let revoked;
    if (!group?.hasPhoto) {
      setPhotoBlob(null);
      return undefined;
    }
    client
      .get(`/groups/${group.id}/photo`, { responseType: 'blob' })
      .then((res) => {
        const url = URL.createObjectURL(res.data);
        revoked = url;
        setPhotoBlob(url);
      })
      .catch(() => setPhotoBlob(null));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [group?.id, group?.hasPhoto, group?.updatedAt]);

  return (
    <div className="create-group-overlay" role="presentation" onClick={() => !busy && onClose?.()}>
      <div
        className="create-group-modal group-settings-modal"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="create-group-modal-header">
          <div className="create-group-modal-heading">
            <h2 id="group-settings-title">Group settings</h2>
            <p>{group?.name}</p>
          </div>
          <button type="button" className="create-group-close" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="group-settings-tabs">
          {[
            ['info', 'Info'],
            ['members', 'Members'],
            ['invite', 'Invite'],
            ['media', 'Files'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`group-settings-tab ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <p className="create-group-error">{error}</p>}

        {tab === 'info' && (
          <div className="group-settings-section">
            <div className="group-photo-row">
              <div className="group-photo-preview">
                {photoBlob ? <img src={photoBlob} alt="" /> : <span>{(group?.name || '?').slice(0, 2).toUpperCase()}</span>}
              </div>
              {admin && (
                <>
                  <button type="button" className="btn-secondary" onClick={() => photoRef.current?.click()} disabled={busy}>
                    <Camera size={16} /> Change photo
                  </button>
                  <input ref={photoRef} type="file" accept="image/*" hidden onChange={handlePhoto} />
                </>
              )}
            </div>

            <label className="create-group-label">Name</label>
            <input
              className="create-group-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!admin || busy}
              maxLength={60}
            />

            <label className="create-group-label">Description</label>
            <textarea
              className="create-group-input group-desc-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!admin || busy}
              maxLength={500}
              rows={3}
              placeholder="What is this group about?"
            />

            {admin && (
              <div className="group-settings-toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={onlyAdminsCanPost}
                    onChange={(e) => setOnlyAdminsCanPost(e.target.checked)}
                    disabled={busy}
                  />
                  Only admins can post
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={onlyAdminsCanAddMembers}
                    onChange={(e) => setOnlyAdminsCanAddMembers(e.target.checked)}
                    disabled={busy}
                  />
                  Only admins can add members
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={quantumAIEnabled}
                    onChange={(e) => setQuantumAIEnabled(e.target.checked)}
                    disabled={busy}
                  />
                  Enable @QuantumAI (add QuantumAI as a member first)
                </label>
                <label>
                  Who can invoke QuantumAI
                  <select value={quantumAIPolicy} onChange={(e) => setQuantumAIPolicy(e.target.value)} disabled={busy}>
                    <option value="members">All members</option>
                    <option value="admins">Admins only</option>
                  </select>
                </label>
                <label>
                  Context messages shared after confirmation
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={quantumAIContext}
                    onChange={(e) => setQuantumAIContext(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label>
                  Daily QuantumAI request limit
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={quantumAIDailyLimit}
                    onChange={(e) => setQuantumAIDailyLimit(e.target.value)}
                    disabled={busy}
                  />
                </label>
              </div>
            )}

            {admin && (
              <button type="button" className="confirm-btn" onClick={saveInfo} disabled={busy || name.trim().length < 2}>
                Save changes
              </button>
            )}

            <div className="group-danger-zone">
              <button type="button" className="btn-danger-outline" onClick={() => removeMember(currentUserId)} disabled={busy}>
                Leave group
              </button>
              {isOwner && (
                <button type="button" className="btn-danger" onClick={deleteGroup} disabled={busy}>
                  <Trash2 size={14} /> Delete group
                </button>
              )}
            </div>
          </div>
        )}

        {tab === 'members' && (
          <div className="group-settings-section">
            <ul className="group-member-list">
              {(group?.members || []).map((m) => {
                const id = String(m.id || m._id);
                const isAdm = adminIds.has(id);
                const isCreator = String(group.createdBy) === id;
                return (
                  <li key={id}>
                    <div>
                      <strong>{m.username || 'Member'}</strong>
                      <span className="group-member-meta">
                        {isCreator ? 'Owner' : isAdm ? 'Admin' : 'Member'}
                        {id === String(currentUserId) ? ' · you' : ''}
                      </span>
                    </div>
                    <div className="group-member-actions">
                      {admin && !isCreator && id !== String(currentUserId) && (
                        <>
                          {isAdm && isOwner ? (
                            <button type="button" onClick={() => toggleAdmin(id, false)} disabled={busy} title="Demote">
                              <Shield size={14} />
                            </button>
                          ) : !isAdm ? (
                            <button type="button" onClick={() => toggleAdmin(id, true)} disabled={busy} title="Make admin">
                              <UserPlus size={14} />
                            </button>
                          ) : null}
                          <button type="button" onClick={() => removeMember(id)} disabled={busy} title="Remove">
                            <UserMinus size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {(admin || group?.onlyAdminsCanAddMembers === false) && (
              <>
                <label className="create-group-label">Add members</label>
                <input
                  className="create-group-input"
                  placeholder="Search users…"
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                />
                <div className="create-group-user-list" style={{ maxHeight: 160 }}>
                  {candidates.slice(0, 40).map((u) => {
                    const id = String(u.id);
                    const checked = selectedAdd.has(id);
                    return (
                      <label key={id} className="create-group-user-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedAdd((prev) => {
                              const next = new Set(prev);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            })
                          }
                        />
                        <span>{u.username}</span>
                      </label>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="confirm-btn"
                  disabled={!selectedAdd.size || busy}
                  onClick={addSelectedMembers}
                >
                  Add selected
                </button>
              </>
            )}
          </div>
        )}

        {tab === 'invite' && (
          <div className="group-settings-section">
            {!admin ? (
              <p className="muted">Only admins can manage invite links.</p>
            ) : (
              <>
                <p className="muted">Anyone with the link can join. New members only decrypt future messages.</p>
                {inviteUrl ? (
                  <div className="group-invite-box">
                    <code>{inviteUrl}</code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(inviteUrl);
                      }}
                      aria-label="Copy invite link"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                ) : (
                  <p className="muted">Invite link is off.</p>
                )}
                <div className="group-invite-actions">
                  {!group?.inviteEnabled ? (
                    <button type="button" className="confirm-btn" disabled={busy} onClick={() => setInvite({ enabled: true })}>
                      <Link2 size={14} /> Enable invite link
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn-secondary" disabled={busy} onClick={() => setInvite({ enabled: true, rotate: true })}>
                        Rotate link
                      </button>
                      <button type="button" className="btn-danger-outline" disabled={busy} onClick={() => setInvite({ enabled: false })}>
                        Disable link
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'media' && (
          <div className="group-settings-section">
            <p className="muted">Shared encrypted files in this group (decrypt in chat to open).</p>
            {galleryLoading ? (
              <p className="muted">Loading…</p>
            ) : gallery.length === 0 ? (
              <p className="muted">No shared files yet.</p>
            ) : (
              <ul className="group-shared-files">
                {gallery.map((item) => (
                  <li key={item.id}>
                    <span>{item.attachment?.filename || 'Encrypted file'}</span>
                    <span className="group-member-meta">
                      {item.attachment?.mimetype || item.kind} · {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
