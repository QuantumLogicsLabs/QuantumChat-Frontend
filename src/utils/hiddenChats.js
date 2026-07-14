const HIDDEN_PREFIX = 'qc_hidden_chats_';

function storageKey(userId) {
  return HIDDEN_PREFIX + userId;
}

export function getHiddenChatIds(userId) {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function hideChat(userId, peerId) {
  if (!userId || !peerId) return getHiddenChatIds(userId);
  const next = new Set(getHiddenChatIds(userId));
  next.add(String(peerId));
  const list = [...next];
  localStorage.setItem(storageKey(userId), JSON.stringify(list));
  return list;
}

export function unhideChat(userId, peerId) {
  if (!userId || !peerId) return getHiddenChatIds(userId);
  const list = getHiddenChatIds(userId).filter((id) => id !== String(peerId));
  localStorage.setItem(storageKey(userId), JSON.stringify(list));
  return list;
}
