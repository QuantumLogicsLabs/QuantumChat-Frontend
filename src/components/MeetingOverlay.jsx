import { Mic, MicOff, Phone, PhoneOff, Users, Video, VideoOff } from 'lucide-react';
import VideoTile from './VideoTile.jsx';

export default function MeetingOverlay({
  meeting,
  participants,
  localStream,
  muted,
  cameraOff,
  resolveParticipantName,
  onJoin,
  onDecline,
  onLeave,
  onEndForAll,
  onToggleMute,
  onToggleCamera,
}) {
  if (!meeting) return null;

  const isIncoming = meeting.status === 'incoming';
  const isHost = meeting.role === 'host';
  const entries = [...(participants || new Map()).entries()];
  const participantCount = entries.length + 1;

  return (
    <div className="meeting-overlay" role="dialog" aria-modal="true" aria-label="Meeting">
      <div className="meeting-stage">
        {isIncoming ? (
          <div className="call-audio-hero">
            <div className="call-avatar-ring" aria-hidden="true">
              <Users size={28} />
            </div>
            <h2>{meeting.groupName}</h2>
            <p className="call-status-text">
              {meeting.video ? 'Incoming group video meeting' : 'Incoming group voice meeting'}
            </p>
          </div>
        ) : (
          <>
            <div className="meeting-header">
              <span className="meeting-header-title">{meeting.groupName}</span>
              <span className="meeting-header-count">
                <Users size={14} /> {participantCount}
              </span>
            </div>
            <div className="meeting-grid">
              <VideoTile stream={localStream} muted mirror label="You" />
              {entries.map(([peerId, p]) => (
                <VideoTile
                  key={peerId}
                  stream={p.stream}
                  label={resolveParticipantName?.(peerId) || 'Participant'}
                />
              ))}
            </div>
          </>
        )}

        <div className="meeting-controls">
          {isIncoming ? (
            <>
              <button type="button" className="call-ctrl accept" onClick={onJoin} aria-label="Join meeting">
                <Phone size={22} />
              </button>
              <button type="button" className="call-ctrl hangup" onClick={onDecline} aria-label="Decline meeting">
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
              {meeting.video ? (
                <button
                  type="button"
                  className={`call-ctrl${cameraOff ? ' active' : ''}`}
                  onClick={onToggleCamera}
                  aria-label={cameraOff ? 'Camera on' : 'Camera off'}
                >
                  {cameraOff ? <VideoOff size={20} /> : <Video size={20} />}
                </button>
              ) : null}
              <button type="button" className="call-ctrl hangup" onClick={onLeave} aria-label="Leave meeting">
                <PhoneOff size={22} />
              </button>
              {isHost ? (
                <button
                  type="button"
                  className="meeting-ctrl-end-all"
                  onClick={onEndForAll}
                  aria-label="End meeting for everyone"
                >
                  End for everyone
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
