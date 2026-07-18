import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Clock, Lock, Sparkles, X } from 'lucide-react';
import client from '../api/client.js';
import UserAvatar from './UserAvatar.jsx';

function formatPresence(profile, online) {
  if (!profile) return null;
  const onlineAllowed = (profile.privacy?.online || 'everyone') !== 'nobody';
  if (onlineAllowed && online) return { label: 'Online', online: true };

  if ((profile.privacy?.lastSeen || 'everyone') === 'nobody') {
    return { label: 'Last seen hidden', online: false };
  }
  if (!profile.lastLoginAt) return { label: 'Never logged in', online: false };
  return {
    label: `Last seen ${new Date(profile.lastLoginAt).toLocaleString()}`,
    online: false,
  };
}

function formatKeyRotated(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

export default function UserProfileModal({
  userId,
  seed = null,
  online = false,
  onClose,
  onLoaded,
}) {
  const closeRef = useRef(null);
  const [profile, setProfile] = useState(seed);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose?.();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    if (seed && String(seed.id) === String(userId)) {
      setProfile(seed);
    }

    client
      .get(`/users/${userId}`)
      .then((res) => {
        if (cancelled) return;
        const data = res.data?.data || null;
        setProfile(data);
        onLoaded?.(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.error || 'Could not load profile');
        if (!seed) setProfile(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps -- seed/onLoaded are open-time props

  const displayName = profile?.displayName?.trim() || profile?.username || 'User';
  const username = profile?.username || '';
  const bio = (profile?.bio || '').trim();
  const presence = formatPresence(profile, online);
  const keyRotated = formatKeyRotated(profile?.keyRotatedAt);
  const isAi = profile?.systemRole === 'quantum_ai' || profile?.isSystemUser;

  return (
    <div className="create-group-overlay" role="presentation" onClick={() => onClose?.()}>
      <div
        className="user-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-profile-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          className="create-group-close user-profile-close"
          onClick={onClose}
          aria-label="Close profile"
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>

        <div className="user-profile-hero">
          <div className="user-profile-avatar-wrap">
            {loading && !profile ? (
              <span className="avatar user-avatar xl user-profile-avatar-skeleton" aria-hidden="true" />
            ) : (
              <UserAvatar
                userId={profile?.id || userId}
                name={displayName}
                hasAvatar={Boolean(profile?.hasAvatar)}
                size="xl"
                className="user-profile-avatar"
              />
            )}
            {presence?.online && <span className="online-dot user-profile-online-dot" aria-hidden="true" />}
          </div>

          <div className="user-profile-names">
            <h2 id="user-profile-title" className="user-profile-name">
              <span>{displayName}</span>
              {profile?.verified && (
                <span className="user-profile-verified" title="Verified">
                  <BadgeCheck size={18} strokeWidth={2.25} aria-hidden="true" />
                  <span className="sr-only">Verified</span>
                </span>
              )}
            </h2>
            {username ? <p className="user-profile-handle">@{username}</p> : null}
            {isAi ? (
              <span className="user-profile-chip user-profile-chip-ai">
                <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
                QuantumAI
              </span>
            ) : null}
          </div>

          {presence && !loading && (
            <p className={`user-profile-presence ${presence.online ? 'is-online' : ''}`}>
              <span className="user-profile-presence-dot" aria-hidden="true" />
              {presence.label}
            </p>
          )}
        </div>

        {error && <p className="user-profile-error">{error}</p>}

        {loading && !profile ? (
          <div className="user-profile-loading" aria-busy="true">
            Loading profile…
          </div>
        ) : (
          <div className="user-profile-body">
            <section className="user-profile-section">
              <h3 className="user-profile-section-title">About</h3>
              {bio ? (
                <p className="user-profile-bio">{bio}</p>
              ) : (
                <p className="user-profile-empty">No bio yet</p>
              )}
            </section>

            <section className="user-profile-section">
              <h3 className="user-profile-section-title">Details</h3>
              <ul className="user-profile-meta">
                <li className="user-profile-meta-row">
                  <span className="user-profile-meta-icon" aria-hidden="true">
                    <Clock size={16} strokeWidth={2} />
                  </span>
                  <span className="user-profile-meta-copy">
                    <strong>Activity</strong>
                    <span>{presence?.label || 'Hidden'}</span>
                  </span>
                </li>
                <li className="user-profile-meta-row">
                  <span className="user-profile-meta-icon" aria-hidden="true">
                    <Lock size={16} strokeWidth={2} />
                  </span>
                  <span className="user-profile-meta-copy">
                    <strong>Messages</strong>
                    <span>
                      End-to-end encrypted
                      {keyRotated ? ` · keys updated ${keyRotated}` : ''}
                    </span>
                  </span>
                </li>
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
