// In-memory-only holder for the Chat Lock unlock token (same idea as
// vaultToken.js): never persisted, so a reload or closed tab re-locks every
// locked chat. ChatLockContext mirrors this for UI state and is the only
// thing that should call the setters.
//
// This module also remembers which conversation keys are locked, so plain
// (non-React) code such as utils/notificationDispatch.js can check without
// needing the context.

let chatLockToken = null;
let lockedKeys = new Set();

export function getChatLockToken() {
  return chatLockToken;
}

export function setChatLockToken(token) {
  chatLockToken = token || null;
}

export function clearChatLockToken() {
  chatLockToken = null;
}

export function setLockedConversationKeys(keys) {
  lockedKeys = new Set((Array.isArray(keys) ? keys : []).map(String));
}

export function isConversationKeyLocked(key) {
  return key != null && lockedKeys.has(String(key));
}
