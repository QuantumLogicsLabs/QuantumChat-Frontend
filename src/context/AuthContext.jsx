import { createContext, useContext, useState, useCallback } from 'react';
import client from '../api/client.js';
import { generateKeyPair } from '../crypto/keys.js';
import {
  addKeyToRing,
  getCurrentKeyPair,
  hasKeyring,
  saveSession,
  getStoredUser,
  clearSession,
  getToken,
} from '../crypto/keyStorage.js';
import { connectSocket, disconnectSocket } from '../api/socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser());

  const register = useCallback(async ({ username, email, password }) => {
    const { publicKey, secretKey } = generateKeyPair();
    const { data } = await client.post('/auth/register', { username, email, password, publicKey });
    const { token, user: newUser } = data.data;
    addKeyToRing(newUser.id, { publicKey, secretKey });
    saveSession(token, newUser);
    setUser(newUser);
    connectSocket();
    return newUser;
  }, []);

  const login = useCallback(async ({ email, password }) => {
    const { data } = await client.post('/auth/login', { email, password });
    const { token, user: loggedInUser } = data.data;
    saveSession(token, loggedInUser);
    setUser(loggedInUser);
    connectSocket();
    return loggedInUser;
  }, []);

  // Generates a fresh keypair, adds it to the local keyring, and publishes
  // the new public key to the server. Used both for the automatic 30-minute
  // rotation and to recover a missing keyring on a new/wiped device — in the
  // latter case, history encrypted under prior keys stays unreadable unless
  // this device already held those keys, which is the expected E2E tradeoff.
  const rotateKey = useCallback(async () => {
    if (!user) throw new Error('Not authenticated');
    const { publicKey, secretKey } = generateKeyPair();
    const { data } = await client.patch('/users/me/public-key', { publicKey });
    addKeyToRing(user.id, { publicKey, secretKey });
    saveSession(getToken(), data.data);
    setUser(data.data);
    return data.data;
  }, [user]);

  const logout = useCallback(() => {
    clearSession();
    disconnectSocket();
    setUser(null);
  }, []);

  const hasLocalKeyring = user ? hasKeyring(user.id) : false;
  const currentKeyPair = user ? getCurrentKeyPair(user.id) : null;

  return (
    <AuthContext.Provider value={{ user, register, login, logout, rotateKey, hasLocalKeyring, currentKeyPair }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
