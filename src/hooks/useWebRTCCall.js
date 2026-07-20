import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../api/socket.js';
import { sealMessage, unsealMessage, pickRandom } from '../crypto/keys.js';
import { findSecretKeyForPublicKey } from '../crypto/keyStorage.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function newCallId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sealForPeer(peerPublicKeys, payload) {
  const keys = (peerPublicKeys || []).filter(Boolean);
  if (!keys.length) throw new Error('Missing peer public keys for sealed call signaling');
  return sealMessage(JSON.stringify(payload), pickRandom(keys));
}

function unsealCallEnvelope(envelope, userId) {
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
 * DM WebRTC call state machine.
 * Signaling is X5 sealed-box envelopes; media is peer-to-peer.
 */
export default function useWebRTCCall({ userId, resolvePeerPublicKeys, onMissed } = {}) {
  const [call, setCall] = useState(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const callRef = useRef(null);
  const pendingIceRef = useRef([]);
  const peerKeysCacheRef = useRef(new Map());

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  const getPeerKeys = useCallback(
    async (peerId) => {
      const id = String(peerId);
      if (peerKeysCacheRef.current.has(id)) return peerKeysCacheRef.current.get(id);
      const keys = (await resolvePeerPublicKeys?.(id)) || [];
      peerKeysCacheRef.current.set(id, keys);
      return keys;
    },
    [resolvePeerPublicKeys]
  );

  const emitSealed = useCallback(
    async (eventName, { to, callId, payload }) => {
      const keys = await getPeerKeys(to);
      const envelope = sealForPeer(keys, payload);
      getSocket()?.emit(eventName, { to, callId, envelope });
    },
    [getPeerKeys]
  );

  const cleanupMedia = useCallback(() => {
    pendingIceRef.current = [];
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        /* ignore */
      }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    remoteStreamRef.current = null;
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);
  }, []);

  const endCallLocal = useCallback(() => {
    cleanupMedia();
    setCall(null);
  }, [cleanupMedia]);

  const ensurePc = useCallback(
    (peerId) => {
      if (pcRef.current) return pcRef.current;
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const c = callRef.current;
        if (!c) return;
        emitSealed('call:ice', {
          to: peerId,
          callId: c.callId,
          payload: { type: 'ice', callId: c.callId, candidate: e.candidate.toJSON() },
        }).catch(() => {});
      };

      pc.ontrack = (e) => {
        const stream = e.streams?.[0] || new MediaStream([e.track]);
        remoteStreamRef.current = stream;
        setRemoteStream(stream);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          endCallLocal();
        }
      };

      return pc;
    },
    [endCallLocal, emitSealed]
  );

  const attachLocalMedia = useCallback(async (video) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: Boolean(video),
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const startCall = useCallback(
    async ({ peerId, peerName, video = false }) => {
      if (!peerId || callRef.current) return;
      const callId = newCallId();
      const next = {
        callId,
        peerId: String(peerId),
        peerName: peerName || 'User',
        video: Boolean(video),
        role: 'caller',
        status: 'ringing',
      };
      setCall(next);
      callRef.current = next;
      await emitSealed('call:invite', {
        to: peerId,
        callId,
        payload: { type: 'invite', callId, video: Boolean(video) },
      });
    },
    [emitSealed]
  );

  const acceptCall = useCallback(async () => {
    const c = callRef.current;
    if (!c || c.role !== 'callee') return;
    try {
      const stream = await attachLocalMedia(c.video);
      const pc = ensurePc(c.peerId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await emitSealed('call:accept', {
        to: c.peerId,
        callId: c.callId,
        payload: { type: 'accept', callId: c.callId },
      });
      setCall((prev) => (prev ? { ...prev, status: 'connecting' } : prev));
    } catch (err) {
      await emitSealed('call:reject', {
        to: c.peerId,
        callId: c.callId,
        payload: { type: 'reject', callId: c.callId, reason: 'media_failed' },
      }).catch(() => {});
      endCallLocal();
      throw err;
    }
  }, [attachLocalMedia, ensurePc, endCallLocal, emitSealed]);

  const rejectCall = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    emitSealed('call:reject', {
      to: c.peerId,
      callId: c.callId,
      payload: { type: 'reject', callId: c.callId, reason: 'rejected' },
    }).catch(() => {});
    endCallLocal();
  }, [endCallLocal, emitSealed]);

  const hangup = useCallback(() => {
    const c = callRef.current;
    if (c) {
      emitSealed('call:hangup', {
        to: c.peerId,
        callId: c.callId,
        payload: { type: 'hangup', callId: c.callId },
      }).catch(() => {});
    }
    endCallLocal();
  }, [endCallLocal, emitSealed]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setMuted(next);
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !cameraOff;
    stream.getVideoTracks().forEach((t) => {
      t.enabled = !next;
    });
    setCameraOff(next);
  }, [cameraOff]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !userId) return undefined;

    async function flushIce(pc) {
      const queued = pendingIceRef.current.splice(0);
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          /* ignore */
        }
      }
    }

    function openEnvelope(envelope) {
      return unsealCallEnvelope(envelope, userId);
    }

    function onInvite({ from, callId, envelope }) {
      if (!from || !callId) return;
      const body = openEnvelope(envelope);
      if (!body || body.type !== 'invite') return;
      if (callRef.current) {
        emitSealed('call:reject', {
          to: from,
          callId,
          payload: { type: 'reject', callId, reason: 'busy' },
        }).catch(() => {});
        return;
      }
      const next = {
        callId: String(callId),
        peerId: String(from),
        peerName: 'Incoming call',
        video: Boolean(body.video),
        role: 'callee',
        status: 'incoming',
      };
      setCall(next);
      callRef.current = next;
    }

    async function onAccept({ from, callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== 'accept') return;
      const c = callRef.current;
      if (!c || c.role !== 'caller' || String(c.callId) !== String(callId)) return;
      try {
        const stream = await attachLocalMedia(c.video);
        const pc = ensurePc(c.peerId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await emitSealed('call:offer', {
          to: from,
          callId: c.callId,
          payload: { type: 'offer', callId: c.callId, sdp: offer },
        });
        setCall((prev) => (prev ? { ...prev, status: 'connecting' } : prev));
      } catch {
        hangup();
      }
    }

    async function onOffer({ from, callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== 'offer' || !body.sdp) return;
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId)) return;
      const pc = ensurePc(c.peerId);
      await pc.setRemoteDescription(body.sdp);
      await flushIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await emitSealed('call:answer', {
        to: from,
        callId: c.callId,
        payload: { type: 'answer', callId: c.callId, sdp: answer },
      });
      setCall((prev) => (prev ? { ...prev, status: 'active' } : prev));
    }

    async function onAnswer({ callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== 'answer' || !body.sdp) return;
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId) || !pcRef.current) return;
      await pcRef.current.setRemoteDescription(body.sdp);
      await flushIce(pcRef.current);
      setCall((prev) => (prev ? { ...prev, status: 'active' } : prev));
    }

    async function onIce({ callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== 'ice' || !body.candidate) return;
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId)) return;
      if (!pcRef.current?.remoteDescription) {
        pendingIceRef.current.push(body.candidate);
        return;
      }
      try {
        await pcRef.current.addIceCandidate(body.candidate);
      } catch {
        /* ignore */
      }
    }

    function onReject({ callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== 'reject') return;
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId)) return;
      onMissed?.(c);
      endCallLocal();
    }

    function onHangup({ callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== 'hangup') return;
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId)) return;
      endCallLocal();
    }

    socket.on('call:invite', onInvite);
    socket.on('call:accept', onAccept);
    socket.on('call:reject', onReject);
    socket.on('call:hangup', onHangup);
    socket.on('call:offer', onOffer);
    socket.on('call:answer', onAnswer);
    socket.on('call:ice', onIce);

    return () => {
      socket.off('call:invite', onInvite);
      socket.off('call:accept', onAccept);
      socket.off('call:reject', onReject);
      socket.off('call:hangup', onHangup);
      socket.off('call:offer', onOffer);
      socket.off('call:answer', onAnswer);
      socket.off('call:ice', onIce);
    };
  }, [userId, attachLocalMedia, ensurePc, endCallLocal, hangup, onMissed, emitSealed]);

  useEffect(() => () => cleanupMedia(), [cleanupMedia]);

  return {
    call,
    localStream,
    remoteStream,
    muted,
    cameraOff,
    startCall,
    acceptCall,
    rejectCall,
    hangup,
    toggleMute,
    toggleCamera,
  };
}
