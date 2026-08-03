import { io } from 'socket.io-client';
import { getToken } from '../crypto/keyStorage.js';
import { getApiBaseUrl } from './baseUrl.js';

let socket = null;

/**
 * Preferred signaling target is the dedicated always-on bot (see calling-bot/),
 * which is separate from the Vercel-hosted API — a stateless serverless
 * function that can't hold a persistent Socket.IO connection.
 *
 * When VITE_SIGNAL_URL isn't set we fall back to the API origin, because in
 * local dev `backend/server.js` does run Socket.IO — so `npm run dev` keeps
 * working (presence, typing, message push) with no extra setup. A serverless
 * *.vercel.app API has no Socket.IO at all, so we skip connecting there and
 * let the REST polling fallback handle messages and call signaling.
 */
export function getSignalUrl() {
  const configured = String(import.meta.env.VITE_SIGNAL_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;

  const api = getApiBaseUrl();
  if (/vercel\.app/i.test(api)) return '';
  return api;
}

export function connectSocket() {
  if (socket) return socket;

  const url = getSignalUrl();
  if (!url) return null;

  socket = io(url, {
    auth: { token: getToken() },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    timeout: 8000,
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}
