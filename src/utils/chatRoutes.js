import {
  conversationKeyForGroup,
  conversationKeyForUser,
} from './readState.js';

/**
 * Chat URL helpers — deep links for DMs and groups.
 */

export function chatPathForSelection(selected) {
  if (!selected?.id) return '/chat';
  if (selected.type === 'group') return `/chat/g/${selected.id}`;
  return `/chat/${selected.id}`;
}

export function selectionFromParams(params, conversations = []) {
  const groupId = params?.groupId;
  const peerId = params?.peerId;
  if (groupId) {
    const found = conversations.find(
      (c) => c.type === 'group' && String(c.id) === String(groupId),
    );
    if (found) return found;
    return {
      key: conversationKeyForGroup(groupId),
      type: 'group',
      id: groupId,
      title: 'Group',
      subtitle: null,
      group: { id: groupId, members: [] },
    };
  }
  if (peerId && peerId !== 'settings') {
    const found = conversations.find(
      (c) => c.type === 'dm' && String(c.id) === String(peerId),
    );
    if (found) return found;
    return {
      key: conversationKeyForUser(peerId),
      type: 'dm',
      id: peerId,
      title: 'Chat',
      subtitle: null,
      peer: { id: peerId },
    };
  }
  return null;
}

export function settingsPath(tab) {
  return tab ? `/chat/settings/${tab}` : '/chat/settings';
}
