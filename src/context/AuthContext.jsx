import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import client from '../api/client.js';
import { generateKeySet, derivePublicKey, KEY_SET_SIZE } from '../crypto/keys.js';
import {
  addKeySetToRing,
  hasKeyring,
  getKeyringSyncStatus,
  keyringMatchesPublishedKeys,
  saveSession,
  getStoredUser,
  clearSession,
  clearKeyring,
  getToken,
} from '../crypto/keyStorage.js';
import { connectSocket, disconnectSocket } from '../api/socket.js';

const AuthContext = createContext(null);

function clearOtherAccountKeyring(loggedInUserId) {
  const previous = getStoredUser();
  if (previous?.id && String(previous.id) !== String(loggedInUserId)) {
    clearKeyring(previous.id);
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser());
  const [keyringSync, setKeyringSync] = useState(null);

  const recomputeKeyringSync = useCallback((nextUser) => {
    if (!nextUser?.id || !nextUser.publicKeys?.length) {
      setKeyringSync(null);
      return null;
    }
    const sync = getKeyringSyncStatus(nextUser.id, nextUser.publicKeys);
    setKeyringSync(sync);
    return sync;
  }, []);

  const refreshUserFromServer = useCallback(async () => {
    if (!getToken()) return null;
    const { data } = await client.get('/auth/me');
    const freshUser = data.data?.user;
    if (!freshUser) return null;
    saveSession(getToken(), freshUser);
    setUser(freshUser);
    recomputeKeyringSync(freshUser);
    return freshUser;
  }, [recomputeKeyringSync]);

  /** Fetch server-advertised public keys only (GET /users/me/public-keys) and compare to local keyring. */
  const verifyKeySync = useCallback(async () => {
    if (!getToken()) return null;
    const { data } = await client.get('/users/me/public-keys');
    const { publicKeys, keyRotatedAt } = data.data || {};
    const stored = getStoredUser();
    const freshUser = stored ? { ...stored, publicKeys, keyRotatedAt } : null;
    if (freshUser?.id) {
      saveSession(getToken(), freshUser);
      setUser(freshUser);
      return recomputeKeyringSync(freshUser);
    }
    return null;
  }, [recomputeKeyringSync]);

  useEffect(() => {
    if (!user?.id) {
      setKeyringSync(null);
      return;
    }
    recomputeKeyringSync(user);
    if (getToken()) {
      refreshUserFromServer().catch(() => {});
    }
  }, [user?.id, recomputeKeyringSync, refreshUserFromServer]);

  const register = useCallback(
    async ({ username, email, password }) => {
      const keySet = generateKeySet();
      const publicKeys = keySet.map((k) => k.publicKey);
      // Validate localStorage works before creating a server account whose keys we must store here.
      try {
        const probeKey = 'qc_keyring_probe_' + Date.now();
        localStorage.setItem(probeKey, '1');
        localStorage.removeItem(probeKey);
      } catch (err) {
        throw new Error('Cannot save keys to localStorage: ' + err.message);
      }

      const { data } = await client.post('/auth/register', { username, email, password, publicKeys });
Quantum-Frontend-Intern
      const { token, user: newUser, sessionId } = data.data;

      const { token, user: newUser } = data.data;
 main

      // CRITICAL: persist private keys before anything else that could navigate away.
      try {
        addKeySetToRing(newUser.id, keySet);
      } catch (err) {
        throw new Error(
          'Account was created but encryption keys could not be saved on this device. Log in and use "Generate new keys" to resync.'
        );
      }

 Quantum-Frontend-Intern
      saveSession(token, newUser, sessionId);
      setUser(newUser);
      recomputeKeyringSync(newUser);
      connectSocket();
      // The caller (Register.jsx) needs the raw secret keys once, right here,
      // to offer a backup download — they're never retrievable from the
      // server or exposed anywhere else afterward.

      saveSession(token, newUser);
      setUser(newUser);
      recomputeKeyringSync(newUser);
      connectSocket();
 main
      return { user: newUser, keySet };
    },
    [recomputeKeyringSync]
  );

  // Private keys stay on this device across logins. We only clear another
  // account's keyring when switching users, so the same account does not
  // re-prompt for keys.txt every session.
  const login = useCallback(async ({ email, password }) => {
    const deviceLabel = String(navigator.userAgent || '').slice(0, 120);
    const { data } = await client.post('/auth/login', { email, password, deviceLabel });
    if (data.data?.requires2fa) {
      return { requires2fa: true, tempToken: data.data.tempToken };
    }
    const { token, user: loggedInUser, sessionId } = data.data;
    clearOtherAccountKeyring(loggedInUser.id);
    saveSession(token, loggedInUser, sessionId);
    setUser(loggedInUser);
    connectSocket();
    return loggedInUser;
  }, []);

  const verify2fa = useCallback(async ({ tempToken, token }) => {
    const deviceLabel = String(navigator.userAgent || '').slice(0, 120);
    const { data } = await client.post('/auth/2fa/verify', { tempToken, token, deviceLabel });
    const { token: jwt, user: loggedInUser, sessionId } = data.data;
    clearOtherAccountKeyring(loggedInUser.id);
    saveSession(jwt, loggedInUser, sessionId);
    setUser(loggedInUser);
    connectSocket();
    return loggedInUser;
  }, []);

  // Generates a fresh 5-key pool, adds it to the local keyring, and
  // publishes it to the server. Used to recover a missing or desynced keyring.
  const regenerateKeys = useCallback(async () => {
    if (!user) throw new Error('Not authenticated');
    const keySet = generateKeySet();
    const publicKeys = keySet.map((k) => k.publicKey);
    // CRITICAL: Save keys to localStorage FIRST, before publishing to server.
    addKeySetToRing(user.id, keySet);
    const { data } = await client.patch('/users/me/public-keys', { publicKeys });
    saveSession(getToken(), data.data);
    setUser(data.data);
    recomputeKeyringSync(data.data);
    return { user: data.data, keySet };
  }, [user, recomputeKeyringSync]);

  const importKeys = useCallback(
    async (secretKeys) => {
      if (!user) throw new Error('Not authenticated');
      if (secretKeys.length !== KEY_SET_SIZE) {
        throw new Error(`Expected ${KEY_SET_SIZE} keys in the file, found ${secretKeys.length}`);
      }
      const freshUser = (await refreshUserFromServer()) || user;
      const accountKeys = new Set(freshUser.publicKeys.map((k) => k.toLowerCase()));
      const keySet = secretKeys.map((secretKey) => ({ secretKey, publicKey: derivePublicKey(secretKey) }));
      const unmatched = keySet.filter((k) => !accountKeys.has(k.publicKey.toLowerCase()));
      if (unmatched.length > 0) {
        throw new Error(
          "These keys don't match this account's current public keys on the server — wrong file, or keys were regenerated since it was saved"
        );
      }
      // Local write only after server keys are fetched and validated (no server publish here).
      addKeySetToRing(freshUser.id, keySet);
      recomputeKeyringSync(freshUser);
      setUser({ ...freshUser });
    },
    [user, refreshUserFromServer, recomputeKeyringSync]
  );

  // Clears the auth session only. Encryption keys stay in localStorage so the
  // next login on this browser can chat without re-importing keys.txt; we
  // still reset the in-memory sync banner state since there's no user to show it for.
  const logout = useCallback(() => {
    clearSession();
    disconnectSocket();
    setUser(null);
    setKeyringSync(null);
  }, []);

  const updateSessionUser = useCallback(
    (nextUser) => {
      if (!nextUser) return;
      saveSession(getToken(), nextUser);
      setUser(nextUser);
      recomputeKeyringSync(nextUser);
    },
    [recomputeKeyringSync]
  );

  // True when this device holds secret keys for every currently published
  // public key (the strict check); falls back to "has any local keyring at
  // all" before the server's publicKeys have loaded, so the UI doesn't flash
  // "no keys" during the first render.
  const hasLocalKeyring = user
    ? user.publicKeys?.length
      ? keyringMatchesPublishedKeys(user.id, user.publicKeys)
      : hasKeyring(user.id)
    : false;

  const keyringInSync = keyringSync?.status === 'synced';
  const keyringNeedsResync = Boolean(
    user && hasLocalKeyring && keyringSync && keyringSync.status !== 'synced' && keyringSync.status !== 'unknown'
  );

  const value = useMemo(
    () => ({
      user,
      register,
      login,
      verify2fa,
      logout,
      regenerateKeys,
      importKeys,
      hasLocalKeyring,
      keyringSync,
      keyringInSync,
      keyringNeedsResync,
      refreshUserFromServer,
      verifyKeySync,
      updateSessionUser,
    }),
    [
      user,
      register,
      login,
      verify2fa,
      logout,
      regenerateKeys,
      importKeys,
      hasLocalKeyring,
      keyringSync,
      keyringInSync,
      keyringNeedsResync,
      refreshUserFromServer,
      verifyKeySync,
      updateSessionUser,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}