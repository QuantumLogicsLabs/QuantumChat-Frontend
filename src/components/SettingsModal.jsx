import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import client, { unmuteChat, updatePrivacySettings } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useNotificationSettings } from '../context/NotificationSettingsContext.jsx';
import { APP_ICONS, FUN_THEMES, useTheme } from '../context/ThemeContext.jsx';
import { getCurrentKeySet, getSessionId } from '../crypto/keyStorage.js';
import { decryptVaultPayload, encryptVaultPayload } from '../crypto/keyVault.js';
import { SUPPORTED_LANGUAGES, setAppLanguage } from '../i18n/index.js';
import ThemeSwitcher, { FunThemeSwitcher } from './ThemeSwitcher.jsx';
import PrivacySelect from './ui/PrivacySelect.jsx';
import UserAvatar, { bustAvatarCache } from './UserAvatar.jsx';
import DeviceLinkRequestModal from './DeviceLinkRequestModal.jsx';
import DeviceLinkSetupModal from './DeviceLinkSetupModal.jsx';
import {
  approveDeviceLink,
  buildQrPayload,
  createDeviceLinkRequest,
  listDeviceSessions as listLinkedDeviceSessions,
  rejectDeviceLink,
  revokeDeviceSession as revokeDeviceSessionApi,
  sendDeviceLinkEmail as sendDeviceLinkEmailApi,
  verifyDeviceLink,
} from '../api/deviceLink.js';
import { getSocket, connectSocket } from '../api/socket.js';
import QRCode from 'qrcode';
import {
  disablePushNotifications,
  enablePushNotifications,
  getNotificationPermission,
} from '../utils/pushNotifications.js';
import { unlockAudio, playReceiveSound } from '../utils/sounds.js';
import { detectBrowserTimezone, getTimezoneList } from '../utils/timezones.js';

function parseMutedKey(key, myId) {
  if (!key) return null;
  if (key.startsWith('group:')) {
    return { type: 'group', id: key.slice('group:'.length) };
  }
  if (key.startsWith('dm:')) {
    const [a, b] = key.slice('dm:'.length).split(':');
    const otherId = String(a) === String(myId) ? b : a;
    return { type: 'dm', id: otherId };
  }
  return null;
}

function formatMuteExpiry(expiresAt) {
  if (!expiresAt) return 'Muted forever';
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return 'Muted forever';
  return `Muted until ${date.toLocaleString()}`;
}

function ToggleRow({ label, hint, checked, onChange, disabled }) {
  return (
    <button type="button" className="settings-row" onClick={() => !disabled && onChange?.(!checked)} disabled={disabled}>
      <span className="settings-row-left">
        <span className="settings-row-label">{label}</span>
        {hint ? <span className="settings-row-hint">{hint}</span> : null}
      </span>
      <span className={`menu-switch ${checked ? 'on' : ''}`} aria-hidden="true">
        <span className="menu-switch-knob" />
      </span>
    </button>
  );
}

const TABS = [
  ['profile', 'Profile'],
  ['privacy', 'Privacy'],
  ['notifications', 'Notifications'],
  ['security', 'Security'],
  ['blocked', 'Blocked'],
  ['data', 'Data'],
];

const THEME_LABELS = {
  light: 'Light',
  dark: 'Dark',
  eyecare: 'Eyecare',
  moonveil: 'Moonveil',
  sakura: 'Sakura',
  sunset: 'Sunset Ember',
  aurora: 'Aurora',
  ocean: 'Bioluminescent',
  nebula: 'Nebula',
  dreamcloud: 'Dreamcloud',
};

export default function SettingsModal({
  user,
  onClose,
  onImportKeys,
  onGenerateKeys,
  onUserUpdated,
  onLogout,
  onExportChat,
  initialTab = 'profile',
  className = '',
}) {
  const { t, i18n } = useTranslation();
  const { theme, appIcon, setAppIcon } = useTheme();
  const { importKeys, keyringSync, keyringNeedsResync, verifyKeySync } = useAuth();
  const { settings: notifSettings, updateSettings: updateNotifSettings } = useNotificationSettings();
  const closeRef = useRef(null);
  const keyInputRef = useRef(null);
  const avatarInputRef = useRef(null);
  const [tab, setTab] = useState(initialTab);
  const [activeLang, setActiveLang] = useState(() => user?.preferredLanguage || i18n.language || 'en');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermission());

  async function handleLanguageChange(langCode) {
    setActiveLang(langCode);
    setAppLanguage(langCode);
    try {
      await client.patch('/users/me/language', { language: langCode });
      onUserUpdated?.({ ...user, preferredLanguage: langCode });
    } catch (err) {
      console.warn('Failed to persist preferred language to backend:', err);
    }
  }

  const [username, setUsername] = useState(user?.username || '');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [statusText, setStatusText] = useState(user?.statusText || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [dateOfBirth, setDateOfBirth] = useState(
    user?.dateOfBirth ? String(user.dateOfBirth).slice(0, 10) : '',
  );
  const [timezone, setTimezone] = useState(user?.timezone || detectBrowserTimezone());
  const timezoneOptions = useState(getTimezoneList)[0];
  const [transliteratedNames, setTransliteratedNames] = useState(() => ({
    ur: user?.transliteratedNames?.ur || '',
    ar: user?.transliteratedNames?.ar || '',
    fa: user?.transliteratedNames?.fa || '',
    hi: user?.transliteratedNames?.hi || '',
    zh: user?.transliteratedNames?.zh || '',
    ru: user?.transliteratedNames?.ru || '',
  }));

  useEffect(() => {
    if (user?.transliteratedNames) {
      setTransliteratedNames({
        ur: user.transliteratedNames.ur || '',
        ar: user.transliteratedNames.ar || '',
        fa: user.transliteratedNames.fa || '',
        hi: user.transliteratedNames.hi || '',
        zh: user.transliteratedNames.zh || '',
        ru: user.transliteratedNames.ru || '',
      });
    }
  }, [user]);
  const [privacy, setPrivacy] = useState({
    lastSeen: user?.privacy?.lastSeen || 'everyone',
    readReceipts: typeof user?.privacy?.readReceipts === 'boolean'
      ? (user.privacy.readReceipts ? 'everyone' : 'nobody')
      : (user?.privacy?.readReceipts || 'everyone'),
    typingIndicator: user?.privacy?.typingIndicator !== false,
    onlineStatus: user?.privacy?.onlineStatus || (user?.privacy?.online === 'nobody' ? 'selected' : (user?.privacy?.online || 'everyone')),
    onlineStatusVisibleTo: Array.isArray(user?.privacy?.onlineStatusVisibleTo)
      ? user.privacy.onlineStatusVisibleTo.map((id) => String(id._id || id))
      : [],
    whoCanMessage: user?.privacy?.whoCanMessage || 'everyone',
    discoverable: user?.privacy?.discoverable || 'everyone',
    story: user?.privacy?.story || 'everyone',
    storyViewers: Array.isArray(user?.privacy?.storyViewers)
      ? user.privacy.storyViewers.map((id) => String(id._id || id))
      : [],
    profileVisibility: user?.privacy?.profileVisibility || 'everyone',
    birthdayVisibility: user?.privacy?.birthdayVisibility || 'everyone',
    whoCanMention: user?.privacy?.whoCanMention || 'everyone',
    whoCanAddToGroups: user?.privacy?.whoCanAddToGroups || 'everyone',
    whoCanInviteViaGroupLink: user?.privacy?.whoCanInviteViaGroupLink || 'everyone',
    whoCanCreateGroupsWithMe: user?.privacy?.whoCanCreateGroupsWithMe || 'everyone',
    groupMentions: user?.privacy?.groupMentions || 'everyone',
    screenshotProtection: user?.privacy?.screenshotProtection === true,
  });
  const [friendsList, setFriendsList] = useState([]);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [blocked, setBlocked] = useState([]);
  const [deletePassword, setDeletePassword] = useState('');
  const [sessions, setSessions] = useState([]);
  const [deviceLinkModalOpen, setDeviceLinkModalOpen] = useState(false);
  const [deviceLinkSetupModalOpen, setDeviceLinkSetupModalOpen] = useState(false);
  const [deviceLinkRequest, setDeviceLinkRequest] = useState(null);
  const [deviceLinkBusy, setDeviceLinkBusy] = useState(false);
  const [deviceLinkState, setDeviceLinkState] = useState('idle');
  const [deviceLinkQr, setDeviceLinkQr] = useState('');
  const [deviceLinkExpiresAt, setDeviceLinkExpiresAt] = useState(null);
  const [deviceLinkTimeLeft, setDeviceLinkTimeLeft] = useState(0);
  const [deviceLinkError, setDeviceLinkError] = useState('');
  const [deviceLinkLinkId, setDeviceLinkLinkId] = useState('');
  const [deviceLinkToken, setDeviceLinkToken] = useState('');
  const [deviceLinkLoading, setDeviceLinkLoading] = useState(false);
  const [deviceLinkStatusText, setDeviceLinkStatusText] = useState('');
  const [deviceLinkEmail, setDeviceLinkEmail] = useState('');
  const [deviceLinkEmailBusy, setDeviceLinkEmailBusy] = useState(false);
  const [deviceLinkEmailMessage, setDeviceLinkEmailMessage] = useState('');
  const [deviceLinkConfirmOpen, setDeviceLinkConfirmOpen] = useState(false);
  const [deviceLinkConfirmSession, setDeviceLinkConfirmSession] = useState(null);
  const [deviceLinkRefreshing, setDeviceLinkRefreshing] = useState(false);
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [vaultPassphraseConfirm, setVaultPassphraseConfirm] = useState('');
  const [vaultHasBackup, setVaultHasBackup] = useState(false);
  const [blindnessReport, setBlindnessReport] = useState(null);
  const [blindnessBusy, setBlindnessBusy] = useState(false);
  const [totpSetup, setTotpSetup] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpPassword, setTotpPassword] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState([]);
  const [directoryGroups, setDirectoryGroups] = useState([]);
  const shownName = user?.displayName || user?.username || 'You';
  const currentSessionId = getSessionId();
  const [verifyLinkUrl, setVerifyLinkUrl] = useState('');
