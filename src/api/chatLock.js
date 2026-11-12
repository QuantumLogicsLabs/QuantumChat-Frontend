import client from './client.js';
import { setChatLockToken, clearChatLockToken } from './chatLockToken.js';

export async function getChatLockStatus() {
  const { data } = await client.get('/users/me/chat-lock/status');
  return data;
}

export async function setChatLockPin({ pin, currentPin }) {
  const { data } = await client.post('/users/me/chat-lock/set-pin', { pin, currentPin });
  return data;
}

export async function verifyChatLockPin(pin) {
  const { data } = await client.post('/users/me/chat-lock/verify', { pin });
  const token = data?.data?.chatLockToken;
  if (token) setChatLockToken(token);
  return data;
}

export async function disableChatLock(pin) {
  const { data } = await client.post('/users/me/chat-lock/disable', { pin });
  clearChatLockToken();
  return data;
}

export async function lockChatRequest(conversationKey) {
  const { data } = await client.post('/users/me/chat-lock/lock', { conversationKey });
  return data;
}

export async function unlockChatRequest({ conversationKey, pin }) {
  const { data } = await client.post('/users/me/chat-lock/unlock', { conversationKey, pin });
  return data;
}

export function relockChats() {
  // Client-side only: drop the in-memory token.
  clearChatLockToken();
}
