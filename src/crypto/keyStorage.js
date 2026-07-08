const KEYRING_PREFIX = 'qc_keyring_';
const TOKEN_KEY = 'qc_token';
const USER_KEY = 'qc_user';

// Each user's keyring is an append-only list of every X25519 keypair this
// device has ever held for them: [{ publicKey, secretKey, createdAt }, ...].
// Keys rotate every 30 minutes, but a message can only ever be decrypted
// with the exact keypair version that was current when it was sent — so old
// keys must be kept, not discarded, for history to stay readable. Nothing
// here ever leaves localStorage.
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

export function getCurrentKeyPair(userId) {
  const ring = getKeyring(userId);
  return ring.length ? ring[ring.length - 1] : null;
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

export function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