const onCloseRef = useRef(onClose);
useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

useEffect(() => {
  const prev = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  closeRef.current?.focus();
  function onKeyDown(e) {
    if (e.key === 'Escape') onCloseRef.current?.();
  }
  window.addEventListener('keydown', onKeyDown);
  return () => {
    document.body.style.overflow = prev;
    window.removeEventListener('keydown', onKeyDown);
  };
}, []); // safe: onClose is read via ref, so no dep needed

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (tab !== 'blocked') return;
    client
      .get('/users/me/blocked')
      .then((res) => setBlocked(res.data.data || []))
      .catch(() => setBlocked([]));
  }, [tab]);

  useEffect(() => {
    if (tab !== 'security') return;
    let cancelled = false;
    setDeviceLinkError('');
    setDeviceLinkStatusText('');
    client
      .get('/users/me/sessions')
      .then((res) => {
        if (!cancelled) setSessions(res.data.data || []);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    client
      .get('/users/me/vault')
      .then(() => {
        if (!cancelled) setVaultHasBackup(true);
      })
      .catch(() => {
        if (!cancelled) setVaultHasBackup(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);
  useEffect(() => {
    if (tab !== 'notifications') return;
    setNotifPermission(getNotificationPermission());
    client.get('/users').then((res) => setDirectoryUsers(res.data.data || [])).catch(() => setDirectoryUsers([]));
    client.get('/groups').then((res) => setDirectoryGroups(res.data.data || [])).catch(() => setDirectoryGroups([]));
  }, [tab]);

  async function enableBrowserNotifications() {
    setBusy(true);
    setError('');
    setOk('');
    unlockAudio();
    const res = await enablePushNotifications();
    setNotifPermission(res.permission || getNotificationPermission());
    if (res.permission === 'granted') {
      await updateNotifSettings({
        webNotifications: { ...(notifSettings.webNotifications || {}), enabled: true },
      });
      setOk(
        res.push
          ? 'Browser notifications enabled (including when QuantumChat is closed)'
          : 'Browser notifications enabled'
      );
    } else {
      setError(res.error || 'Could not enable notifications');
    }
    setBusy(false);
  }

  async function testNotificationSound() {
    unlockAudio();
    setError('');
    setOk('');
    const scale =
      typeof notifSettings?.soundVolume === 'number' ? notifSettings.soundVolume / 100 : 0.8;
    playReceiveSound(scale);

    let permission = getNotificationPermission();
    if (permission === 'default') {
      const res = await enablePushNotifications();
      permission = res.permission || getNotificationPermission();
      setNotifPermission(permission);
    }

    if (permission === 'granted' && notifSettings?.webNotifications?.enabled !== false) {
      try {
        // eslint-disable-next-line no-new
        new Notification('QuantumChat', {
          body: 'Test notification — you will see alerts like this for new messages.',
          icon: '/logo.png',
          silent: false,
          tag: 'quantumchat-test',
        });
        setOk('Played test sound and showed a notification');
      } catch {
        setOk('Played test sound');
      }
    } else if (permission === 'denied') {
      setError('Notifications are blocked in the browser. Allow them in site settings, then try again.');
    } else {
      setOk('Played test sound');
    }
  }
  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setAvatarBusy(true);
    try {
      const form = new FormData();
      form.append('avatar', file);
      const { data } = await client.post('/users/me/avatar', form);
      bustAvatarCache(user.id);
      onUserUpdated?.(data.data);
      setOk('Profile photo updated');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload profile photo');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    setBusy(true);
    setError('');
    try {
      const { data } = await client.delete('/users/me/avatar');
      bustAvatarCache(user.id);
      onUserUpdated?.(data.data);
      setOk('Profile photo removed');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove photo');
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    setBusy(true);
    setError('');
    setOk('');
    try {
      const { data } = await client.patch('/users/me', {
        username: username.trim(),
        displayName: displayName.trim(),
        bio: bio.trim(),
        statusText: statusText.trim(),
        phone: phone.trim(),
        dateOfBirth: dateOfBirth || '',
        timezone,
        transliteratedNames,
      });
      onUserUpdated?.(data.data);
      setOk('Profile saved');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save profile');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (tab !== 'privacy') return;
    client
      .get('/users/friends')
      .then((res) => setFriendsList(res.data.data || []))
      .catch(() => setFriendsList([]));
  }, [tab]);

  useEffect(() => {
    if (tab !== 'security') return undefined;
    const socket = getSocket() || connectSocket();
    if (!socket) return undefined;

    const handleLinkRequest = (payload) => {
      setDeviceLinkRequest(payload);
      setDeviceLinkModalOpen(true);
      setDeviceLinkState('request');
      setDeviceLinkStatusText('A new device is waiting for your approval.');
      setDeviceLinkError('');
    };

    const handleLinked = async () => {
      await refreshDeviceSessions();
    };

    const handleRevoked = async () => {
      await refreshDeviceSessions();
    };

    socket.on('device:link-request', handleLinkRequest);
    socket.on('device:linked', handleLinked);
    socket.on('device:revoked', handleRevoked);
    return () => {
      socket.off('device:link-request', handleLinkRequest);
      socket.off('device:linked', handleLinked);
      socket.off('device:revoked', handleRevoked);
    };
  }, [tab]);

  async function updatePrivacyField(key, val) {
    const updated = { ...privacy, [key]: val };
    setPrivacy(updated);
    setBusy(true);
    setError('');
    setOk('');
    try {
      const res = await updatePrivacySettings(updated);
      if (res?.data && typeof res.data === 'object') {
        setPrivacy((prev) => ({ ...prev, ...res.data }));
      }
      onUserUpdated?.(res.user || { ...user, privacy: res.data || updated });
      if (key === 'typingIndicator') {
        const socket = getSocket() || connectSocket();
        socket?.emit('privacy:typing-indicator', { enabled: Boolean(val) });
      }
      setOk('Privacy settings saved');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save privacy');
    } finally {
      setBusy(false);
    }
  }

  function toggleSelectedFriend(friendId) {
    const current = new Set(privacy.onlineStatusVisibleTo || []);
    if (current.has(friendId)) {
      current.delete(friendId);
    } else {
      current.add(friendId);
    }
    updatePrivacyField('onlineStatusVisibleTo', [...current]);
  }

  function toggleStoryViewer(friendId) {
    const current = new Set(privacy.storyViewers || []);
    if (current.has(friendId)) {
      current.delete(friendId);
    } else {
      current.add(friendId);
    }
    updatePrivacyField('storyViewers', [...current]);
  }

  async function savePrivacy() {
    updatePrivacyField('lastSeen', privacy.lastSeen);
  }
  async function updateNotifField(key, val) {
    setBusy(true);
    setError('');
    setOk('');
    const res = await updateNotifSettings({ [key]: val });
    if (res.success) {
      setOk('Notification settings saved');
    } else {
      setError(res.error || 'Failed to save notification settings');
    }
    setBusy(false);
  }
  async function updateNotifNested(parentKey, childKey, val) {
    setBusy(true);
    setError('');
    setOk('');

    if (parentKey === 'webNotifications' && childKey === 'enabled' && val === true) {
      unlockAudio();
      const perm = await enablePushNotifications();
      setNotifPermission(perm.permission || getNotificationPermission());
      if (perm.permission !== 'granted') {
        setError(perm.error || 'Allow notifications in your browser to enable this');
        setBusy(false);
        return;
      }
    }

    if (parentKey === 'webNotifications' && childKey === 'enabled' && val === false) {
      await disablePushNotifications();
    }

    const nextParent = { ...(notifSettings[parentKey] || {}), [childKey]: val };
    const res = await updateNotifSettings({ [parentKey]: nextParent });
    if (res.success) {
      setOk('Notification settings saved');
    } else {
      setError(res.error || 'Failed to save notification settings');
    }
    setBusy(false);
  }
  async function unmuteFromList(key) {
    const parsed = parseMutedKey(key, user?.id);
    if (!parsed) return;
    setBusy(true);
    setError('');
    setOk('');
    try {
      const res = await unmuteChat(parsed.type === 'group' ? { groupId: parsed.id } : { peerId: parsed.id });
      if (res?.data) onUserUpdated?.(res.data);
      setOk('Chat unmuted');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to unmute chat');
    } finally {
      setBusy(false);
    }
  }
  async function changePassword() {
    setBusy(true);
    setError('');
    setOk('');
    try {
      await client.post('/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setOk('Password updated');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setBusy(false);
    }
  }

  async function start2faSetup() {
    setTotpBusy(true);
    setError('');
    setOk('');
    try {
      const { data } = await client.post('/auth/2fa/setup');
      setTotpSetup(data.data);
      setTotpCode('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start 2FA setup');
    } finally {
      setTotpBusy(false);
    }
  }

  async function confirmEnable2fa() {
    setTotpBusy(true);
    setError('');
    setOk('');
    try {
      const { data } = await client.post('/auth/2fa/enable', { token: totpCode.trim() });
      onUserUpdated?.(data.data.user);
      setTotpSetup(null);
      setTotpCode('');
      setOk('Two-factor authentication enabled');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to enable 2FA');
    } finally {
      setTotpBusy(false);
    }
  }

  async function confirmDisable2fa() {
    setTotpBusy(true);
    setError('');
    setOk('');
    try {
      const { data } = await client.post('/auth/2fa/disable', {
        password: totpPassword,
        token: totpCode.trim(),
      });
      onUserUpdated?.(data.data.user);
      setTotpPassword('');
      setTotpCode('');
      setOk('Two-factor authentication disabled');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to disable 2FA');
    } finally {
      setTotpBusy(false);
    }
  }

  async function refreshDeviceSessions() {
    setDeviceLinkRefreshing(true);
    try {
      const data = await listLinkedDeviceSessions();
      setSessions(data || []);
    } catch {
      setSessions([]);
    } finally {
      setDeviceLinkRefreshing(false);
    }
  }

  function closeDeviceLinkModal() {
    setDeviceLinkModalOpen(false);
    setDeviceLinkRequest(null);
    setDeviceLinkState('idle');
    setDeviceLinkError('');
    setDeviceLinkStatusText('');
  }

  function closeDeviceLinkSetupModal() {
    setDeviceLinkSetupModalOpen(false);
    setDeviceLinkLoading(false);
    setDeviceLinkError('');
    setDeviceLinkStatusText('');
  }

  async function openDeviceLinkModal() {
    setDeviceLinkError('');
    setDeviceLinkStatusText('Preparing a new device link…');
    setDeviceLinkLoading(true);
    setDeviceLinkSetupModalOpen(true);
    try {
      const payload = await createDeviceLinkRequest();
      const qrPayload = buildQrPayload(payload.linkId, payload.token);
      const qrUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 220 });
      setDeviceLinkLinkId(payload.linkId);
      setDeviceLinkToken(payload.token);
      setDeviceLinkExpiresAt(payload.expiresAt);
      setDeviceLinkQr(qrUrl);
      setDeviceLinkState('waiting');
      setDeviceLinkStatusText('Scan the QR code or paste the payload from the new device.');
    } catch (err) {
      setDeviceLinkState('idle');
      setDeviceLinkSetupModalOpen(true);
      setDeviceLinkError(err?.response?.data?.error || err?.message || 'Unable to prepare the pairing request.');
    } finally {
      setDeviceLinkLoading(false);
    }
  }

  async function confirmDeviceLinkApprove() {
    if (!deviceLinkRequest?.linkId) return;
    setDeviceLinkBusy(true);
    try {
      await approveDeviceLink(deviceLinkRequest.linkId);
      setDeviceLinkState('approved');
      setDeviceLinkStatusText('Device linked successfully.');
      await refreshDeviceSessions();
      setDeviceLinkModalOpen(false);
      setDeviceLinkRequest(null);
    } catch (err) {
      setDeviceLinkError(err?.response?.data?.error || err?.message || 'Unable to approve the link request.');
    } finally {
      setDeviceLinkBusy(false);
    }
  }

  async function confirmDeviceLinkReject() {
    if (!deviceLinkRequest?.linkId) return;
    setDeviceLinkBusy(true);
    try {
      await rejectDeviceLink(deviceLinkRequest.linkId);
      setDeviceLinkState('rejected');
      setDeviceLinkStatusText('The link request was rejected.');
    } catch (err) {
      setDeviceLinkError(err?.response?.data?.error || err?.message || 'Unable to reject the link request.');
    } finally {
      setDeviceLinkBusy(false);
    }
  }

  async function sendDeviceLinkEmail() {
    if (!deviceLinkLinkId || !deviceLinkToken) {
      setDeviceLinkError('Create a new pairing request first.');
      return;
    }
    if (!deviceLinkEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(deviceLinkEmail)) {
      setDeviceLinkError('Enter a valid email address.');
      return;
    }
    setDeviceLinkEmailBusy(true);
    setDeviceLinkEmailMessage('');
    try {
      const result = await sendDeviceLinkEmailApi({ linkId: deviceLinkLinkId, token: deviceLinkToken });
      setDeviceLinkEmailMessage(result?.message || 'Pairing link sent.');
    } catch (err) {
      setDeviceLinkError(err?.response?.data?.error || 'Unable to send the pairing link.');
    } finally {
      setDeviceLinkEmailBusy(false);
    }
  }

  async function revokeDeviceSession(sessionId) {
    const isSelf = sessionId && currentSessionId && sessionId === currentSessionId;
    if (
      isSelf &&
      !window.confirm('Revoke this device? You will be signed out here.')
    ) {
      return;
    }
    setBusy(true);
    setError('');
    setOk('');
    try {
      if (!isSelf) {
        await revokeDeviceSessionApi(sessionId);
      } else {
        await client.delete(`/users/me/sessions/${sessionId}`);
      }
      if (isSelf) {
        onLogout?.();
        return;
      }
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      setOk('Device session revoked');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to revoke session');
    } finally {
      setBusy(false);
    }
  }

  async function loadBlindnessReport() {
    setBlindnessBusy(true);
    setError('');
    try {
      const { data } = await client.get('/trust/blindness');
      setBlindnessReport(data.data || null);
    } catch (err) {
      setBlindnessReport(null);
      setError(err.response?.data?.error || 'Failed to load blindness report');
    } finally {
      setBlindnessBusy(false);
    }
  }

  async function backupToVault() {
    if (!vaultPassphrase || vaultPassphrase.length < 8) {
      setError('Vault passphrase must be at least 8 characters');
      return;
    }
    if (vaultPassphrase !== vaultPassphraseConfirm) {
      setError('Passphrase confirmation does not match');
      return;
    }
    const keySet = getCurrentKeySet(user.id);
    if (!keySet.length) {
      setError('No local keys to back up — import or generate keys first');
      return;
    }
    setBusy(true);
    setError('');
    setOk('');
    try {
      const secretKeysJson = JSON.stringify(keySet.map((k) => k.secretKey));
      const payload = await encryptVaultPayload(vaultPassphrase, secretKeysJson);
      await client.put('/users/me/vault', payload);
      setVaultHasBackup(true);
      setVaultPassphrase('');
      setVaultPassphraseConfirm('');
      setOk('Keys backed up to encrypted vault');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Vault backup failed');
    } finally {
      setBusy(false);
    }
  }

  async function restoreFromVault() {
    if (!vaultPassphrase) {
      setError('Enter your vault passphrase to restore');
      return;
    }
    setBusy(true);
    setError('');
    setOk('');
    try {
      const { data } = await client.get('/users/me/vault');
      const secretKeysJson = await decryptVaultPayload(vaultPassphrase, data.data);
      const secretKeys = JSON.parse(secretKeysJson);
      if (!Array.isArray(secretKeys)) {
        throw new Error('Vault contents are invalid');
      }
      await importKeys(secretKeys);
      setVaultPassphrase('');
      setVaultPassphraseConfirm('');
      setOk('Keys restored from vault');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Vault restore failed');
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    setError('');
    setOk('');
    setVerifyLinkUrl('');
    try {
      const { data } = await client.post('/auth/resend-verification');
      onUserUpdated?.(data.data.user);
      setOk(data.data.message || 'Verification email sent — check your inbox');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resend verification');
    } finally {
      setBusy(false);
    }
  }

  async function unblock(id) {
    setBusy(true);
    try {
      const { data } = await client.delete(`/users/${id}/block`);
      onUserUpdated?.(data.data);
      setBlocked((prev) => prev.filter((u) => String(u.id) !== String(id)));
      setOk('User unblocked');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to unblock');
    } finally {
      setBusy(false);
    }
  }

  async function downloadData() {
    setBusy(true);
    setError('');
    try {
      const { data } = await client.get('/users/me/export');
      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quantumchat-data-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setOk('Account data downloaded (ciphertext messages not included)');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to download data');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (!deletePassword) {
      setError('Enter your password to delete the account');
      return;
    }
    if (
      !window.confirm(
        'Permanently delete your account? Encrypted message history on the server will be removed. Local keys on this device should be backed up first.'
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await client.delete('/users/me', { data: { password: deletePassword } });
      onLogout?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete account');
      setBusy(false);
    }
  }

  return (
    <div className="create-group-overlay" role="presentation" onClick={onClose}>
      <div
        className={`settings-modal settings-modal-wide ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <div className="settings-modal-heading">
            <h2 id="settings-title">{t('settings.title', 'Settings')}</h2>
            <p>{t('settings.privacy.subtitle', 'Profile, privacy, security, and data')}</p>
          </div>
          <button ref={closeRef} type="button" className="settings-close settings-close-btn" onClick={onClose} aria-label={t('common.close', 'Close')}>
            ✕
          </button>
        </div>

        <nav className="settings-tabs settings-nav" aria-label="Settings sections">
          {[
            ['profile', t('settings.tabs.profile', 'Profile')],
            ['privacy', t('settings.tabs.privacy', 'Privacy')],
            ['notifications', t('settings.tabs.notifications', 'Notifications')],
            ['security', t('settings.tabs.security', 'Security')],
            ['blocked', t('settings.tabs.blocked', 'Blocked')],
            ['data', t('settings.tabs.data', 'Data')],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`settings-tab ${tab === id ? 'active' : ''}`}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => {
                setTab(id);
                setError('');
                setOk('');
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="settings-body">
          {error && <div className="auth-error">{error}</div>}
          {ok && <div className="settings-ok">{ok}</div>}
          {verifyLinkUrl && (
            <div className="settings-ok">
              <a href={verifyLinkUrl} target="_blank" rel="noopener noreferrer">
                {verifyLinkUrl}
              </a>
            </div>
          )}
          {tab === 'profile' && (
            <section className="settings-section">
              <div className="settings-identity">
                <div className="settings-avatar-stack">
                  <UserAvatar
                    userId={user?.id}
                    name={shownName}
                    hasAvatar={user?.hasAvatar}
                    size="lg"
                  />
                  <button
                    type="button"
                    className="settings-avatar-edit"
                    disabled={avatarBusy}
                    onClick={() => avatarInputRef.current?.click()}
                    aria-label={t('settings.profile.changeAvatar', 'Change photo')}
                  >
                    {avatarBusy ? '…' : '✎'}
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    hidden
                    onChange={handleAvatarChange}
                  />
                </div>
                <div className="settings-account-meta">
                  <span className="settings-account-name">{shownName}</span>
                  <span className="settings-account-email">{user?.email}</span>
                  <div className="settings-status-row">
                    {user?.emailVerified ? (
                      <span className="settings-badge settings-badge-ok">{t('settings.profile.emailVerified', 'Verified')}</span>
                    ) : (
                      <span className="settings-badge settings-badge-warn">Unverified email</span>
                    )}
                  </div>
                  <div className="settings-photo-actions">
                    <button
                      type="button"
                      className="settings-btn ghost"
                      disabled={avatarBusy}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      {avatarBusy ? t('common.loading', 'Uploading…') : t('settings.profile.changeAvatar', 'Change photo')}
                    </button>
                    {user?.hasAvatar && (
                      <button type="button" className="settings-btn ghost" disabled={busy} onClick={removeAvatar}>
                        {t('settings.profile.removeAvatar', 'Remove')}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {!user?.emailVerified && (
                <div className="settings-verify-banner">
                  <div>
                    <strong>Confirm your email</strong>
                    <p>Verify to unlock full account recovery and security alerts.</p>
                  </div>
                  <button type="button" className="settings-btn text" disabled={busy} onClick={resendVerification}>
                    {t('settings.profile.resendVerifyEmail', 'Resend link')}
                  </button>
                </div>
              )}

              {/* Language Selector Fieldset */}
              <div className="settings-fieldset">
                <h3 className="settings-section-title">{t('settings.language.title', 'Language & Region')}</h3>
                <p className="settings-section-copy">{t('settings.language.subtitle', 'Choose your interface language')}</p>
                <div className="settings-lang-grid" role="radiogroup" aria-label={t('settings.language.selectLanguage', 'Interface Language')}>
                  {SUPPORTED_LANGUAGES.map((lang) => {
                    const isActive = (activeLang || i18n.language || 'en') === lang.code;
                    return (
                      <button
                        key={lang.code}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        className={`settings-lang-card ${isActive ? 'active' : ''}`}
                        onClick={() => handleLanguageChange(lang.code)}
                      >
                        <span className="settings-lang-native">{lang.nativeName}</span>
                        <span className="settings-lang-english">{lang.name}</span>
                        {isActive && <span className="settings-lang-check">✓</span>}
                      </button>
                    );
                  })}
                </div>
                <p className="settings-section-copy" style={{ marginTop: '0.6rem', fontSize: '0.78rem' }}>
                  {t('settings.language.languageHint', 'Changes apply immediately across the entire app.')}
                </p>
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">{t('settings.profile.aboutYou', 'About you')}</h3>
                <label className="settings-field">
                  <span>{t('settings.profile.username', 'Username')}</span>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={30} autoComplete="username" />
                </label>
                <label className="settings-field">
                  <span>{t('settings.profile.displayName', 'Display name')}</span>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={60}
                    placeholder="Shown to others"
                  />
                </label>
                <label className="settings-field">
                  <span>{t('settings.profile.bio', 'Bio')}</span>
                  <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} rows={3} placeholder={t('settings.profile.bioPlaceholder', 'A short line about you')} />
                </label>
                <label className="settings-field">
                  <span>{t('settings.profile.status', 'Status')}</span>
                  <input
                    value={statusText}
                    onChange={(e) => setStatusText(e.target.value)}
                    maxLength={100}
                    placeholder={t('settings.profile.statusPlaceholder', 'e.g. Busy studying, In a meeting')}
                  />
                  <p className="settings-section-copy">
                    {t('settings.profile.statusHint', 'A custom status shown on your profile. Separate from your online state.')}
                    {statusText.trim() ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          onClick={() => setStatusText('')}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            font: 'inherit',
                            color: 'inherit',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                          }}
                        >
                          {t('settings.profile.clearStatus', 'Clear status')}
                        </button>
                      </>
                    ) : null}
                  </p>
                </label>
                <label className="settings-field">
                  <span>{t('settings.profile.phone', 'Phone')}</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    maxLength={32}
                    placeholder="+1 555 0100"
                    inputMode="tel"
                  />
                  <p className="settings-section-copy">
                    {t('settings.profile.phoneHint', 'Friends can find you by this number. Never shown on your public profile.')}
                  </p>
                </label>
                <label className="settings-field">
                  <span>{t('settings.profile.dateOfBirth', 'Date of birth')}</span>
                  <input
                    type="date"
                    value={dateOfBirth}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                  />
                  <p className="settings-section-copy">
                    {t(
                      'settings.profile.dateOfBirthHint',
                      'Optional. Your friends get a reminder on your birthday — the date itself is never shown on your profile.',
                    )}
                  </p>
                </label>
                <label className="settings-field">
                  <span>{t('settings.profile.timezone', 'Timezone')}</span>
                  <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {timezoneOptions.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  <p className="settings-section-copy">
                    {t(
                      'settings.profile.timezoneHint',
                      'Used to time your birthday reminder to your actual local midnight. Change it anytime — for example after traveling.',
                    )}
                  </p>
                </label>

                <div className="settings-transliterations" style={{ marginTop: '1.25rem', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <Languages size={17} strokeWidth={2} style={{ color: 'var(--accent, #6366f1)' }} />
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary, #fff)' }}>
                      {t('settings.transliteration.title', 'Script Names & Transliteration')}
                    </span>
                  </div>
                  <p className="settings-section-copy" style={{ marginBottom: '0.9rem', fontSize: '0.82rem' }}>
                    {t('settings.transliteration.hint', 'When users switch their app to non-Latin scripts, your name appears in their native alphabet. You can customize your name spelling for each script below:')}
                  </p>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                    <label className="settings-field" style={{ margin: 0 }}>
                      <span style={{ fontSize: '0.8rem' }}>Urdu · اردو</span>
                      <input
                        dir="rtl"
                        value={transliteratedNames.ur || ''}
                        onChange={(e) => setTransliteratedNames(prev => ({ ...prev, ur: e.target.value }))}
                        placeholder="زہرا"
                        maxLength={60}
                      />
                    </label>
                    <label className="settings-field" style={{ margin: 0 }}>
                      <span style={{ fontSize: '0.8rem' }}>Arabic · العربية</span>
                      <input
                        dir="rtl"
                        value={transliteratedNames.ar || ''}
                        onChange={(e) => setTransliteratedNames(prev => ({ ...prev, ar: e.target.value }))}
                        placeholder="زهراء"
                        maxLength={60}
                      />
                    </label>
                    <label className="settings-field" style={{ margin: 0 }}>
                      <span style={{ fontSize: '0.8rem' }}>Persian · فارسی</span>
                      <input
                        dir="rtl"
                        value={transliteratedNames.fa || ''}
                        onChange={(e) => setTransliteratedNames(prev => ({ ...prev, fa: e.target.value }))}
                        placeholder="زهرا"
                        maxLength={60}
                      />
                    </label>
                    <label className="settings-field" style={{ margin: 0 }}>
                      <span style={{ fontSize: '0.8rem' }}>Hindi · हिन्दी</span>
                      <input
                        dir="ltr"
                        value={transliteratedNames.hi || ''}
                        onChange={(e) => setTransliteratedNames(prev => ({ ...prev, hi: e.target.value }))}
                        placeholder="ज़हरा"
                        maxLength={60}
                      />
                    </label>
                    <label className="settings-field" style={{ margin: 0 }}>
                      <span style={{ fontSize: '0.8rem' }}>Chinese · 简体中文</span>
                      <input
                        dir="ltr"
                        value={transliteratedNames.zh || ''}
                        onChange={(e) => setTransliteratedNames(prev => ({ ...prev, zh: e.target.value }))}
                        placeholder="扎赫拉"
                        maxLength={60}
                      />
                    </label>
                    <label className="settings-field" style={{ margin: 0 }}>
                      <span style={{ fontSize: '0.8rem' }}>Russian · Русский</span>
                      <input
                        dir="ltr"
                        value={transliteratedNames.ru || ''}
                        onChange={(e) => setTransliteratedNames(prev => ({ ...prev, ru: e.target.value }))}
                        placeholder="Захра"
                        maxLength={60}
                      />
                    </label>
                  </div>
                </div>

                <button type="button" className="settings-btn primary" disabled={busy} onClick={saveProfile}>
                  {busy ? t('common.saving', 'Saving…') : t('settings.profile.saveProfile', 'Save profile')}
                </button>
              </div>

              <div className="settings-fieldset settings-appearance">
                <h3 className="settings-section-title">{t('settings.appearance.title', 'Appearance')}</h3>
                <p className="settings-section-copy">
                  {t('settings.appearance.currentLook', 'Current look')}: <strong>{THEME_LABELS[theme] || theme}</strong>
                </p>

                <div className="settings-skin-card settings-skin-card--mode">
                  <header className="settings-skin-card-head">
                    <div>
                      <h4 className="settings-skin-card-title">{t('settings.appearance.displayMode', 'Display mode')}</h4>
                      <p className="settings-skin-card-hint">{t('settings.appearance.modeHint', 'Everyday light, dark, or eyecare')}</p>
                    </div>
                  </header>
                  <div className="settings-skin-card-body settings-skin-card-body--mode">
                    <ThemeSwitcher />
                  </div>
                </div>

                <div className="settings-skin-split">
                  <div className="settings-skin-card settings-skin-card--themes">
                    <header className="settings-skin-card-head">
                      <div>
                        <h4 className="settings-skin-card-title">{t('settings.appearance.dreamyThemes', 'Dreamy themes')}</h4>
                        <p className="settings-skin-card-hint">
                          {FUN_THEMES.includes(theme)
                            ? `${THEME_LABELS[theme] || theme} is active`
                            : t('settings.appearance.pickDecorativeSkin', 'Pick a decorative skin')}
                        </p>
                      </div>
                      <span className="settings-skin-badge" aria-hidden="true">FX</span>
                    </header>
                    <div className="settings-skin-card-body">
                      <FunThemeSwitcher />
                    </div>
                  </div>

                  <div className="settings-skin-card settings-skin-card--icons">
                    <header className="settings-skin-card-head">
                      <div>
                        <h4 className="settings-skin-card-title">{t('settings.appearance.appIcon', 'App icon')}</h4>
                        <p className="settings-skin-card-hint">{t('settings.appearance.appIconHint', 'Browser tab & shortcut color')}</p>
                      </div>
                      <span className="settings-skin-badge settings-skin-badge--soft" aria-hidden="true">Icon</span>
                    </header>
                    <div className="settings-skin-card-body">
                      <div className="settings-icon-grid" role="list">
                        {APP_ICONS.map((icon) => (
                          <button
                            key={icon.id}
                            type="button"
                            className={`settings-icon-pick ${appIcon === icon.id ? 'active' : ''}`}
                            onClick={() => setAppIcon(icon.id)}
                            aria-pressed={appIcon === icon.id}
                            aria-label={icon.label}
                            title={icon.label}
                          >
                            <span
                              className="settings-icon-ring"
                              style={{ background: icon.swatch }}
                              aria-hidden="true"
                            />
                            <img src={icon.file} alt="" />
                            {appIcon === icon.id ? <span className="settings-icon-check">✓</span> : null}
                            <span className="settings-icon-name">{icon.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-fieldset settings-fieldset-danger">
                <h3 className="settings-section-title">{t('settings.session.title', 'Session')}</h3>
                <p className="settings-section-copy">
                  {t('settings.session.logoutDesc', 'Sign out on this browser. Your encryption keys stay on this device for the next login.')}
                </p>
                <button type="button" className="settings-btn ghost" onClick={() => onLogout?.()}>
                  {t('settings.session.logoutButton', 'Log out')}
                </button>
              </div>
            </section>
          )}

          {tab === 'privacy' && (
            <section className="settings-section">
              <div className="settings-fieldset">
                <h3 className="settings-section-title">Profile &amp; Activity Privacy</h3>
                <p className="settings-section-copy">
                  Manage who can view your profile info, last seen, online status, and stories.
                </p>

                <PrivacySelect
                  label="Who Can See My Profile"
                  description="Control visibility of bio, phone number, and detailed profile info"
                  value={privacy.profileVisibility}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'friends', label: 'Friends Only' },
                    { value: 'onlyMe', label: 'Only Me' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('profileVisibility', v)}
                />

                <PrivacySelect
                  label="Who Can See My Birthday"
                  description="Control who can view your birthday on your profile"
                  value={privacy.birthdayVisibility}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'friends', label: 'Friends Only' },
                    { value: 'onlyMe', label: 'Only Me' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('birthdayVisibility', v)}
                />

                <PrivacySelect
                  label="Last Seen"
                  description="Who can see your last active time"
                  value={privacy.lastSeen}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'friends', label: 'Friends Only' },
                    { value: 'nobody', label: 'No One' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('lastSeen', v)}
                />

                <PrivacySelect
                  label="Read Receipts"
                  description="Who can see when you have read their messages"
                  value={privacy.readReceipts}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'friends', label: 'Friends Only' },
                    { value: 'nobody', label: 'No One' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('readReceipts', v)}
                />

                <ToggleRow
                  label="Typing indicator"
                  hint="Show others when you are typing a message"
                  checked={privacy.typingIndicator !== false}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('typingIndicator', v)}
                />

                <PrivacySelect
                  label="Online Status"
                  description="Who can see when you are online"
                  value={privacy.onlineStatus}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'friends', label: 'Friends Only' },
                    { value: 'selected', label: 'Selected People' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('onlineStatus', v)}
                />

                {privacy.onlineStatus === 'selected' && (
                  <div className="privacy-friend-picker">
                    <span className="privacy-select-description" style={{ marginBottom: 4 }}>
                      Friends permitted to see online status:
                    </span>
                    {friendsList.length === 0 ? (
                      <p className="privacy-select-description">No friends added yet.</p>
                    ) : (
                      friendsList.map((f) => {
                        const fId = String(f.id || f._id);
                        const isChecked = (privacy.onlineStatusVisibleTo || []).includes(fId);
                        return (
                          <label key={fId} className="privacy-friend-item">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={busy}
                              onChange={() => toggleSelectedFriend(fId)}
                            />
                            <UserAvatar userId={f.id} name={f.displayName || f.username} size="xs" />
                            <span>{f.displayName || f.username}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                )}

                <PrivacySelect
                  label="Show My Account To"
                  description="Account discoverability in user search"
                  value={privacy.discoverable}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'nobody', label: 'No One' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('discoverable', v)}
                />

                <PrivacySelect
                  label="Who Can View My Stories"
                  description="Control who can see your posted stories"
                  value={privacy.story}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'friends', label: 'Friends Only' },
                    { value: 'nobody', label: 'No One' },
                    { value: 'selected', label: 'Selected People' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('story', v)}
                />

                {privacy.story === 'selected' && (
                  <div className="privacy-friend-picker">
                    <span className="privacy-select-description" style={{ marginBottom: 4 }}>
                      Friends permitted to see your stories:
                    </span>
                    {friendsList.length === 0 ? (
                      <p className="privacy-select-description">No friends added yet.</p>
                    ) : (
                      friendsList.map((f) => {
                        const fId = String(f.id || f._id);
                        const isChecked = (privacy.storyViewers || []).includes(fId);
                        return (
                          <label key={fId} className="privacy-friend-item">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={busy}
                              onChange={() => toggleStoryViewer(fId)}
                            />
                            <UserAvatar userId={f.id} name={f.displayName || f.username} size="xs" />
                            <span>{f.displayName || f.username}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Messaging &amp; Mentions</h3>
                <p className="settings-section-copy">
                  Control who can direct message you and tag you in general mentions.
                </p>

                <PrivacySelect
                  label="Who Can Direct Message You"
                  description="Control who can send you direct messages"
                  value={privacy.whoCanMessage}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'friends', label: 'Friends Only' },
                    { value: 'friendsOfFriends', label: 'Friends of Friends' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('whoCanMessage', v)}
                />

                <PrivacySelect
                  label="Who Can Mention You"
                  description="General 1:1 and direct mention permissions"
                  value={privacy.whoCanMention}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'friends', label: 'Friends Only' },
                    { value: 'nobody', label: 'No One' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('whoCanMention', v)}
                />
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Group Privacy &amp; Permissions</h3>
                <p className="settings-section-copy">
                  Manage group invitations, group creation permissions, and group-specific mentions.
                </p>

                <PrivacySelect
                  label="Who Can Add Me to Groups"
                  description="Control who can add you directly to group chats"
                  value={privacy.whoCanAddToGroups}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'friends', label: 'Friends Only' },
                    { value: 'nobody', label: 'No One' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('whoCanAddToGroups', v)}
                />

                <PrivacySelect
                  label="Who Can Invite Me via Group Links"
                  description="Control whether you can join groups via invite links"
                  value={privacy.whoCanInviteViaGroupLink}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'friends', label: 'Friends Only' },
                    { value: 'nobody', label: 'No One' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('whoCanInviteViaGroupLink', v)}
                />

                <PrivacySelect
                  label="Who Can Create Groups with Me"
                  description="Control who can select you as an initial member of a new group"
                  value={privacy.whoCanCreateGroupsWithMe}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'friends', label: 'Friends Only' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('whoCanCreateGroupsWithMe', v)}
                />

                {/* Note: distinct scope from general mentions (whoCanMention) */}
                <PrivacySelect
                  label="Group Mentions"
                  description="Control who can @-mention you inside group chats specifically"
                  value={privacy.groupMentions}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'adminsOnly', label: 'Admins Only' },
                    { value: 'nobody', label: 'No One' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('groupMentions', v)}
                />
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Screenshot Protection</h3>
                <p className="settings-section-copy">
                  When enabled, other people cannot screenshot or screen-record your
                  chats and profile on their device where the platform supports it.
                  You can still capture your own screen normally. On web, viewers get
                  a blank screen and alert when a capture shortcut is detected
                  (browsers cannot fully block OS screenshots).
                </p>
                <ToggleRow
                  label="Screenshot protection"
                  hint="Stop others from screenshotting or recording your chats and profile"
                  checked={privacy.screenshotProtection === true}
                  disabled={busy}
                  onChange={(v) => updatePrivacyField('screenshotProtection', v)}
                />
              </div>
            </section>
          )}
          {tab === 'notifications' && (
            <section className="settings-section">
              <div className="settings-fieldset">
                <h3 className="settings-section-title">Message Notifications</h3>
                <p className="settings-section-copy">Choose which messages trigger notifications.</p>

                <PrivacySelect
                  label="Message Notifications"
                  description="Which messages should notify you"
                  value={notifSettings.messageNotifications}
                  options={[
                    { value: 'all', label: 'All Messages' },
                    { value: 'direct_only', label: 'Only Direct Messages' },
                    { value: 'all_except_reactions', label: 'All Messages Except Reactions' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updateNotifField('messageNotifications', v)}
                />
              </div>
                           <div className="settings-fieldset">
                <h3 className="settings-section-title">Media &amp; Downloads</h3>
                <p className="settings-section-copy">
                  Control when photos and videos load automatically. When off for a
                  media type, you'll need to tap to load it manually.
                </p>

                <ToggleRow
                  label="Auto-download photos"
                  hint="Load incoming images automatically"
                  checked={notifSettings.mediaSettings?.autoDownloadImages !== false}
                  disabled={busy}
                  onChange={(v) => updateNotifNested('mediaSettings', 'autoDownloadImages', v)}
                />
                <ToggleRow
                  label="Auto-download videos"
                  hint="Load incoming videos automatically (uses more data)"
                  checked={notifSettings.mediaSettings?.autoDownloadVideos === true}
                  disabled={busy}
                  onChange={(v) => updateNotifNested('mediaSettings', 'autoDownloadVideos', v)}
                />
                <ToggleRow
                  label="Only on Wi-Fi"
                  hint="Pause auto-download while on mobile data, where supported"
                  checked={notifSettings.mediaSettings?.wifiOnly !== false}
                  disabled={busy}
                  onChange={(v) => updateNotifNested('mediaSettings', 'wifiOnly', v)}
                />
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Muted Chats</h3>
                <p className="settings-section-copy">Manage conversations you've muted.</p>

                {!Array.isArray(user?.mutedChats) || user.mutedChats.length === 0 ? (
                  <p className="settings-section-copy">No muted chats.</p>
                ) : (
                  user.mutedChats.map((m) => {
                    const parsed = parseMutedKey(m.conversationKey, user?.id);
                    if (!parsed) return null;
                    const name =
                      parsed.type === 'group'
                        ? directoryGroups.find((g) => String(g.id) === String(parsed.id))?.name || 'Unknown group'
                        : directoryUsers.find((u) => String(u.id) === String(parsed.id))?.displayName ||
                        directoryUsers.find((u) => String(u.id) === String(parsed.id))?.username ||
                        'Unknown user';
                    return (
                      <div key={m.conversationKey} className="settings-row" style={{ cursor: 'default' }}>
                        <span className="settings-row-left">
                          <span className="settings-row-label">{name}</span>
                          <span className="settings-row-hint">{formatMuteExpiry(m.expiresAt)}</span>
                        </span>
                        <button
                          type="button"
                          className="settings-btn ghost"
                          disabled={busy}
                          onClick={() => unmuteFromList(m.conversationKey)}
                        >
                          Unmute
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Status Notifications</h3>
                <p className="settings-section-copy">Control updates from friends' statuses.</p>

                <PrivacySelect
                  label="Status Notifications"
                  description="When to notify you about friend statuses"
                  value={notifSettings.statusNotifications}
                  options={[
                    { value: 'all', label: 'All Friend Statuses' },
                    { value: 'favorites_only', label: 'Favorite Friends Only' },
                    { value: 'off', label: 'Off' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updateNotifField('statusNotifications', v)}
                />
              </div>
              <div className="settings-fieldset">
                <h3 className="settings-section-title">Notification Sound</h3>
                <p className="settings-section-copy">Customize notification sounds and volume.</p>

                <ToggleRow
                  label="Notification sounds"
                  hint="Play a sound when new notifications arrive"
                  checked={notifSettings.soundEnabled !== false}
                  disabled={busy}
                  onChange={(v) => updateNotifField('soundEnabled', v)}
                />

                {notifSettings.soundEnabled && (
                  <label className="settings-field">
                    <span>Volume ({notifSettings.soundVolume}%)</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={notifSettings.soundVolume}
                      disabled={busy}
                      onChange={(e) => updateNotifField('soundVolume', Number(e.target.value))}
                    />
                  </label>
                )}
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Message Preview</h3>
                <p className="settings-section-copy">Choose what appears in notifications.</p>

                <PrivacySelect
                  label="Message Preview"
                  description="How much of a message to reveal in notifications"
                  value={notifSettings.messagePreview}
                  options={[
                    { value: 'full', label: 'Show Full Message' },
                    { value: 'sender_only', label: 'Show Sender Only' },
                    { value: 'hidden', label: 'Hide Preview' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updateNotifField('messagePreview', v)}
                />
              </div>
              <div className="settings-fieldset">
                <h3 className="settings-section-title">Vibration</h3>
                <p className="settings-section-copy">Control vibration for notifications.</p>

                <PrivacySelect
                  label="Vibration"
                  description="Vibrate on new notifications"
                  value={notifSettings.vibration}
                  options={[
                    { value: 'on', label: 'On' },
                    { value: 'off', label: 'Off' },
                    { value: 'custom', label: 'Custom Pattern' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updateNotifField('vibration', v)}
                />
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Birthday Reminders</h3>
                <p className="settings-section-copy">
                  Get a reminder 5 minutes before a friend&apos;s birthday begins.
                </p>

                <ToggleRow
                  label="Birthday Reminders"
                  hint="Notify me before a friend's birthday starts"
                  checked={notifSettings.birthdayReminders !== false}
                  disabled={busy}
                  onChange={(v) => updateNotifField('birthdayReminders', v)}
                />
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Do Not Disturb</h3>
                <p className="settings-section-copy">Silence notifications during specific times.</p>

                <ToggleRow
                  label="Do Not Disturb"
                  hint="Silence notifications during quiet hours"
                  checked={notifSettings.doNotDisturb?.enabled}
                  disabled={busy}
                  onChange={(v) => updateNotifNested('doNotDisturb', 'enabled', v)}
                />

                {notifSettings.doNotDisturb?.enabled && (
                  <>
                    <label className="settings-field">
                      <span>Quiet hours start</span>
                      <input
                        type="time"
                        value={notifSettings.doNotDisturb?.startTime || '22:00'}
                        disabled={busy}
                        onChange={(e) => updateNotifNested('doNotDisturb', 'startTime', e.target.value)}
                      />
                    </label>
                    <label className="settings-field">
                      <span>Quiet hours end</span>
                      <input
                        type="time"
                        value={notifSettings.doNotDisturb?.endTime || '07:00'}
                        disabled={busy}
                        onChange={(e) => updateNotifNested('doNotDisturb', 'endTime', e.target.value)}
                      />
                    </label>
                  </>
                )}
              </div>
              <div className="settings-fieldset">
                <h3 className="settings-section-title">Group Notifications</h3>
                <p className="settings-section-copy">Control notifications from group chats.</p>

                <PrivacySelect
                  label="Group Notifications"
                  description="Which group messages should notify you"
                  value={notifSettings.groupNotifications}
                  options={[
                    { value: 'all', label: 'All Messages' },
                    { value: 'mentions_only', label: 'Mentions Only' },
                    { value: 'important_only', label: 'Important Announcements Only' },
                    { value: 'off', label: 'Off' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updateNotifField('groupNotifications', v)}
                />
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Call Notifications</h3>
                <p className="settings-section-copy">Manage incoming call alerts.</p>

                <ToggleRow
                  label="Voice call notifications"
                  checked={notifSettings.callNotifications?.voiceCallEnabled}
                  disabled={busy}
                  onChange={(v) => updateNotifNested('callNotifications', 'voiceCallEnabled', v)}
                />
                <ToggleRow
                  label="Video call notifications"
                  checked={notifSettings.callNotifications?.videoCallEnabled}
                  disabled={busy}
                  onChange={(v) => updateNotifNested('callNotifications', 'videoCallEnabled', v)}
                />
                <ToggleRow
                  label="Vibrate for incoming calls"
                  checked={notifSettings.callNotifications?.vibrateOnCall}
                  disabled={busy}
                  onChange={(v) => updateNotifNested('callNotifications', 'vibrateOnCall', v)}
                />
                <ToggleRow
                  label="Missed call reminders"
                  checked={notifSettings.callNotifications?.missedCallReminders}
                  disabled={busy}
                  onChange={(v) => updateNotifNested('callNotifications', 'missedCallReminders', v)}
                />
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Badge Count</h3>
                <p className="settings-section-copy">Show unread message count on the app icon.</p>

                <PrivacySelect
                  label="Badge Count"
                  description="Whether to show your unread count on the app icon"
                  value={notifSettings.badgeCount}
                  options={[
                    { value: 'show', label: 'Show' },
                    { value: 'hidden', label: 'Hide' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updateNotifField('badgeCount', v)}
                />
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Desktop / Web Notifications</h3>
                <p className="settings-section-copy">
                  Show system alerts (with sound) when QuantumChat is in the background or another
                  app is open — like Chrome or WhatsApp notifications.
                </p>

                <div className="settings-row" style={{ cursor: 'default' }}>
                  <span className="settings-row-left">
                    <span className="settings-row-label">Browser permission</span>
                    <span className="settings-row-hint">
                      {notifPermission === 'granted'
                        ? 'Allowed — alerts can appear outside QuantumChat'
                        : notifPermission === 'denied'
                          ? 'Blocked — allow QuantumChat in your browser site settings'
                          : notifPermission === 'unsupported'
                            ? 'Not supported in this browser'
                            : 'Not decided yet — click Enable below'}
                    </span>
                  </span>
                  {notifPermission !== 'granted' && notifPermission !== 'unsupported' ? (
                    <button
                      type="button"
                      className="settings-btn primary"
                      disabled={busy}
                      onClick={enableBrowserNotifications}
                    >
                      Enable
                    </button>
                  ) : null}
                </div>

                <ToggleRow
                  label="Enable browser notifications"
                  hint="Popup alerts when you are in another tab or app"
                  checked={notifSettings.webNotifications?.enabled !== false}
                  disabled={busy}
                  onChange={(v) => updateNotifNested('webNotifications', 'enabled', v)}
                />
                <ToggleRow
                  label="Play notification sound on web"
                  hint="Use system sound on background alerts"
                  checked={notifSettings.webNotifications?.soundOnWeb !== false}
                  disabled={busy}
                  onChange={(v) => updateNotifNested('webNotifications', 'soundOnWeb', v)}
                />
                <ToggleRow
                  label="Sync read notifications across devices"
                  checked={notifSettings.webNotifications?.syncReadAcrossDevices !== false}
                  disabled={busy}
                  onChange={(v) => updateNotifNested('webNotifications', 'syncReadAcrossDevices', v)}
                />

                <button
                  type="button"
                  className="settings-btn ghost"
                  disabled={busy}
                  onClick={testNotificationSound}
                  style={{ marginTop: '0.5rem' }}
                >
                  Test sound &amp; notification
                </button>
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Notification Priority</h3>
                <p className="settings-section-copy">Choose how notifications appear.</p>

                <PrivacySelect
                  label="Priority"
                  description="How prominently notifications are displayed"
                  value={notifSettings.priority}
                  options={[
                    { value: 'high', label: 'High Priority (pop-up/banner)' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'silent', label: 'Silent' },
                  ]}
                  disabled={busy}
                  onChange={(v) => updateNotifField('priority', v)}
                />
              </div>
            </section>
          )}
          {tab === 'security' && (
            <section className="settings-section">
              <div className="settings-fieldset">
                <h3 className="settings-section-title">Change password</h3>
                <label className="settings-field">
                  <span>Current password</span>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </label>
                <label className="settings-field">
                  <span>New password</span>
                  <input
                    type="password"
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <button
                  type="button"
                  className="settings-btn primary"
                  disabled={busy || !currentPassword || newPassword.length < 8}
                  onClick={changePassword}
                >
                  Update password
                </button>
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Two-factor authentication</h3>
                <p className="settings-section-copy">
                  {user?.totpEnabled
                    ? 'TOTP is enabled. You will need an authenticator code when signing in.'
                    : 'Add an authenticator app (Google Authenticator, Authy, etc.) for login.'}
                </p>
                {!user?.totpEnabled && !totpSetup && (
                  <button
                    type="button"
                    className="settings-btn primary"
                    disabled={totpBusy}
                    onClick={start2faSetup}
                  >
                    {totpBusy ? 'Preparing…' : 'Enable 2FA'}
                  </button>
                )}
                {!user?.totpEnabled && totpSetup && (
                  <>
                    <p className="settings-section-copy">
                      Scan this otpauth URL in your authenticator, or enter the secret manually:
                    </p>
                    <code className="settings-section-copy" style={{ display: 'block', wordBreak: 'break-all' }}>
                      {totpSetup.secret}
                    </code>
                    <p className="settings-section-copy" style={{ fontSize: 12, opacity: 0.75, wordBreak: 'break-all' }}>
                      {totpSetup.otpauthUrl}
                    </p>
                    <label className="settings-field">
                      <span>Verification code</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        autoComplete="one-time-code"
                      />
                    </label>
                    <div className="settings-key-actions">
                      <button
                        type="button"
                        className="settings-btn primary"
                        disabled={totpBusy || totpCode.length !== 6}
                        onClick={confirmEnable2fa}
                      >
                        Confirm &amp; enable
                      </button>
                      <button
                        type="button"
                        className="settings-btn ghost"
                        disabled={totpBusy}
                        onClick={() => {
                          setTotpSetup(null);
                          setTotpCode('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
                {user?.totpEnabled && (
                  <>
                    <label className="settings-field">
                      <span>Password</span>
                      <input
                        type="password"
                        value={totpPassword}
                        onChange={(e) => setTotpPassword(e.target.value)}
                        autoComplete="current-password"
                      />
                    </label>
                    <label className="settings-field">
                      <span>Authenticator code</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        autoComplete="one-time-code"
                      />
                    </label>
                    <button
                      type="button"
                      className="settings-btn ghost"
                      disabled={totpBusy || !totpPassword || totpCode.length !== 6}
                      onClick={confirmDisable2fa}
                    >
                      Disable 2FA
                    </button>
                  </>
                )}
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Linked devices</h3>
                <p className="settings-section-copy">
                  Manage the devices connected to your account. Revoking signs that device out conceptually.
                </p>
                <div className="settings-key-actions" style={{ marginBottom: 12 }}>
                  <button type="button" className="settings-btn primary" onClick={openDeviceLinkModal} disabled={deviceLinkLoading}>
                    {deviceLinkLoading ? 'Preparing…' : '+ Link a new device'}
                  </button>
                  <button type="button" className="settings-btn ghost" onClick={refreshDeviceSessions} disabled={deviceLinkRefreshing}>
                    {deviceLinkRefreshing ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
                {deviceLinkStatusText ? <p className="settings-section-copy">{deviceLinkStatusText}</p> : null}
                {deviceLinkError ? <p className="settings-section-copy" style={{ color: 'var(--danger-color, #d45d5d)' }}>{deviceLinkError}</p> : null}
                {sessions.length === 0 ? (
                  <p className="settings-section-copy">No linked devices yet.</p>
                ) : (
                  sessions.map((s) => {
                    const isCurrent = currentSessionId && s.sessionId === currentSessionId;
                    const label = s.label || 'Unknown device';
                    const browser = s.userAgent ? (s.userAgent.includes('Chrome') ? 'Chrome' : 'Browser') : 'Browser';
                    const os = s.userAgent ? (s.userAgent.includes('Windows') ? 'Windows' : s.userAgent.includes('Android') ? 'Android' : 'Unknown') : 'Unknown';
                    return (
                      <div key={s.sessionId} className="settings-row" style={{ cursor: 'default', alignItems: 'center' }}>
                        <span className="settings-row-left">
                          <span className="settings-row-label">
                            {label}
                            {isCurrent ? ' (this device)' : ''}
                          </span>
                          <span className="settings-row-hint">
                            {browser} · {os}
                            {s.lastSeenAt ? ` · Last active ${new Date(s.lastSeenAt).toLocaleString()}` : ''}
                            {isCurrent ? ' · Current device' : ''}
                          </span>
                        </span>
                        {!isCurrent ? (
                          <button
                            type="button"
                            className="settings-btn ghost"
                            disabled={busy}
                            onClick={() => revokeDeviceSession(s.sessionId)}
                          >
                            Log out
                          </button>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Encrypted key vault</h3>
                <p className="settings-section-copy">
                  Backup your private keys wrapped with a passphrase. The server only stores ciphertext —
                  never plaintext keys.
                  {vaultHasBackup ? ' A vault backup exists for this account.' : ' No vault backup yet.'}
                </p>
                <label className="settings-field">
                  <span>Vault passphrase</span>
                  <input
                    type="password"
                    value={vaultPassphrase}
                    onChange={(e) => setVaultPassphrase(e.target.value)}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                  />
                </label>
                <label className="settings-field">
                  <span>Confirm passphrase</span>
                  <input
                    type="password"
                    value={vaultPassphraseConfirm}
                    onChange={(e) => setVaultPassphraseConfirm(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <div className="settings-key-actions">
                  <button
                    type="button"
                    className="settings-btn primary"
                    disabled={busy || !vaultPassphrase}
                    onClick={backupToVault}
                  >
                    Backup to vault
                  </button>
                  <button
                    type="button"
                    className="settings-btn ghost"
                    disabled={busy || !vaultPassphrase}
                    onClick={restoreFromVault}
                  >
                    Restore from vault
                  </button>
                </div>
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Encryption keys</h3>
                <p className="settings-section-copy">
                  Keys stay on this device. Import a backup to recover old messages, or generate a new set if keys are gone.
                </p>
                {keyringSync?.status === 'synced' && (
                  <p className="settings-section-copy settings-key-sync-ok">
                    Local keyring matches server public keys ({keyringSync.localMatchCount}/{keyringSync.serverKeys.length}).
                  </p>
                )}
                {keyringNeedsResync && (
                  <p className="settings-section-copy settings-key-sync-warn">
                    Local keyring is out of sync with the server ({keyringSync?.localMatchCount ?? 0}/
                    {keyringSync?.serverKeys?.length ?? 5} public keys matched). Regenerate keys to fix sealed stories and new encryption.
                  </p>
                )}
                <div className="settings-key-actions">
                  <button type="button" className="settings-btn ghost" onClick={() => verifyKeySync().catch(() => { })}>
                    Verify key sync
                  </button>
                  <button type="button" className="settings-btn ghost" onClick={() => keyInputRef.current?.click()}>
                    Import keys.txt
                  </button>
                  <input ref={keyInputRef} type="file" accept=".txt" hidden onChange={onImportKeys} />
                  <button type="button" className="settings-btn primary" onClick={onGenerateKeys}>
                    {keyringNeedsResync ? 'Regenerate & resync keys' : 'Generate new keys'}
                  </button>
                </div>
              </div>

              <div className="settings-fieldset">
                <h3 className="settings-section-title">Trust</h3>
                <p className="settings-section-copy">
                  The server relays sealed ciphertext and never holds message plaintext.
                </p>
                <button
                  type="button"
                  className="settings-btn ghost"
                  disabled={blindnessBusy}
                  onClick={loadBlindnessReport}
                >
                  {blindnessBusy ? 'Loading…' : 'View server blindness report'}
                </button>
                {blindnessReport && (
                  <div className="settings-section-copy" style={{ marginTop: '0.75rem' }}>
                    <p>
                      Ciphertexts relayed: <strong>{blindnessReport.ciphertextsRelayed}</strong>
                    </p>
                    <p>
                      Plaintext held: <strong>{blindnessReport.plaintextHeld}</strong>
                    </p>
                    <p>
                      Searchable message index:{' '}
                      <strong>{blindnessReport.searchableMessageIndex ? 'yes' : 'no'}</strong>
                    </p>
                    {blindnessReport.note ? <p>{blindnessReport.note}</p> : null}
                  </div>
                )}
              </div>
            </section>
          )}

          {tab === 'blocked' && (
            <section className="settings-section">
              {blocked.length === 0 ? (
                <p className="settings-section-copy">No blocked users.</p>
              ) : (
                <ul className="group-member-list">
                  {blocked.map((u) => (
                    <li key={u.id}>
                      <div>
                        <strong>{u.displayName || u.username}</strong>
                        <span className="group-member-meta">@{u.username}</span>
                      </div>
                      <button type="button" className="settings-btn ghost" disabled={busy} onClick={() => unblock(u.id)}>
                        Unblock
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {tab === 'data' && (
            <section className="settings-section">
              <p className="settings-section-copy">
                Download account metadata, or export the open conversation decrypted on this device.
              </p>
              <button type="button" className="settings-btn ghost" disabled={busy} onClick={downloadData}>
                Download my data (JSON)
              </button>
              <button type="button" className="settings-btn ghost" disabled={busy || !onExportChat} onClick={() => onExportChat?.()}>
                Export current chat
              </button>

              <div className="settings-danger-zone">
                <h3 className="settings-section-title">Danger zone</h3>
                <p className="settings-section-copy">This permanently removes your account from the server.</p>
                <label className="settings-field">
                  <span>Password to confirm</span>
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </label>
                <button type="button" className="settings-btn danger" disabled={busy} onClick={deleteAccount}>
                  Delete account
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
      <DeviceLinkSetupModal
        open={deviceLinkSetupModalOpen}
        qrDataUrl={deviceLinkQr}
        loading={deviceLinkLoading}
        statusText={deviceLinkStatusText}
        error={deviceLinkError}
        timeLeft={deviceLinkExpiresAt ? Math.max(0, new Date(deviceLinkExpiresAt).getTime() - Date.now()) : 0}
        onClose={closeDeviceLinkSetupModal}
      />
      <DeviceLinkRequestModal
        open={deviceLinkModalOpen}
        request={deviceLinkRequest}
        busy={deviceLinkLoading || deviceLinkBusy}
        onApprove={confirmDeviceLinkApprove}
        onReject={confirmDeviceLinkReject}
        onClose={closeDeviceLinkModal}
      />
    </div>
  );
}