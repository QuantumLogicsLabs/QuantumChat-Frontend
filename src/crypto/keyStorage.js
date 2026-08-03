const KEYRING_PREFIX = 'qc_keyring_';
const TOKEN_KEY = 'qc_token';
const USER_KEY = 'qc_user';
const SESSION_ID_KEY = 'qc_session_id';

// Each user's keyring is an append-only list of every X25519 keypair this
// device has ever held for them: [{ publicKey, secretKey, createdAt }, ...].
// The server advertises one fixed 5-key pool per account (set at register or
// via regenerateKeys); older pools stay in the ring so history sealed to
// prior keys remains decryptable. Nothing here ever leaves localStorage.
function keyringKey(userId) {
  return KEYRING_PREFIX + userId;
}

export function getKeyring(userId) {
  const raw = localStorage.getItem(keyringKey(userId));
  return raw ? JSON.parse(raw) : [];
}

export function addKeyToRing(userId, { publicKey, secretKey }) {
  const ring = getKeyring(userId);
  ring.push({ publicKey: publicKey.toLowerCase(), secretKey, createdAt: Date.now() });
  localStorage.setItem(keyringKey(userId), JSON.stringify(ring));
}

// Keys are generated and rotated in pools of 5 (see generateKeySet in
// crypto/keys.js) — this adds a whole pool at once, all sharing the same
// createdAt so they're recognizable as one "generation" later.
export function addKeySetToRing(userId, keyPairs) {
  const ring = getKeyring(userId);
  const createdAt = Date.now();
  keyPairs.forEach(({ publicKey, secretKey }) => {
    ring.push({ publicKey: publicKey.toLowerCase(), secretKey, createdAt });
  });
  localStorage.setItem(keyringKey(userId), JSON.stringify(ring));
}

export function getCurrentKeyPair(userId) {
  const ring = getKeyring(userId);
  return ring.length ? ring[ring.length - 1] : null;
}

// The most recently added pool of `size` keys — i.e. this device's current
// set of live, server-advertised keypairs, as opposed to retired ones kept
// around only to decrypt old history.
export function getCurrentKeySet(userId, size = 5) {
  const ring = getKeyring(userId);
  return ring.slice(-size);
}

export function findSecretKeyForPublicKey(userId, publicKeyHex) {
  if (!publicKeyHex) return null;
  const target = publicKeyHex.toLowerCase();
  const match = getKeyring(userId).find((k) => k.publicKey === target);
  return match ? match.secretKey : null;
}

export function hasKeyring(userId) {
  return getKeyring(userId).length > 0;
}

/**
 * True when this device already holds secret keys for every currently
 * published public key — i.e. chat/stories can unlock without re-importing
 * keys.txt or regenerating.
 */
export function keyringMatchesPublishedKeys(userId, serverPublicKeys) {
  const serverKeys = (serverPublicKeys || []).map((k) => String(k).toLowerCase()).filter(Boolean);
  if (!serverKeys.length) return false;
  return serverKeys.every((pub) => Boolean(findSecretKeyForPublicKey(userId, pub)));
}

/**
 * Compare server-advertised public keys with secrets held locally, returning
 * a detailed status ('synced' | 'partial' | 'mismatch' | 'unknown') plus
 * which server keys are missing locally — used to drive the sync banner/UI.
 */
export function getKeyringSyncStatus(userId, serverPublicKeys) {
  const serverKeys = (serverPublicKeys || []).map((k) => String(k).toLowerCase()).filter(Boolean);
  if (!serverKeys.length) {
    return { status: 'unknown', missingOnLocal: [], serverKeys: [], localMatchCount: 0 };
  }
  const missingOnLocal = serverKeys.filter((pub) => !findSecretKeyForPublicKey(userId, pub));
  const localMatchCount = serverKeys.length - missingOnLocal.length;
  if (localMatchCount === 0) {
    return { status: 'mismatch', missingOnLocal, serverKeys, localMatchCount };
  }
  if (missingOnLocal.length > 0) {
    return { status: 'partial', missingOnLocal, serverKeys, localMatchCount };
  }
  return { status: 'synced', missingOnLocal: [], serverKeys, localMatchCount };
}

// Wipes this device's copy of the user's private keys. Used when switching
// accounts on the same browser, or when local keys no longer match the
// account's published pool (e.g. regenerated on another device). Not called
// on logout — encryption keys stay in localStorage so the next login on this
// browser can chat without re-importing keys.txt.
export function clearKeyring(userId) {
  localStorage.removeItem(keyringKey(userId));
}

export function saveSession(token, user, sessionId) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (sessionId) {
    localStorage.setItem(SESSION_ID_KEY, sessionId);
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getSessionId() {
  return localStorage.getItem(SESSION_ID_KEY);
}

export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw);
    if (!user || typeof user !== 'object' || !user.id) {
      clearSession();
      return null;
    }
    return user;
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(SESSION_ID_KEY);
}