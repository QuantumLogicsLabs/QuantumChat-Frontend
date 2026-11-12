import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "../api/socket.js";
import {
  ICE_SERVERS,
  emitSealedEnvelope,
  newSignalId,
  registerSignalHandlers,
  unsealCallEnvelope,
} from "../utils/callSignalTransport.js";
import {
  currentTrackDeviceId,
  getCallMedia,
  listInputDevices,
} from "../utils/callMedia.js";
import { startDialingSound } from "../utils/sounds.js";

const ICE_RESTART_FAILSAFE_MS = 10_000;

/**
 * DM WebRTC call state machine.
 * Signaling is X5 sealed-box envelopes; media is peer-to-peer.
 */

export default function useWebRTCCall({
  userId,
  resolvePeerPublicKeys,
  onMissed,
  onEnd,
} = {}) {
  const [call, setCall] = useState(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [noiseCancel, setNoiseCancelState] = useState(true);
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [audioDevices, setAudioDevices] = useState([]);
  const [videoDevices, setVideoDevices] = useState([]);
  const noiseCancelRef = useRef(true);
  const audioDeviceIdRef = useRef("");
  const videoDeviceIdRef = useRef("");
  const [screenStream, setScreenStream] = useState(null);
  const [remoteScreen, setRemoteScreen] = useState(false);
  const screenStreamRef = useRef(null);
  // Sender carrying our outbound video. Reused across share start/stop so a
  // second share doesn't spawn a new transceiver (which would leave the peer
  // with a dead video track alongside the live one).
  const shareSenderRef = useRef(null);
  const displacedCameraTrackRef = useRef(null);
  const screenBusyRef = useRef(false);
  const makingOfferRef = useRef(false);
  const pendingRenegotiationRef = useRef(null);
  const renegotiateRef = useRef(null);
  const callRef = useRef(null);
  const pendingIceRef = useRef([]);
  const peerKeysCacheRef = useRef(new Map());
  const resolvePeerPublicKeysRef = useRef(resolvePeerPublicKeys);
  const onMissedRef = useRef(onMissed);
  const onEndRef = useRef(onEnd);
  const stopDialingSoundRef = useRef(null);
  const iceRestartTimerRef = useRef(null);
  resolvePeerPublicKeysRef.current = resolvePeerPublicKeys;
  onMissedRef.current = onMissed;
  onEndRef.current = onEnd;

  useEffect(() => {
    callRef.current = call;
  }, [call]);

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
    if (!call) return undefined;
    refreshDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return undefined;
    const onChange = () => {
      refreshDevices();
    };
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [call, refreshDevices]);

  const getPeerKeys = useCallback(async (peerId) => {
    const id = String(peerId);
    if (peerKeysCacheRef.current.has(id))
      return peerKeysCacheRef.current.get(id);
    const keys = (await resolvePeerPublicKeysRef.current?.(id)) || [];
    peerKeysCacheRef.current.set(id, keys);
    return keys;
  }, []);

  const emitSealed = useCallback(
    async (eventName, { to, callId, payload }) => {
      const peerKeys = await getPeerKeys(to);
      await emitSealedEnvelope(eventName, { to, callId, payload, peerKeys });
    },
    [getPeerKeys],
  );

  const clearIceRestartFailsafe = useCallback(() => {
    if (iceRestartTimerRef.current) {
      window.clearTimeout(iceRestartTimerRef.current);
      iceRestartTimerRef.current = null;
    }
  }, []);

  /** Drops the display-capture stream without touching the peer connection. */
  const releaseScreenStream = useCallback(() => {
    const display = screenStreamRef.current;
    screenStreamRef.current = null;
    setScreenStream(null);
    if (display) display.getTracks().forEach((t) => t.stop());
  }, []);

  const cleanupMedia = useCallback(() => {
    stopDialingSoundRef.current?.();
    stopDialingSoundRef.current = null;
    clearIceRestartFailsafe();
    releaseScreenStream();
    shareSenderRef.current = null;
    displacedCameraTrackRef.current = null;
    screenBusyRef.current = false;
    makingOfferRef.current = false;
    pendingRenegotiationRef.current = null;
    setRemoteScreen(false);
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
  }, [clearIceRestartFailsafe, releaseScreenStream]);

  const endCallLocal = useCallback(
    (reason) => {
      const c = callRef.current;
      try {
        if (c) {
          const startedAt = c.startedAt || null;
          const answered = Boolean(startedAt);
          const durationSeconds = answered
            ? Math.floor((Date.now() - startedAt) / 1000)
            : 0;
          try {
            onEndRef.current?.({
              callId: c.callId,
              peerId: c.peerId,
              video: c.video,
              role: c.role,
              answered,
              durationSeconds,
              reason: reason || null,
            });
          } catch (e) {
            /* swallow callback errors */
          }
        }
      } finally {
        cleanupMedia();
        callRef.current = null;
        setCall(null);
      }
    },
    [cleanupMedia],
  );

  const ensurePc = useCallback(
    (peerId) => {
      if (pcRef.current) return pcRef.current;
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const c = callRef.current;
        if (!c) return;
        emitSealed("call:ice", {
          to: peerId,
          callId: c.callId,
          payload: {
            type: "ice",
            callId: c.callId,
            candidate: e.candidate.toJSON(),
          },
        }).catch(() => {});
      };

      pc.ontrack = (e) => {
        // Always accumulate onto one remote stream. Screen share is added with
        // addTrack(track, displayStream) — e.streams[0] is video-only. Switching
        // to that stream would drop the peer's mic and silence the call.
        let stream = remoteStreamRef.current;
        if (!stream) {
          stream = new MediaStream();
        }
        // A re-shared screen arrives as a new track; drop dead ones first so
        // the <video> element doesn't bind to a frozen predecessor.
        stream
          .getTracks()
          .filter((t) => t.readyState === "ended")
          .forEach((t) => stream.removeTrack(t));
        // New outbound screen (voice call) or camera swap: keep a single live video.
        if (e.track?.kind === "video") {
          stream.getVideoTracks().forEach((t) => {
            if (t.id !== e.track.id) stream.removeTrack(t);
          });
        }
        if (e.track && !stream.getTracks().some((t) => t.id === e.track.id)) {
          stream.addTrack(e.track);
        }
        remoteStreamRef.current = stream;
        // Clone track list into a fresh MediaStream so React effects re-bind/play.
        setRemoteStream(new MediaStream(stream.getTracks()));
      };

      // A 'failed' state during an otherwise long-lived call (e.g. a Wi-Fi
      // blip) shouldn't hang up immediately — try an ICE restart first, only
      // the caller side re-offers to avoid both peers racing. If the
      // connection hasn't recovered within the failsafe window, hang up.
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setCall((prev) =>
            prev && prev.status === "connecting"
              ? {
                  ...prev,
                  status: "active",
                  startedAt: prev.startedAt || Date.now(),
                }
              : prev,
          );
        }
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          endCallLocal();
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          endCallLocal("ice_failed");
        }
      };

      // A share toggled while an offer/answer was already in flight waits here
      // rather than being dropped — otherwise the peer gets the track without
      // the flag that tells it what the track is.
      pc.onsignalingstatechange = () => {
        if (pc.signalingState !== "stable") return;
        const pending = pendingRenegotiationRef.current;
        if (!pending) return;
        pendingRenegotiationRef.current = null;
        renegotiateRef.current?.(pending);
      };

      return pc;
    },
    [endCallLocal, emitSealed, clearIceRestartFailsafe],
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
    const aId = currentTrackDeviceId(stream, "audio");
    const vId = currentTrackDeviceId(stream, "video");
    if (aId) setAudioDeviceId(aId);
    if (vId) setVideoDeviceId(vId);
    refreshDevices().catch(() => {});
    return stream;
  }, [refreshDevices]);

  /** Audio-only calls still need a video m-line so a peer can send camera later. */
  const ensureVideoRecvTransceiver = useCallback((pc) => {
    if (!pc || pc.signalingState === 'closed') return;
    const hasVideo = pc.getTransceivers().some(
      (t) =>
        t.receiver?.track?.kind === 'video' ||
        t.sender?.track?.kind === 'video',
    );
    if (!hasVideo) {
      pc.addTransceiver('video', { direction: 'recvonly' });
    }
  }, []);

  /**
   * Mid-call offer/answer round. Screen-share state rides along on the offer
   * (`screen`) instead of a dedicated signal, so no new relay event is needed
   * and the flag can never arrive before the track it describes.
   */
  const renegotiate = useCallback(
    async (extra = {}) => {
      const pc = pcRef.current;
      const c = callRef.current;
      if (!pc || !c || pc.signalingState === "closed") return;
      if (makingOfferRef.current || pc.signalingState !== "stable") {
        pendingRenegotiationRef.current = extra;
        return;
      }
      makingOfferRef.current = true;
      try {
        const offer = await pc.createOffer();
        if (pc.signalingState !== "stable") {
          pendingRenegotiationRef.current = extra;
          return;
        }
        await pc.setLocalDescription(offer);
        await emitSealed("call:offer", {
          to: c.peerId,
          callId: c.callId,
          payload: {
            type: "offer",
            callId: c.callId,
            renegotiation: true,
            sdp: { type: offer.type, sdp: offer.sdp },
            ...extra,
          },
        });
      } catch {
        // Existing tracks keep flowing; only the new one is missing.
      } finally {
        makingOfferRef.current = false;
      }
    },
    [emitSealed],
  );
  renegotiateRef.current = renegotiate;

  const stopScreenShare = useCallback(async () => {
    if (!screenStreamRef.current || screenBusyRef.current) return;
    screenBusyRef.current = true;
    try {
      releaseScreenStream();
      const sender = shareSenderRef.current;
      const camera = displacedCameraTrackRef.current;
      displacedCameraTrackRef.current = null;
      if (sender && pcRef.current?.signalingState !== "closed") {
        // Keep the transceiver — replaceTrack(null) mutes the stream for the
        // peer and leaves a slot ready for the next share.
        await sender
          .replaceTrack(camera?.readyState === "live" ? camera : null)
          .catch(() => {});
      }
      await renegotiate({ screen: false });
    } finally {
      screenBusyRef.current = false;
    }
  }, [releaseScreenStream, renegotiate]);

  const startScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    const c = callRef.current;
    if (!pc || !c || screenStreamRef.current || screenBusyRef.current) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("Screen sharing is not supported in this browser");
    }
    screenBusyRef.current = true;
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
      const track = display.getVideoTracks()[0];
      if (!track) {
        display.getTracks().forEach((t) => t.stop());
        return;
      }
      screenStreamRef.current = display;
      setScreenStream(display);

      const sender =
        shareSenderRef.current ||
        pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        displacedCameraTrackRef.current = sender.track || null;
        shareSenderRef.current = sender;
        await sender.replaceTrack(track);
      } else {
        shareSenderRef.current = pc.addTrack(track, display);
      }

      // "Stop sharing" in the browser's own capture bar ends the track directly.
      track.addEventListener("ended", () => {
        stopScreenShare().catch(() => {});
      });

      await renegotiate({ screen: true });
    } finally {
      screenBusyRef.current = false;
    }
  }, [renegotiate, stopScreenShare]);

  const toggleScreenShare = useCallback(
    () => (screenStreamRef.current ? stopScreenShare() : startScreenShare()),
    [startScreenShare, stopScreenShare],
  );

  const startCall = useCallback(
    async ({ peerId, peerName, video = false }) => {
      if (!peerId || callRef.current) return;
      const callId = newSignalId("call");
      const next = {
        callId,
        peerId: String(peerId),
        peerName: peerName || "User",
        video: Boolean(video),
        role: "caller",
        status: "ringing",
      };
      setCall(next);
      callRef.current = next;
      stopDialingSoundRef.current?.();
      stopDialingSoundRef.current = startDialingSound();
      try {
        await emitSealed("call:invite", {
          to: peerId,
          callId,
          payload: { type: "invite", callId, video: Boolean(video) },
        });
      } catch (err) {
        endCallLocal("signaling_failed");
        throw err;
      }
    },
    [emitSealed, endCallLocal],
  );

  const acceptCall = useCallback(async () => {
    const c = callRef.current;
    if (!c || c.role !== "callee") return;
    try {
      const stream = await attachLocalMedia(c.video);
      const pc = ensurePc(c.peerId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      if (!stream.getVideoTracks().length) ensureVideoRecvTransceiver(pc);
      await emitSealed("call:accept", {
        to: c.peerId,
        callId: c.callId,
        payload: { type: "accept", callId: c.callId },
      });
      setCall((prev) => (prev ? { ...prev, status: "connecting" } : prev));
    } catch (err) {
      await emitSealed("call:reject", {
        to: c.peerId,
        callId: c.callId,
        payload: { type: "reject", callId: c.callId, reason: "media_failed" },
      }).catch(() => {});
      endCallLocal();
      throw err;
    }
  }, [attachLocalMedia, ensurePc, ensureVideoRecvTransceiver, endCallLocal, emitSealed]);

  const rejectCall = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    emitSealed("call:reject", {
      to: c.peerId,
      callId: c.callId,
      payload: { type: "reject", callId: c.callId, reason: "rejected" },
    }).catch(() => {});
    endCallLocal();
  }, [endCallLocal, emitSealed]);

  const hangup = useCallback(() => {
    const c = callRef.current;
    if (c) {
      emitSealed("call:hangup", {
        to: c.peerId,
        callId: c.callId,
        payload: { type: "hangup", callId: c.callId },
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

  const replaceLocalTrack = useCallback(async (kind, newTrack) => {
    const stream = localStreamRef.current;
    if (!stream || !newTrack) return;

    const oldTracks =
      kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
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

    const pc = pcRef.current;
    if (pc && pc.signalingState !== "closed") {
      const sender = pc.getSenders().find((s) => s.track?.kind === kind);
      if (sender) {
        await sender.replaceTrack(newTrack).catch(() => {});
      } else if (kind === "video") {
        let videoTransceiver = pc.getTransceivers().find(
          (t) =>
            t.receiver?.track?.kind === "video" ||
            t.sender?.track?.kind === "video",
        );
        if (!videoTransceiver) {
          videoTransceiver = pc.addTransceiver(newTrack, {
            direction: "sendrecv",
            streams: [stream],
          });
        } else {
          try {
            videoTransceiver.direction = "sendrecv";
          } catch {
            /* ignore */
          }
          await videoTransceiver.sender.replaceTrack(newTrack).catch(() => {});
        }
        await renegotiateRef.current?.({ video: true });
      }
    }
  }, []);

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
        await replaceLocalTrack("audio", track);
        const resolved =
          deviceId || currentTrackDeviceId(localStreamRef.current, "audio");
        if (resolved) setAudioDeviceId(resolved);
        refreshDevices().catch(() => {});
      } catch (err) {
        console.warn("[useWebRTCCall] Could not switch microphone:", err);
        throw err;
      }
    },
    [muted, refreshDevices, replaceLocalTrack],
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

          const pc = pcRef.current;
          if (pc && pc.signalingState !== "closed") {
            let videoTransceiver = pc.getTransceivers().find(
              (t) =>
                t.receiver?.track?.kind === "video" ||
                t.sender?.track?.kind === "video",
            );
            if (!videoTransceiver) {
              videoTransceiver = pc.addTransceiver(track, {
                direction: "sendrecv",
                streams: [stream],
              });
            } else {
              try {
                videoTransceiver.direction = "sendrecv";
              } catch {
                /* ignore */
              }
              await videoTransceiver.sender.replaceTrack(track).catch(() => {});
            }
            await renegotiateRef.current?.({ video: true });
          }
        } else {
          track.enabled = true;
          await replaceLocalTrack("video", track);
        }

        const resolved =
          deviceId || currentTrackDeviceId(localStreamRef.current, "video");
        if (resolved) setVideoDeviceId(resolved);
        setCameraOff(false);
        setCall((prev) => (prev ? { ...prev, video: true } : prev));
        refreshDevices().catch(() => {});
      } catch (err) {
        console.warn("[useWebRTCCall] Could not switch camera:", err);
        throw err;
      }
    },
    [refreshDevices, replaceLocalTrack],
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
            currentTrackDeviceId(stream, "audio") ||
            "",
        );
      } catch {
        /* keep preference even if re-acquire fails mid-call */
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

    // Turning camera ON — reuse a live track when possible.
    if (stream && stream.getVideoTracks().some((t) => t.readyState === "live")) {
      stream.getVideoTracks().forEach((t) => {
        t.enabled = true;
      });
      setCameraOff(false);
      setCall((prev) => (prev ? { ...prev, video: true } : prev));
      return;
    }

    try {
      await switchVideoDevice(videoDeviceIdRef.current || "");
    } catch (err) {
      console.warn("[useWebRTCCall] Could not enable camera:", err);
      throw err;
    }
  }, [cameraOff, switchVideoDevice]);

  useEffect(() => {
    const socket = getSocket();
    if (!userId) return undefined;

    async function flushIce(pc) {
      const queued = pendingIceRef.current.splice(0);
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
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
      if (!body || body.type !== "invite") return;
      if (callRef.current) {
        emitSealed("call:reject", {
          to: from,
          callId,
          payload: { type: "reject", callId, reason: "busy" },
        }).catch(() => {});
        return;
      }
      const next = {
        callId: String(callId),
        peerId: String(from),
        peerName: "Incoming call",
        video: Boolean(body.video),
        role: "callee",
        status: "incoming",
      };
      setCall(next);
      callRef.current = next;
    }

    async function onAccept({ from, callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== "accept") return;
      const c = callRef.current;
      if (!c || c.role !== "caller" || String(c.callId) !== String(callId))
        return;
      stopDialingSoundRef.current?.();
      stopDialingSoundRef.current = null;
      try {
        const stream = await attachLocalMedia(c.video);
        const pc = ensurePc(c.peerId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        if (!stream.getVideoTracks().length) ensureVideoRecvTransceiver(pc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await emitSealed("call:offer", {
          to: from,
          callId: c.callId,
          payload: {
            type: "offer",
            callId: c.callId,
            sdp: { type: offer.type, sdp: offer.sdp },
          },
        });
        setCall((prev) => (prev ? { ...prev, status: "connecting" } : prev));
      } catch {
        hangup();
      }
    }

    async function onOffer({ from, callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== "offer" || !body.sdp) return;
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId)) return;
      const pc = ensurePc(c.peerId);
      // Glare: both sides re-offered at once (e.g. each started a screen
      // share). The callee is the polite peer and rolls its own offer back;
      // the caller ignores the incoming one and keeps its own in flight.
      if (makingOfferRef.current || pc.signalingState !== "stable") {
        if (c.role !== "callee") return;
        try {
          await pc.setLocalDescription({ type: "rollback" });
        } catch {
          return;
        }
        // Our own rolled-back change still needs negotiating; re-offer once
        // this answer puts the connection back in "stable".
        pendingRenegotiationRef.current = {
          screen: Boolean(screenStreamRef.current),
        };
      }
      // Ensure local mic/camera tracks exist before answering (accept may have failed partially).
      if (!localStreamRef.current) {
        const stream = await attachLocalMedia(c.video);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        if (!stream.getVideoTracks().length) ensureVideoRecvTransceiver(pc);
      } else if (pc.getSenders().every((s) => !s.track)) {
        localStreamRef.current
          .getTracks()
          .forEach((track) => pc.addTrack(track, localStreamRef.current));
        if (!localStreamRef.current.getVideoTracks().length) {
          ensureVideoRecvTransceiver(pc);
        }
      }
      await pc.setRemoteDescription(new RTCSessionDescription(body.sdp));
      await flushIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await emitSealed("call:answer", {
        to: from,
        callId: c.callId,
        payload: {
          type: "answer",
          callId: c.callId,
          renegotiation: Boolean(body.renegotiation),
          sdp: { type: answer.type, sdp: answer.sdp },
        },
      });
      if (typeof body.screen === "boolean") setRemoteScreen(body.screen);
      // Peer turned camera on mid-call — mark video so UI/status update.
      if (body.renegotiation && body.video) {
        setCall((prev) => (prev ? { ...prev, video: true } : prev));
      }
      // A renegotiation mid-call must not knock an active call back to
      // "connecting" or restart its duration clock.
      if (body.renegotiation) return;
      setCall((prev) =>
        prev
          ? {
              ...prev,
              status: "connecting",
              startedAt: prev.startedAt || Date.now(),
            }
          : prev,
      );
    }

    async function onAnswer({ callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== "answer" || !body.sdp) return;
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId) || !pcRef.current) return;
      await pcRef.current.setRemoteDescription(
        new RTCSessionDescription(body.sdp),
      );
      await flushIce(pcRef.current);
      if (body.renegotiation) return;
      setCall((prev) =>
        prev
          ? {
              ...prev,
              status: "connecting",
              startedAt: prev.startedAt || Date.now(),
            }
          : prev,
      );
    }

    async function onIce({ callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== "ice" || !body.candidate) return;
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId)) return;
      if (!pcRef.current?.remoteDescription) {
        pendingIceRef.current.push(body.candidate);
        return;
      }
      try {
        await pcRef.current.addIceCandidate(
          new RTCIceCandidate(body.candidate),
        );
      } catch {
        /* ignore */
      }
    }

    function onReject({ callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== "reject") return;
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId)) return;
      onMissedRef.current?.(c);
      endCallLocal();
    }

    function onHangup({ callId, envelope }) {
      const body = openEnvelope(envelope);
      if (!body || body.type !== "hangup") return;
      const c = callRef.current;
      if (!c || String(c.callId) !== String(callId)) return;
      endCallLocal();
    }

    const handlers = {
      "call:invite": onInvite,
      "call:accept": onAccept,
      "call:reject": onReject,
      "call:hangup": onHangup,
      "call:offer": onOffer,
      "call:answer": onAnswer,
      "call:ice": onIce,
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
  }, [userId, attachLocalMedia, ensurePc, ensureVideoRecvTransceiver, endCallLocal, hangup, emitSealed]);

  useEffect(() => {
    if (!call || (call.status !== "ringing" && call.status !== "incoming")) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const current = callRef.current;
      if (!current || current.callId !== call.callId) return;
      const eventName =
        current.role === "caller" ? "call:hangup" : "call:reject";
      emitSealed(eventName, {
        to: current.peerId,
        callId: current.callId,
        payload: {
          type: current.role === "caller" ? "hangup" : "reject",
          callId: current.callId,
          reason: "no_answer",
        },
      }).catch(() => {});
      onMissedRef.current?.(current);
      endCallLocal("no_answer");
    }, 45_000);
    return () => window.clearTimeout(timer);
  }, [call, emitSealed, endCallLocal]);

  useEffect(() => () => cleanupMedia(), [cleanupMedia]);

  return {
    call,
    localStream,
    remoteStream,
    screenStream,
    screenSharing: Boolean(screenStream),
    remoteScreen,
    muted,
    cameraOff,
    noiseCancel,
    audioDeviceId,
    videoDeviceId,
    audioDevices,
    videoDevices,
    startCall,
    acceptCall,
    rejectCall,
    hangup,
    toggleMute,
    toggleCamera,
    switchAudioDevice,
    switchVideoDevice,
    setNoiseCancel,
    refreshDevices,
    startScreenShare,
    stopScreenShare,
    toggleScreenShare,
  };
}
