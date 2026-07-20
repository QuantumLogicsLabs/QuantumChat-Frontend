import { createContext, useContext, useState, useCallback } from 'react';
import client from '../api/client.js';
import { generateKeySet, derivePublicKey, KEY_SET_SIZE } from '../crypto/keys.js';
import {
  addKeySetToRing,
  hasKeyring,
  saveSession,
  getStoredUser,
  clearSession,
  clearKeyring,
  getToken,
} from '../crypto/keyStorage.js';
import { connectSocket, disconnectSocket } from '../api/socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser());

  const register = useCallback(async ({ username, email, password }) => {
    const keySet = generateKeySet();
    const publicKeys = keySet.map((k) => k.publicKey);
    const { data } = await client.post('/auth/register', { username, email, password, publicKeys });
    const { token, user: newUser } = data.data;
    addKeySetToRing(newUser.id, keySet);
    saveSession(token, newUser);
    setUser(newUser);
    connectSocket();
    // The caller (Register.jsx) needs the raw secret keys once, right here,
    // to offer a backup download — they're never retrievable from the
    // server or exposed anywhere else afterward.
    return { user: newUser, keySet };
  }, []);

  // Private keys never leave the client. Each successful login clears any
  // cached keyring for this account (and the previous session's user if
  // different) so Chat always requires importing the keys.txt that belongs
  // to this specific account — wrong-file imports are rejected by importKeys.
  const login = useCallback(async ({ email, password }) => {
    const deviceLabel = String(navigator.userAgent || '').slice(0, 120);
    const { data } = await client.post('/auth/login', { email, password, deviceLabel });
    if (data.data?.requires2fa) {
      return { requires2fa: true, tempToken: data.data.tempToken };
    }
    const { token, user: loggedInUser, sessionId } = data.data;
    const previous = getStoredUser();
    if (previous?.id && String(previous.id) !== String(loggedInUser.id)) {
      clearKeyring(previous.id);
    }
    clearKeyring(loggedInUser.id);
    saveSession(token, loggedInUser, sessionId);
    setUser(loggedInUser);
    connectSocket();
    return loggedInUser;
  }, []);

  const verify2fa = useCallback(async ({ tempToken, token }) => {
    const deviceLabel = String(navigator.userAgent || '').slice(0, 120);
    const { data } = await client.post('/auth/2fa/verify', { tempToken, token, deviceLabel });
    const { token: jwt, user: loggedInUser, sessionId } = data.data;
    const previous = getStoredUser();
    if (previous?.id && String(previous.id) !== String(loggedInUser.id)) {
      clearKeyring(previous.id);
    }
    clearKeyring(loggedInUser.id);
    saveSession(jwt, loggedInUser, sessionId);
    setUser(loggedInUser);
    connectSocket();
    return loggedInUser;
  }, []);

  // Generates a fresh 5-key pool, adds it to the local keyring, and
  // publishes it to the server. Only used to recover a missing keyring on a
  // new/wiped device with no keys.txt backup — history encrypted under the
  // prior keys stays unreadable unless this device already held them, which
  // is the expected E2E tradeoff.
  const regenerateKeys = useCallback(async () => {
    if (!user) throw new Error('Not authenticated');
    const keySet = generateKeySet();
    const publicKeys = keySet.map((k) => k.publicKey);
    const { data } = await client.patch('/users/me/public-keys', { publicKeys });
    addKeySetToRing(user.id, keySet);
    saveSession(getToken(), data.data);
    setUser(data.data);
    return { user: data.data, keySet };
  }, [user]);

  // Imports private keys recovered from a keys.txt backup (a different
  // device or a re-installed browser). Each secret key deterministically
  // derives one public key — validating that all 5 derived keys match the
  // account's actual published publicKeys means this can't silently accept
  // a wrong, corrupted, or stale file, unlike just trusting the upload.
  const importKeys = useCallback(
    (secretKeys) => {
      if (!user) throw new Error('Not authenticated');
      if (secretKeys.length !== KEY_SET_SIZE) {
        throw new Error(`Expected ${KEY_SET_SIZE} keys in the file, found ${secretKeys.length}`);
      }
      const accountKeys = new Set(user.publicKeys.map((k) => k.toLowerCase()));
      const keySet = secretKeys.map((secretKey) => ({ secretKey, publicKey: derivePublicKey(secretKey) }));
      const unmatched = keySet.filter((k) => !accountKeys.has(k.publicKey.toLowerCase()));
      if (unmatched.length > 0) {
        throw new Error("These keys don't match this account's current public keys — wrong file, or keys were regenerated since it was saved");
      }
      addKeySetToRing(user.id, keySet);
      setUser({ ...user }); // new reference so hasLocalKeyring recomputes
    },
    [user]
  );

  // Wipes this device's private keys along with the session — the next
  // login lands with an empty keyring, so the "no local keyring" gate in
  // Chat.jsx always requires re-importing keys.txt (or generating a fresh
  // pool) rather than the old keys silently persisting in localStorage.
  const logout = useCallback(() => {
    if (user) clearKeyring(user.id);
    clearSession();
    disconnectSocket();
    setUser(null);
  }, [user]);

  const updateSessionUser = useCallback((nextUser) => {
    if (!nextUser) return;
    saveSession(getToken(), nextUser);
    setUser(nextUser);
  }, []);

  const hasLocalKeyring = user ? hasKeyring(user.id) : false;

  return (
    <AuthContext.Provider
      value={{ user, register, login, verify2fa, logout, regenerateKeys, importKeys, hasLocalKeyring, updateSessionUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
