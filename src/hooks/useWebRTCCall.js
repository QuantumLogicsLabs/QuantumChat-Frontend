import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../api/socket.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function newCallId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * DM WebRTC call state machine. Signaling via Socket.IO; media is peer-to-peer.
 */
export default function useWebRTCCall({ userId, onMissed } = {}) {
  const [call, setCall] = useState(null); // { callId, peerId, peerName, video, role, status }
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const callRef = useRef(null);
  const pendingIceRef = useRef([]);

  useEffect(() => {
    callRef.current = call;
  }, [call]);

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
        getSocket()?.emit('call:ice', {
          to: peerId,
          callId: c.callId,
          candidate: e.candidate.toJSON(),
        });
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
    [endCallLocal]
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
      getSocket()?.emit('call:invite', { to: peerId, callId, video: Boolean(video) });
    },
    []
  );

  const acceptCall = useCallback(async () => {
    const c = callRef.current;
    if (!c || c.role !== 'callee') return;
    try {
      const stream = await attachLocalMedia(c.video);
      const pc = ensurePc(c.peerId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      getSocket()?.emit('call:accept', { to: c.peerId, callId: c.callId });
      setCall((prev) => (prev ? { ...prev, status: 'connecting' } : prev));
    } catch (err) {
      getSocket()?.emit('call:reject', { to: c.peerId, callId: c.callId, reason: 'media_failed' });
      endCallLocal();
      throw err;
    }
  }, [attachLocalMedia, ensurePc, endCallLocal]);

  const rejectCall = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    getSocket()?.emit('call:reject', { to: c.peerId, callId: c.callId });
    endCallLocal();
  }, [endCallLocal]);

  const hangup = useCallback(() => {
    const c = callRef.current;
    if (c) {
      getSocket()?.emit('call:hangup', { to: c.peerId, callId: c.callId });
    }
    endCallLocal();
  }, [endCallLocal]);

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

    function onInvite({ from, callId, video }) {
      if (!from || !callId) return;
      if (callRef.current) {
        socket.emit('call:reject', { to: from, callId, reason: 'busy' });
        return;
      }
      const next = {
        callId: String(callId),
        peerId: String(from),
        peerName: 'Incoming call',
        video: Boolean(video),
        role: 'callee',
        status: 'incoming',
      };
      setCall(next);
      callRef.current = next;
    }

    async function onAccept({ from, callId }) {
      const c = callRef.current;
      if (!c || c.role !== 'caller' || String(c.callId) !== String(callId)) return;
      try {
        const stream = await attachLocalMedia(c.video);
        const pc = ensurePc(c.peerId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('call:offer', { to: from, callId: c.callId, sdp: offer });
        setCall((prev) => (prev ? { ...prev, status: 'connecting' } : prev));
      } catch {
        hangup();
      }
    }

    async function onOffer({ from, callId, sdp }) {
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId)) return;
      const pc = ensurePc(c.peerId);
      await pc.setRemoteDescription(sdp);
      await flushIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:answer', { to: from, callId: c.callId, sdp: answer });
      setCall((prev) => (prev ? { ...prev, status: 'active' } : prev));
    }

    async function onAnswer({ callId, sdp }) {
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId) || !pcRef.current) return;
      await pcRef.current.setRemoteDescription(sdp);
      await flushIce(pcRef.current);
      setCall((prev) => (prev ? { ...prev, status: 'active' } : prev));
    }

    async function onIce({ callId, candidate }) {
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId) || !candidate) return;
      if (!pcRef.current?.remoteDescription) {
        pendingIceRef.current.push(candidate);
        return;
      }
      try {
        await pcRef.current.addIceCandidate(candidate);
      } catch {
        /* ignore */
      }
    }

    function onReject({ callId }) {
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId)) return;
      onMissed?.(c);
      endCallLocal();
    }

    function onHangup({ callId }) {
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
  }, [userId, attachLocalMedia, ensurePc, endCallLocal, hangup, onMissed]);

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
