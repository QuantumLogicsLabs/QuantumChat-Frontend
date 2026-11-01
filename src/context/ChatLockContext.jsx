import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import client from '../api/client.js';
import {
  getChatLockStatus,
  setChatLockPin as apiSetPin,
  verifyChatLockPin,
  disableChatLock as apiDisable,
  lockChatRequest,
  unlockChatRequest,
  relockChats,
} from '../api/chatLock.js';
import { setLockedConversationKeys } from '../api/chatLockToken.js';
import { useAuth } from './AuthContext.jsx';

const ChatLockContext = createContext(null);

// The UI keys a direct chat as "dm:<peerId>", but the server keys it as
// "dm:<idA>:<idB>" (both ids, sorted). Locks are stored under the server key,
// so convert in both directions. Group keys ("group:<id>") are identical.
function toServerKey(key, myId) {
  const k = String(key ?? '');
  if (!k.startsWith('dm:')) return k;
  const parts = k.slice(3).split(':');
  if (parts.length === 1 && parts[0] && myId) return `dm:${[String(myId), parts[0]].sort().join(':')}`;
  return k;
}

function toClientKey(key, myId) {
  const k = String(key ?? '');
  if (!k.startsWith('dm:')) return k;
  const parts = k.slice(3).split(':');
  if (parts.length === 2) {
    const peer = parts.find((id) => id !== String(myId)) || parts[0];
    return `dm:${peer}`;
  }
  return k;
}

// Server token lives 10 minutes; relock a little earlier so the UI never
// claims "unlocked" while the server would already answer 423.
const UNLOCK_MS = 9 * 60 * 1000;
// Relock when the tab has been in the background this long.
const BACKGROUND_RELOCK_MS = 60 * 1000;

export function ChatLockProvider({ children }) {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [lockedKeys, setLockedKeys] = useState([]);
  const [isUnlocked, setIsUnlocked] = useState(false);
  // False until the first status fetch finishes, so the UI doesn't show a
  // locked chat's messages during the moment before we know it is locked.
  const [ready, setReady] = useState(false);
  const myId = user?.id ? String(user.id) : '';
  const timerRef = useRef(null);
  const lockedKeysRef = useRef([]);
  const hiddenAtRef = useRef(null);

  // `keys` are SERVER keys. The module-level set also gets the UI form
  // ("dm:<peerId>") so plain code like notificationDispatch can match on it.
  const applyKeys = useCallback(
    (keys) => {
      const list = (Array.isArray(keys) ? keys : []).map(String);
      setLockedKeys(list);
      setLockedConversationKeys([...list, ...list.map((k) => toClientKey(k, myId))]);
    },
    [myId]
  );

  lockedKeysRef.current = lockedKeys;

  const lock = useCallback(() => {
    clearTimeout(timerRef.current);
    relockChats();
    setIsUnlocked(false);
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!user?.id) {
      setEnabled(false);
      applyKeys([]);
      lock();
      setReady(true);
      return null;
    }
    try {
      const { data } = await getChatLockStatus();
      setEnabled(Boolean(data?.chatLockEnabled));
      applyKeys(data?.lockedChats || []);
      return data;
    } catch {
      return null;
    } finally {
      setReady(true);
    }
  }, [user?.id, applyKeys, lock]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Different user / logout: never carry an unlock over.
  useEffect(() => {
    if (!user?.id) lock();
  }, [user?.id, lock]);

  // Relock after a stretch in the background.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
      } else {
        const hiddenAt = hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (hiddenAt && Date.now() - hiddenAt >= BACKGROUND_RELOCK_MS) lock();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [lock]);

  // If the server ever answers "locked" (token expired, cleared elsewhere),
  // drop back to the locked state so the PIN prompt reappears.
  useEffect(() => {
    const id = client.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err?.response?.status === 423 && err.response?.data?.code === 'CHAT_LOCKED') lock();
        return Promise.reject(err);
      }
    );
    return () => client.interceptors.response.eject(id);
  }, [lock]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const unlock = useCallback(
    async (pin) => {
      await verifyChatLockPin(pin);
      setIsUnlocked(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(lock, UNLOCK_MS);
    },
    [lock]
  );

  const setPin = useCallback(
    async ({ pin, currentPin }) => {
      await apiSetPin({ pin, currentPin });
      setEnabled(true);
    },
    []
  );

  const disable = useCallback(
    async (pin) => {
      await apiDisable(pin);
      setEnabled(false);
      applyKeys([]);
      lock();
    },
    [applyKeys, lock]
  );

  const lockChat = useCallback(
    async (conversationKey) => {
      const serverKey = toServerKey(conversationKey, myId);
      await lockChatRequest(serverKey);
      const next = lockedKeysRef.current.includes(serverKey)
        ? lockedKeysRef.current
        : [...lockedKeysRef.current, serverKey];
      applyKeys(next);
    },
    [myId, applyKeys]
  );

  const unlockChat = useCallback(
    async (conversationKey, pin) => {
      const serverKey = toServerKey(conversationKey, myId);
      await unlockChatRequest({ conversationKey: serverKey, pin });
      applyKeys(lockedKeysRef.current.filter((k) => k !== serverKey));
    },
    [myId, applyKeys]
  );

  const isChatLocked = useCallback(
    (key) => key != null && lockedKeys.includes(toServerKey(key, myId)),
    [lockedKeys, myId]
  );

  const value = useMemo(
    () => ({
      enabled,
      ready,
      lockedKeys,
      isUnlocked,
      isChatLocked,
      unlock,
      lock,
      setPin,
      disable,
      lockChat,
      unlockChat,
      refreshStatus,
    }),
    [enabled, ready, lockedKeys, isUnlocked, isChatLocked, unlock, lock, setPin, disable, lockChat, unlockChat, refreshStatus]
  );

  return <ChatLockContext.Provider value={value}>{children}</ChatLockContext.Provider>;
}

export function useChatLock() {
  const ctx = useContext(ChatLockContext);
  if (!ctx) throw new Error('useChatLock must be used inside ChatLockProvider');
  return ctx;
}
