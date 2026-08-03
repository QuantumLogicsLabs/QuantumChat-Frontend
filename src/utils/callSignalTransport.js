import { getSocket } from '../api/socket.js';
import client from '../api/client.js';
import { sealMessage, unsealMessage, pickRandom } from '../crypto/keys.js';
import { findSecretKeyForPublicKey } from '../crypto/keyStorage.js';

// Shared by useWebRTCCall (1:1 DM calls) and useMeetingCall (group meetings) —
// both seal call/meeting signaling the same way and fall back to the same
// REST endpoint when the socket isn't connected.

/**
 * VITE_TURN_URL accepts a comma-separated list so one provider can be reached
 * over several ports. This matters: UDP 3478 is the fast path, TCP 3478 covers
 * networks that block UDP, and TLS 443 is usually the only thing that gets out
 * of restrictive corporate/hotel firewalls. All entries share one credential
 * pair, which is how TURN providers issue them.
 */
const TURN_URLS = String(import.meta.env.VITE_TURN_URL || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

export const ICE_SERVERS = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun.cloudflare.com:3478',
    ],
  },
  ...(TURN_URLS.length
    ? [
        {
          urls: TURN_URLS,
          username: import.meta.env.VITE_TURN_USERNAME || '',
          credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
        },
      ]
    : []),
];

export function newSignalId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sealForPeer(peerPublicKeys, payload) {
  const keys = (peerPublicKeys || []).filter(Boolean);
  if (!keys.length) throw new Error('Missing peer public keys for sealed call signaling');
  return sealMessage(JSON.stringify(payload), pickRandom(keys));
}

export function unsealCallEnvelope(envelope, userId) {
  if (!envelope?.targetPublicKey) return null;
  const secret = findSecretKeyForPublicKey(userId, envelope.targetPublicKey);
  if (!secret) return null;
  const text = unsealMessage(envelope, secret);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Seals `payload` for `peerKeys` and sends it as `eventName` over the socket
 * if connected, otherwise via the /call-signals REST fallback. `callId` also
 * carries a meeting's meetingId — meetings reuse the same wire field rather
 * than introducing a parallel identifier/schema.
 */
export async function emitSealedEnvelope(eventName, { to, callId, payload, peerKeys }) {
  const envelope = sealForPeer(peerKeys, payload);
  const socket = getSocket();
  if (socket?.connected) {
    socket.emit(eventName, { to, callId, envelope });
    return;
  }
  try {
    await client.post('/call-signals', { to, callId, event: eventName, envelope });
  } catch (err) {
    // Callers routinely .catch(() => {}) these (ICE especially), which used to
    // hide the failure that actually breaks the call. Say it out loud.
    warnSignalFailure(`send ${eventName}`, err);
    throw err;
  }
}

let lastWarnKey = '';
function warnSignalFailure(action, err) {
  const status = err?.response?.status;
  const key = `${action}:${status || err?.code || 'network'}`;
  if (key === lastWarnKey) return; // don't spam once per 900ms tick
  lastWarnKey = key;

  if (status === 429) {
    console.warn(
      `[call] ${action} was rate limited (429). Call signaling will stall — ` +
        'ICE candidates are being dropped, so the call stays on "connecting".'
    );
  } else if (status) {
    console.warn(`[call] ${action} failed with HTTP ${status}.`);
  } else {
    console.warn(`[call] ${action} failed to reach the API (${err?.message || 'network error'}).`);
  }
}

// --- Shared REST-fallback poller -------------------------------------------
//
// Multiple call hooks (DM + meeting) can be mounted at the same time, all
// needing the same /call-signals stream when the socket is down. Running one
// 900ms poll per hook would multiply the request rate and risk exceeding the
// backend's callSignalLimiter (120/min); instead every hook registers its
// event handlers here and shares one interval, one cursor, and one
// de-duplication set.

let cursor = null;
let pollTimer = null;
let pollInFlight = false;
let seenSignals = new Set();
const registrations = new Set();

function ensurePolling() {
  if (pollTimer) return;
  pollTimer = window.setInterval(pollRestSignals, 900);
  pollRestSignals();
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollRestSignals() {
  if (pollInFlight || getSocket()?.connected) return;
  pollInFlight = true;
  try {
    const { data } = await client.get('/call-signals', { params: { after: cursor } });
    const payload = data.data || {};
    if (payload.cursor) cursor = payload.cursor;
    for (const signal of payload.signals || []) {
      const signalId = String(signal.id || '');
      if (!signalId || seenSignals.has(signalId)) continue;
      seenSignals.add(signalId);
      if (signal.createdAt && Date.now() - new Date(signal.createdAt).getTime() > 45_000) {
        continue;
      }
      for (const { handlers } of registrations) {
        handlers[signal.event]?.(signal);
      }
    }
    if (seenSignals.size > 500) {
      seenSignals = new Set([...seenSignals].slice(-250));
    }
  } catch (err) {
    // Retried on the next interval, but surface it — a sustained 429/DNS
    // failure here means incoming ICE never arrives and calls hang.
    warnSignalFailure('poll /call-signals', err);
  } finally {
    pollInFlight = false;
  }
}

/**
 * Registers `handlers` (a map of eventName -> handler) against the shared
 * REST-fallback poller. Returns an unregister function.
 */
export function registerSignalHandlers(handlers) {
  if (!cursor) cursor = new Date(Date.now() - 45_000).toISOString();
  const registration = { handlers };
  registrations.add(registration);
  ensurePolling();
  return () => {
    registrations.delete(registration);
    if (registrations.size === 0) stopPolling();
  };
}
