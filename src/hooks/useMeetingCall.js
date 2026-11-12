import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../api/socket.js';
import {
  ICE_SERVERS,
  emitSealedEnvelope,
  newSignalId,
  registerSignalHandlers,
  unsealCallEnvelope,
} from '../utils/callSignalTransport.js';
import {
  currentTrackDeviceId,
  getCallMedia,
  listInputDevices,
} from '../utils/callMedia.js';

const ICE_RESTART_FAILSAFE_MS = 10_000;
const RING_TIMEOUT_MS = 45_000;

function memberIdOf(m) {
  return String(m?.id || m?._id || m);
}

/**
 * Group meeting WebRTC state machine — mesh topology, every participant
 * connects directly to every other participant. Signaling reuses the same
 * X5 sealed-box transport as useWebRTCCall (see callSignalTransport.js).
 *
 * The signaling bot holds no meeting roster/membership state, so
 * invite/join/leave/end are broadcast to every group member (a list this
 * hook resolves via `resolveGroupMembers`, not tracked server-side); a
 * recipient no-ops any event for a meetingId it isn't actively in. When a
 * new participant announces `meeting:join`, every peer already active in
 * that meeting independently initiates an offer to them — self-organizing,
 * no single point of coordination.
 */
export default function useMeetingCall({ userId, resolveGroupMembers, onEnd } = {}) {
  const [meeting, setMeeting] = useState(null);
  const [participants, setParticipants] = useState(new Map());
  const [localStream, setLocalStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [noiseCancel, setNoiseCancelState] = useState(true);
  const [audioDeviceId, setAudioDeviceId] = useState('');
  const [videoDeviceId, setVideoDeviceId] = useState('');
  const [audioDevices, setAudioDevices] = useState([]);
  const [videoDevices, setVideoDevices] = useState([]);
  const noiseCancelRef = useRef(true);
  const audioDeviceIdRef = useRef('');
  const videoDeviceIdRef = useRef('');

  const meetingRef = useRef(null);
  const localStreamRef = useRef(null);
  const pcMapRef = useRef(new Map()); // peerId -> RTCPeerConnection
  const pendingIceRef = useRef(new Map()); // peerId -> queued candidates
  const iceRestartTimersRef = useRef(new Map()); // peerId -> timeout id
  const membersRef = useRef([]); // current meeting's group member list (id + publicKeys)
  const resolveGroupMembersRef = useRef(resolveGroupMembers);
  const onEndRef = useRef(onEnd);
  resolveGroupMembersRef.current = resolveGroupMembers;
  onEndRef.current = onEnd;

  useEffect(() => {
    noiseCancelRef.current = noiseCancel;
  }, [noiseCancel]);
  useEffect(() => {
    audioDeviceIdRef.current = audioDeviceId;
  }, [audioDeviceId]);
  useEffect(() => {
    videoDeviceIdRef.current = videoDeviceId;
  }, [videoDeviceId]);

  const refreshDevices = useCallback(async () => {
    try {
      const { audioInputs, videoInputs } = await listInputDevices();
      setAudioDevices(audioInputs);
      setVideoDevices(videoInputs);
      return { audioInputs, videoInputs };
    } catch {
      return { audioInputs: [], videoInputs: [] };
    }
  }, []);

  useEffect(() => {
    if (!meeting) return undefined;
    refreshDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return undefined;
    const onChange = () => {
      refreshDevices();
    };
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [meeting, refreshDevices]);

  useEffect(() => {
    meetingRef.current = meeting;
  }, [meeting]);

  const getPeerKeys = useCallback((peerId) => {
    const member = membersRef.current.find((m) => memberIdOf(m) === String(peerId));
    return (member?.publicKeys || []).filter(Boolean);
  }, []);

  const sendTo = useCallback(
    (eventName, peerId, payload) => {
      const meetingId = meetingRef.current?.meetingId;
      if (!meetingId) return Promise.resolve();
      const peerKeys = getPeerKeys(peerId);
      if (!peerKeys.length) return Promise.resolve();
      return emitSealedEnvelope(eventName, {
        to: peerId,
        callId: meetingId,
        payload,
        peerKeys,
      }).catch(() => {});
    },
    [getPeerKeys]
  );

  const broadcast = useCallback(
    (eventName, payload) => {
      const myId = String(userId);
      const targets = membersRef.current.map(memberIdOf).filter((id) => id !== myId);
      return Promise.all(targets.map((peerId) => sendTo(eventName, peerId, payload)));
    },
    [sendTo, userId]
  );

  const removeParticipant = useCallback((peerId) => {
    const id = String(peerId);
    const pc = pcMapRef.current.get(id);
    if (pc) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      pcMapRef.current.delete(id);
    }
    pendingIceRef.current.delete(id);
    const timer = iceRestartTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      iceRestartTimersRef.current.delete(id);
    }
    setParticipants((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const cleanupMeeting = useCallback(() => {
    for (const timer of iceRestartTimersRef.current.values()) window.clearTimeout(timer);
    iceRestartTimersRef.current.clear();
    for (const pc of pcMapRef.current.values()) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    pcMapRef.current.clear();
    pendingIceRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setParticipants(new Map());
    setMuted(false);
    setCameraOff(false);
    membersRef.current = [];
  }, []);

  const endMeetingLocal = useCallback(
    (reason) => {
      const m = meetingRef.current;
      if (m) {
        const participantCount = pcMapRef.current.size + (m.status === 'active' ? 1 : 0);
        try {
          onEndRef.current?.({
            meetingId: m.meetingId,
            groupId: m.groupId,
            video: m.video,
            role: m.role,
            answered: m.status === 'active',
            participantCount,
            durationSeconds: m.startedAt ? Math.floor((Date.now() - m.startedAt) / 1000) : 0,
            reason: reason || null,
          });
        } catch {
          /* swallow callback errors */
        }
      }
      cleanupMeeting();
      meetingRef.current = null;
      setMeeting(null);
    },
    [cleanupMeeting]
  );

  const ensurePc = useCallback(
    (peerId) => {
      const id = String(peerId);
      if (pcMapRef.current.has(id)) return pcMapRef.current.get(id);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcMapRef.current.set(id, pc);

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        sendTo('meeting:ice', id, {
          type: 'ice',
          callId: meetingRef.current?.meetingId,
          candidate: e.candidate.toJSON(),
        });
      };

      pc.ontrack = (e) => {
        const stream = e.streams?.[0] || new MediaStream([e.track]);
        setParticipants((prev) => {
          const next = new Map(prev);
          next.set(id, { ...(next.get(id) || {}), stream });
          return next;
        });
      };

      // Same ICE-restart-before-hangup resilience as useWebRTCCall, but per
      // peer (one participant's blip shouldn't drop the whole mesh) and with
      // a deterministic tie-breaker instead of a caller/callee role, since a
      // mesh pair has no inherent caller/callee — the lower user id re-offers.
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          const timer = iceRestartTimersRef.current.get(id);
          if (timer) {
            window.clearTimeout(timer);
            iceRestartTimersRef.current.delete(id);
          }
          return;
        }
        if (pc.connectionState === 'failed') {
          if (!iceRestartTimersRef.current.has(id)) {
            const timer = window.setTimeout(() => {
              iceRestartTimersRef.current.delete(id);
              const current = pcMapRef.current.get(id);
              if (current && (current.connectionState === 'failed' || current.connectionState === 'disconnected')) {
                removeParticipant(id);
              }
            }, ICE_RESTART_FAILSAFE_MS);
            iceRestartTimersRef.current.set(id, timer);
          }
          if (String(userId) < id) {
            (async () => {
              try {
                const offer = await pc.createOffer({ iceRestart: true });
                await pc.setLocalDescription(offer);
                await sendTo('meeting:offer', id, {
                  type: 'offer',
                  callId: meetingRef.current?.meetingId,
                  sdp: offer,
                });
              } catch {
                /* best effort; the failsafe timer above drops the peer if this doesn't recover */
              }
            })();
          }
          return;
        }
        if (pc.connectionState === 'closed') {
          removeParticipant(id);
        }
      };

      return pc;
    },
    [sendTo, removeParticipant, userId]
  );

  const attachLocalMedia = useCallback(async (video) => {
    const stream = await getCallMedia({
      audio: true,
      video: Boolean(video),
      audioDeviceId: audioDeviceIdRef.current || undefined,
      videoDeviceId: videoDeviceIdRef.current || undefined,
      noiseCancel: noiseCancelRef.current,
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    const aId = currentTrackDeviceId(stream, 'audio');
    const vId = currentTrackDeviceId(stream, 'video');
    if (aId) setAudioDeviceId(aId);
    if (vId) setVideoDeviceId(vId);
    refreshDevices().catch(() => {});
    return stream;
  }, [refreshDevices]);

  const startMeeting = useCallback(
    async ({ groupId, video = false }) => {
      if (!groupId || meetingRef.current) return;
      const resolved = await resolveGroupMembersRef.current?.(groupId);
      const members = resolved?.members || [];
      if (!members.length) throw new Error('Could not load group members');

      const meetingId = newSignalId('meeting');
      await attachLocalMedia(video);

      membersRef.current = members;
      const next = {
        meetingId,
        groupId: String(groupId),
        groupName: resolved?.groupName || 'Group',
        video: Boolean(video),
        role: 'host',
        status: 'active',
        startedAt: Date.now(),
      };
      setMeeting(next);
      meetingRef.current = next;

      broadcast('meeting:invite', {
        type: 'invite',
        callId: meetingId,
        groupId: String(groupId),
        groupName: next.groupName,
        video: Boolean(video),
      }).catch(() => {});
    },
    [attachLocalMedia, broadcast]
  );

  const joinMeeting = useCallback(async () => {
    const m = meetingRef.current;
    if (!m || m.role !== 'joiner' || m.status !== 'incoming') return;
    const resolved = await resolveGroupMembersRef.current?.(m.groupId);
    const members = resolved?.members || [];
    if (!members.length) {
      endMeetingLocal('media_failed');
      throw new Error('Could not load group members');
    }
    try {
      await attachLocalMedia(m.video);
    } catch (err) {
      endMeetingLocal('media_failed');
      throw err;
    }
    membersRef.current = members;
    const next = { ...m, status: 'active', startedAt: Date.now() };
    setMeeting(next);
    meetingRef.current = next;
    broadcast('meeting:join', { type: 'join', callId: m.meetingId }).catch(() => {});
  }, [attachLocalMedia, broadcast, endMeetingLocal]);

  const declineMeeting = useCallback(() => {
    cleanupMeeting();
    meetingRef.current = null;
    setMeeting(null);
  }, [cleanupMeeting]);

  const leaveMeeting = useCallback(() => {
    const m = meetingRef.current;
    if (m && m.status === 'active') {
      broadcast('meeting:leave', { type: 'leave', callId: m.meetingId }).catch(() => {});
    }
    endMeetingLocal();
  }, [broadcast, endMeetingLocal]);

  const endMeetingForAll = useCallback(() => {
    const m = meetingRef.current;
    if (m && m.role === 'host') {
      broadcast('meeting:end', { type: 'end', callId: m.meetingId }).catch(() => {});
    }
    endMeetingLocal();
  }, [broadcast, endMeetingLocal]);

  const inviteParticipant = useCallback(
    async (targetUser) => {
      const targetId = memberIdOf(targetUser);
      const m = meetingRef.current;
      if (!m || !targetId) return;

      const existingMember = membersRef.current.find((member) => memberIdOf(member) === targetId);
      if (!existingMember) {
        membersRef.current = [
          ...membersRef.current,
          {
            id: targetId,
            publicKeys: targetUser?.publicKeys || [],
          },
        ];
      }

      await sendTo('meeting:invite', targetId, {
        type: 'invite',
        callId: m.meetingId,
        groupId: m.groupId || '',
        groupName: m.groupName || 'Group Call',
        video: Boolean(m.video),
      });
    },
    [sendTo]
  );

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setMuted(next);
  }, [muted]);

  const replaceLocalTrackOnAll = useCallback(async (kind, newTrack) => {
    const stream = localStreamRef.current;
    if (!stream || !newTrack) return;

    const oldTracks =
      kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
    for (const old of oldTracks) {
      if (old === newTrack) continue;
      stream.removeTrack(old);
      try {
        old.stop();
      } catch {
        /* ignore */
      }
    }
    if (!oldTracks.includes(newTrack)) {
      stream.addTrack(newTrack);
    }
    setLocalStream(new MediaStream(stream.getTracks()));

    for (const [peerId, pc] of pcMapRef.current.entries()) {
      if (pc.signalingState === 'closed') continue;
      const sender = pc.getSenders().find((s) => s.track?.kind === kind);
      if (sender) {
        await sender.replaceTrack(newTrack).catch(() => {});
        continue;
      }
      if (kind !== 'video') continue;

      let videoTransceiver = pc.getTransceivers().find(
        (t) =>
          t.receiver?.track?.kind === 'video' ||
          t.sender?.track?.kind === 'video',
      );
      if (!videoTransceiver) {
        videoTransceiver = pc.addTransceiver(newTrack, {
          direction: 'sendrecv',
          streams: [stream],
        });
      } else {
        try {
          videoTransceiver.direction = 'sendrecv';
        } catch {
          /* ignore */
        }
        await videoTransceiver.sender.replaceTrack(newTrack).catch(() => {});
      }
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendTo('meeting:offer', peerId, {
          type: 'offer',
          callId: meetingRef.current?.meetingId,
          sdp: offer,
          video: true,
        });
      } catch {
        /* ignore re-offer errors */
      }
    }
  }, [sendTo]);

  const switchAudioDevice = useCallback(
    async (deviceId) => {
      try {
        const nextStream = await getCallMedia({
          audio: true,
          video: false,
          audioDeviceId: deviceId || undefined,
          noiseCancel: noiseCancelRef.current,
        });
        const track = nextStream.getAudioTracks()[0];
        if (!track) return;
        track.enabled = !muted;
        await replaceLocalTrackOnAll('audio', track);
        const resolved =
          deviceId || currentTrackDeviceId(localStreamRef.current, 'audio');
        if (resolved) setAudioDeviceId(resolved);
        refreshDevices().catch(() => {});
      } catch (err) {
        console.warn('[useMeetingCall] Could not switch microphone:', err);
        throw err;
      }
    },
    [muted, refreshDevices, replaceLocalTrackOnAll],
  );

  const switchVideoDevice = useCallback(
    async (deviceId) => {
      try {
        const nextStream = await getCallMedia({
          audio: false,
          video: true,
          videoDeviceId: deviceId || undefined,
        });
        const track = nextStream.getVideoTracks()[0];
        if (!track) return;

        let stream = localStreamRef.current;
        if (!stream) {
          stream = new MediaStream([track]);
          localStreamRef.current = stream;
          setLocalStream(stream);
          await replaceLocalTrackOnAll('video', track);
        } else {
          track.enabled = true;
          await replaceLocalTrackOnAll('video', track);
        }

        const resolved =
          deviceId || currentTrackDeviceId(localStreamRef.current, 'video');
        if (resolved) setVideoDeviceId(resolved);
        setCameraOff(false);
        setMeeting((prev) => (prev ? { ...prev, video: true } : prev));
        refreshDevices().catch(() => {});
      } catch (err) {
        console.warn('[useMeetingCall] Could not switch camera:', err);
        throw err;
      }
    },
    [refreshDevices, replaceLocalTrackOnAll],
  );

  const setNoiseCancel = useCallback(
    async (enabled) => {
      const next = Boolean(enabled);
      setNoiseCancelState(next);
      noiseCancelRef.current = next;
      const stream = localStreamRef.current;
      if (!stream?.getAudioTracks()?.length) return;
      try {
        await switchAudioDevice(
          audioDeviceIdRef.current ||
            currentTrackDeviceId(stream, 'audio') ||
            '',
        );
      } catch {
        /* keep preference */
      }
    },
    [switchAudioDevice],
  );

  const toggleCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    const turningOff = !cameraOff;

    if (turningOff) {
      if (stream) {
        stream.getVideoTracks().forEach((t) => {
          t.enabled = false;
        });
      }
      setCameraOff(true);
      return;
    }

    if (stream && stream.getVideoTracks().some((t) => t.readyState === 'live')) {
      stream.getVideoTracks().forEach((t) => {
        t.enabled = true;
      });
      setCameraOff(false);
      return;
    }

    try {
      await switchVideoDevice(videoDeviceIdRef.current || '');
    } catch (err) {
      console.warn('[useMeetingCall] Could not enable camera:', err);
      throw err;
    }
  }, [cameraOff, switchVideoDevice]);

  useEffect(() => {
    const socket = getSocket();
    if (!userId) return undefined;

    function openEnvelope(envelope) {
      return unsealCallEnvelope(envelope, userId);
    }

    async function flushIce(pc, peerId) {
      const queued = pendingIceRef.current.get(peerId) || [];
      pendingIceRef.current.delete(peerId);
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          /* ignore */
        }
      }
    }

    function onInvite({ from, callId, envelope }) {
      if (!from || !callId) return;
      const body = openEnvelope(envelope);
      if (!body || body.type !== 'invite') return;
      if (meetingRef.current) return; // already in, or being prompted for, a meeting
      const next = {
        meetingId: String(callId),
        groupId: String(body.groupId || ''),
        groupName: body.groupName || 'Group',
        video: Boolean(body.video),
        role: 'joiner',
        status: 'incoming',
        hostId: String(from),
      };
      setMeeting(next);
      meetingRef.current = next;
    }

    async function onJoin({ from, callId }) {
      const m = meetingRef.current;
      if (!m || String(m.meetingId) !== String(callId) || m.status !== 'active') return;
      if (String(from) === String(userId) || pcMapRef.current.has(String(from))) return;
      try {
        const pc = ensurePc(from);
        localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendTo('meeting:offer', from, { type: 'offer', callId: m.meetingId, sdp: offer });
      } catch {
        removeParticipant(from);
      }
    }

    async function onOffer({ from, callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== 'offer' || !body.sdp) return;
      const m = meetingRef.current;
      if (!m || String(m.meetingId) !== String(callId)) return;
      const pc = ensurePc(from);
      if (!pc.getSenders().length && localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));
      }
      await pc.setRemoteDescription(body.sdp);
      await flushIce(pc, String(from));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendTo('meeting:answer', from, { type: 'answer', callId: m.meetingId, sdp: answer });
    }

    async function onAnswer({ from, callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== 'answer' || !body.sdp) return;
      const m = meetingRef.current;
      if (!m || String(m.meetingId) !== String(callId)) return;
      const pc = pcMapRef.current.get(String(from));
      if (!pc) return;
      await pc.setRemoteDescription(body.sdp);
      await flushIce(pc, String(from));
    }

    async function onIce({ from, callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== 'ice' || !body.candidate) return;
      const m = meetingRef.current;
      if (!m || String(m.meetingId) !== String(callId)) return;
      const pc = pcMapRef.current.get(String(from));
      if (!pc || !pc.remoteDescription) {
        const list = pendingIceRef.current.get(String(from)) || [];
        list.push(body.candidate);
        pendingIceRef.current.set(String(from), list);
        return;
      }
      try {
        await pc.addIceCandidate(body.candidate);
      } catch {
        /* ignore */
      }
    }

    function onLeave({ from, callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== 'leave') return;
      const m = meetingRef.current;
      if (!m || String(m.meetingId) !== String(callId)) return;
      removeParticipant(from);
    }

    function onEndEvent({ callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== 'end') return;
      const m = meetingRef.current;
      if (!m || String(m.meetingId) !== String(callId)) return;
      endMeetingLocal('ended_by_host');
    }

    const handlers = {
      'meeting:invite': onInvite,
      'meeting:join': onJoin,
      'meeting:leave': onLeave,
      'meeting:end': onEndEvent,
      'meeting:offer': onOffer,
      'meeting:answer': onAnswer,
      'meeting:ice': onIce,
    };

    for (const [eventName, handler] of Object.entries(handlers)) {
      socket?.on(eventName, handler);
    }
    const unregisterRestFallback = registerSignalHandlers(handlers);

    return () => {
      unregisterRestFallback();
      for (const [eventName, handler] of Object.entries(handlers)) {
        socket?.off(eventName, handler);
      }
    };
  }, [userId, ensurePc, sendTo, removeParticipant, endMeetingLocal]);

  useEffect(() => {
    if (!meeting || meeting.status !== 'incoming') return undefined;
    const timer = window.setTimeout(() => {
      const current = meetingRef.current;
      if (!current || current.meetingId !== meeting.meetingId) return;
      declineMeeting();
    }, RING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [meeting, declineMeeting]);

  useEffect(() => () => cleanupMeeting(), [cleanupMeeting]);

  return {
    meeting,
    participants,
    localStream,
    muted,
    cameraOff,
    noiseCancel,
    audioDeviceId,
    videoDeviceId,
    audioDevices,
    videoDevices,
    startMeeting,
    joinMeeting,
    declineMeeting,
    leaveMeeting,
    endMeetingForAll,
    toggleMute,
    toggleCamera,
    switchAudioDevice,
    switchVideoDevice,
    setNoiseCancel,
    refreshDevices,
    inviteParticipant,
  };
}
