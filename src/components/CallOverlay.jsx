import { useEffect, useRef } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';

function VideoTile({ stream, muted = false, mirror = false, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream || null;
  }, [stream]);

  return (
    <div className={`call-video-tile${mirror ? ' mirror' : ''}`}>
      <video ref={ref} autoPlay playsInline muted={muted} />
      {label ? <span className="call-video-label">{label}</span> : null}
    </div>
  );
}

export default function CallOverlay({
  call,
  localStream,
  remoteStream,
  muted,
  cameraOff,
  peerLabel,
  onAccept,
  onReject,
  onHangup,
  onToggleMute,
  onToggleCamera,
}) {
  if (!call) return null;

  const name = peerLabel || call.peerName || 'User';
  const isIncoming = call.status === 'incoming';
  const isRinging = call.status === 'ringing';
  const inMedia = call.status === 'connecting' || call.status === 'active';

  return (
    <div className="call-overlay" role="dialog" aria-modal="true" aria-label="Call">
      <div className={`call-stage${call.video ? ' has-video' : ''}`}>
        {call.video && inMedia ? (
          <>
            <VideoTile stream={remoteStream} label={name} />
            <div className="call-pip">
              <VideoTile stream={localStream} muted mirror label="You" />
            </div>
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
            {inMedia && remoteStream ? (
              <audio
                autoPlay
                ref={(el) => {
                  if (el) el.srcObject = remoteStream;
                }}
              />
            ) : null}
          </div>
        )}

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
