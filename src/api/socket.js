import { io } from 'socket.io-client';
import { getToken } from '../crypto/keyStorage.js';

let socket = null;

export function connectSocket() {
  if (socket) return socket;
  socket = io(import.meta.env.VITE_API_URL || 'http://localhost:5000', {
    auth: { token: getToken() },
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
