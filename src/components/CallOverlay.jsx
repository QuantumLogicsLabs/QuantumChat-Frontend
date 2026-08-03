import { useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Video,
  VideoOff,
} from 'lucide-react';

function attachStream(el, stream, { muted = false } = {}) {
  if (!el) return;
  el.muted = muted;
  if (el.srcObject !== stream) {
    el.srcObject = stream || null;
  }
  if (stream) {
    // Browsers often block autoplay; explicit play() is required once media arrives.
    const playAttempt = el.play();
    if (playAttempt?.catch) playAttempt.catch(() => {});
  }
}

function VideoTile({ stream, muted = false, mirror = false, contain = false, label }) {
  const ref = useRef(null);
  useEffect(() => {
    attachStream(ref.current, stream, { muted });
  }, [stream, muted]);

  return (
    <div
      className={`call-video-tile${mirror ? ' mirror' : ''}${contain ? ' is-contain' : ''}`}
    >
      <video ref={ref} autoPlay playsInline muted={muted} />
      {label ? <span className="call-video-label">{label}</span> : null}
    </div>
  );
}

/** Always-mounted remote audio sink so late-arriving tracks still play. */
function RemoteAudio({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    attachStream(ref.current, stream, { muted: false });
  }, [stream]);

  // Also retry play when tracks unmute/start after ICE finishes.
  useEffect(() => {
    if (!stream) return undefined;
    const onLive = () => attachStream(ref.current, stream, { muted: false });
    const tracks = stream.getAudioTracks();
    for (const track of tracks) {
      track.addEventListener('unmute', onLive);
    }
    return () => {
      for (const track of tracks) {
        track.removeEventListener('unmute', onLive);
      }
    };
  }, [stream]);

  return <audio ref={ref} autoPlay playsInline style={{ display: 'none' }} />;
}

export default function CallOverlay({
  call,
  localStream,
  remoteStream,
  screenStream,
  screenSharing = false,
  remoteScreen = false,
  muted,
  cameraOff,
  peerLabel,
  minimized = false,
  onToggleMinimize,
  onAccept,
  onReject,
  onHangup,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
}) {
  if (!call) return null;

  const name = peerLabel || call.peerName || 'User';
  const isIncoming = call.status === 'incoming';
  const isRinging = call.status === 'ringing';
  const inMedia = call.status === 'connecting' || call.status === 'active';
  // A screen share turns a voice call into a video layout on both ends.
  const showsRemoteVideo = inMedia && (call.video || remoteScreen);
  const showsOwnScreenOnly = inMedia && screenSharing && !showsRemoteVideo;
  const showsVideo = showsRemoteVideo || showsOwnScreenOnly;
  const canShareScreen =
    typeof onToggleScreenShare === 'function' &&
    inMedia &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getDisplayMedia);

  return (
    <div
      className={`call-overlay${minimized ? ' is-minimized' : ''}`}
      role="dialog"
      aria-modal={!minimized}
      aria-label="Call"
    >
      <div className={`call-stage${showsVideo ? ' has-video' : ''}`}>
        <div className="call-mini-banner">
          <div>
            <strong>{name}</strong>
            <div className="call-status-text">
              {isIncoming
                ? 'Incoming…'
                : isRinging
                  ? 'Calling…'
                  : screenSharing
                    ? 'Sharing screen'
                    : remoteScreen
                      ? `${name} is sharing`
                      : 'In call'}
            </div>
          </div>
          <button type="button" className="call-ctrl" onClick={onToggleMinimize} aria-label="Expand call">
            <Phone size={18} />
          </button>
        </div>
        {showsVideo ? (
          <>
            {showsRemoteVideo ? (
              <VideoTile
                stream={remoteStream}
                contain={remoteScreen}
                label={remoteScreen ? `${name}'s screen` : name}
                muted
              />
            ) : (
              <VideoTile stream={screenStream} muted contain label="Your screen" />
            )}
            {showsRemoteVideo && (call.video || screenSharing) ? (
              <div className="call-pip">
                {screenSharing ? (
                  <VideoTile stream={screenStream} muted contain label="Your screen" />
                ) : (
                  <VideoTile stream={localStream} muted mirror label="You" />
                )}
              </div>
            ) : null}
          </>
        ) : (
          <div className="call-audio-hero">
            <div className="call-avatar-ring" aria-hidden="true">
              {(name || '?').slice(0, 2).toUpperCase()}
            </div>
            <h2>{name}</h2>
            <p className="call-status-text">
              {isIncoming
                ? call.video
                  ? 'Incoming video call'
                  : 'Incoming voice call'
                : isRinging
                  ? 'Calling…'
                  : call.status === 'connecting'
                    ? 'Connecting…'
                    : call.video
                      ? 'Video call'
                      : 'Voice call'}
            </p>
          </div>
        )}

        {/* Remote audio must play for voice and video calls (video element alone is unreliable). */}
        {inMedia ? <RemoteAudio stream={remoteStream} /> : null}

        <div className="call-controls">
          {isIncoming ? (
            <>
              <button type="button" className="call-ctrl accept" onClick={onAccept} aria-label="Accept call">
                <Phone size={22} />
              </button>
              <button type="button" className="call-ctrl hangup" onClick={onReject} aria-label="Reject call">
                <PhoneOff size={22} />
              </button>
            </>
          ) : (
            <>
              {typeof onToggleMinimize === 'function' ? (
                <button
                  type="button"
                  className="call-ctrl"
                  onClick={onToggleMinimize}
                  aria-label={minimized ? 'Expand call' : 'Minimize call'}
                >
                  <Phone size={18} />
                </button>
              ) : null}
              <button
                type="button"
                className={`call-ctrl${muted ? ' active' : ''}`}
                onClick={onToggleMute}
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              {call.video ? (
                <button
                  type="button"
                  className={`call-ctrl${cameraOff ? ' active' : ''}`}
                  onClick={onToggleCamera}
                  aria-label={cameraOff ? 'Camera on' : 'Camera off'}
                >
                  {cameraOff ? <VideoOff size={20} /> : <Video size={20} />}
                </button>
              ) : null}
              {canShareScreen ? (
                <button
                  type="button"
                  className={`call-ctrl${screenSharing ? ' active' : ''}`}
                  onClick={onToggleScreenShare}
                  aria-label={screenSharing ? 'Stop sharing screen' : 'Share screen'}
                  title={screenSharing ? 'Stop sharing screen' : 'Share screen'}
                >
                  {screenSharing ? <ScreenShareOff size={20} /> : <ScreenShare size={20} />}
                </button>
              ) : null}
              <button type="button" className="call-ctrl hangup" onClick={onHangup} aria-label="End call">
                <PhoneOff size={22} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
