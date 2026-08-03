const MUTE_PREFIX = 'qc_muted_chats_';
const ARCHIVE_PREFIX = 'qc_archived_chats_';
const INFO_PANEL_KEY = 'qc_info_panel_open';
const LAST_REACTION_KEY = 'qc_last_quick_reaction';

function readList(prefix, userId) {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(prefix + userId);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeList(prefix, userId, list) {
  localStorage.setItem(prefix + userId, JSON.stringify(list));
  return list;
}

export function getMutedChatKeys(userId) {
  return readList(MUTE_PREFIX, userId);
}

export function isChatMuted(userId, conversationKey) {
  return getMutedChatKeys(userId).includes(String(conversationKey));
}

export function muteChat(userId, conversationKey) {
  const next = new Set(getMutedChatKeys(userId));
  next.add(String(conversationKey));
  return writeList(MUTE_PREFIX, userId, [...next]);
}

export function unmuteChat(userId, conversationKey) {
  return writeList(
    MUTE_PREFIX,
    userId,
    getMutedChatKeys(userId).filter((k) => k !== String(conversationKey))
  );
}

export function toggleMuteChat(userId, conversationKey) {
  if (isChatMuted(userId, conversationKey)) return unmuteChat(userId, conversationKey);
  return muteChat(userId, conversationKey);
}

export function getArchivedChatKeys(userId) {
  return readList(ARCHIVE_PREFIX, userId);
}

export function isChatArchived(userId, conversationKey) {
  return getArchivedChatKeys(userId).includes(String(conversationKey));
}

export function archiveChat(userId, conversationKey) {
  const next = new Set(getArchivedChatKeys(userId));
  next.add(String(conversationKey));
  return writeList(ARCHIVE_PREFIX, userId, [...next]);
}

export function unarchiveChat(userId, conversationKey) {
  return writeList(
    ARCHIVE_PREFIX,
    userId,
    getArchivedChatKeys(userId).filter((k) => k !== String(conversationKey))
  );
}

export function toggleArchiveChat(userId, conversationKey) {
  if (isChatArchived(userId, conversationKey)) return unarchiveChat(userId, conversationKey);
  return archiveChat(userId, conversationKey);
}

export function getInfoPanelOpen() {
  try {
    return localStorage.getItem(INFO_PANEL_KEY) === '1';
  } catch {
    return false;
  }
}

export function setInfoPanelOpen(open) {
  try {
    localStorage.setItem(INFO_PANEL_KEY, open ? '1' : '0');
  } catch {
    /* ignore */
  }
  return Boolean(open);
}

export function getLastQuickReaction() {
  try {
    return localStorage.getItem(LAST_REACTION_KEY) || '❤️';
  } catch {
    return '❤️';
  }
}

export function setLastQuickReaction(emoji) {
  try {
    if (emoji) localStorage.setItem(LAST_REACTION_KEY, String(emoji));
  } catch {
    /* ignore */
  }
  return emoji;
}
