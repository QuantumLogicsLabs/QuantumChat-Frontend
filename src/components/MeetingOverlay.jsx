import { useCallback, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, UserPlus, Users, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import CallDeviceMenu from './CallDeviceMenu.jsx';
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
  onOpenAddParticipant,
  audioDevices = [],
  videoDevices = [],
  audioDeviceId = '',
  videoDeviceId = '',
  noiseCancel = true,
  onSwitchAudioDevice,
  onSwitchVideoDevice,
  onSetNoiseCancel,
}) {
  const [speakerActive, setSpeakerActive] = useState(false);

  const supportsSpeaker =
    typeof HTMLMediaElement !== 'undefined' &&
    typeof HTMLMediaElement.prototype.setSinkId === 'function';

  const toggleSpeaker = useCallback(async () => {
    if (!supportsSpeaker) return;
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices?.();
      const audioOutputs = (devices || []).filter((d) => d.kind === 'audiooutput');
      const targetDevice = speakerActive
        ? ''
        : (audioOutputs.find((d) => d.deviceId !== 'default' && d.deviceId !== '')?.deviceId || '');

      const mediaElements = document.querySelectorAll('audio, video');
      for (const el of mediaElements) {
        if (typeof el.setSinkId === 'function') {
          await el.setSinkId(targetDevice).catch(() => {});
        }
      }
      setSpeakerActive(!speakerActive);
    } catch {
      /* ignore sink errors */
    }
  }, [speakerActive, supportsSpeaker]);

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
              {typeof onSwitchAudioDevice === 'function' ? (
                <CallDeviceMenu
                  active={muted}
                  onToggle={onToggleMute}
                  ariaLabel={muted ? 'Unmute' : 'Mute'}
                  title={muted ? 'Unmute' : 'Mute'}
                  menuTitle="Microphone"
                  devices={audioDevices}
                  selectedDeviceId={audioDeviceId}
                  onSelectDevice={(id) => {
                    onSwitchAudioDevice(id)?.catch?.(() => {});
                  }}
                  emptyLabel="No microphones found"
                  extraOptions={
                    typeof onSetNoiseCancel === 'function' ? (
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={noiseCancel}
                        className={`call-device-menu-item call-device-menu-toggle${noiseCancel ? ' is-selected' : ''}`}
                        onClick={() => {
                          onSetNoiseCancel(!noiseCancel)?.catch?.(() => {});
                        }}
                      >
                        <span className="call-device-menu-check" aria-hidden="true">
                          {noiseCancel ? '✓' : ''}
                        </span>
                        <span>Background noise cancellation</span>
                      </button>
                    ) : null
                  }
                >
                  {muted ? <MicOff size={20} /> : <Mic size={20} />}
                </CallDeviceMenu>
              ) : (
                <button
                  type="button"
                  className={`call-ctrl${muted ? ' active' : ''}`}
                  onClick={onToggleMute}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  title={muted ? 'Unmute' : 'Mute'}
                >
                  {muted ? <MicOff size={20} /> : <Mic size={20} />}
                </button>
              )}
              {typeof onSwitchVideoDevice === 'function' ? (
                <CallDeviceMenu
                  active={cameraOff}
                  onToggle={onToggleCamera}
                  ariaLabel={cameraOff ? 'Camera on' : 'Camera off'}
                  title={cameraOff ? 'Camera on' : 'Camera off'}
                  menuTitle="Camera"
                  devices={videoDevices}
                  selectedDeviceId={videoDeviceId}
                  onSelectDevice={(id) => {
                    onSwitchVideoDevice(id)?.catch?.(() => {});
                  }}
                  emptyLabel="No cameras found"
                >
                  {cameraOff ? <VideoOff size={20} /> : <Video size={20} />}
                </CallDeviceMenu>
              ) : (
                <button
                  type="button"
                  className={`call-ctrl${cameraOff ? ' active' : ''}`}
                  onClick={onToggleCamera}
                  aria-label={cameraOff ? 'Camera on' : 'Camera off'}
                  title={cameraOff ? 'Camera on' : 'Camera off'}
                >
                  {cameraOff ? <VideoOff size={20} /> : <Video size={20} />}
                </button>
              )}
              {supportsSpeaker ? (
                <button
                  type="button"
                  className={`call-ctrl${speakerActive ? ' active' : ''}`}
                  onClick={toggleSpeaker}
                  aria-label={speakerActive ? 'Earpiece' : 'Speaker'}
                  title={speakerActive ? 'Earpiece' : 'Speaker'}
                >
                  {speakerActive ? <Volume2 size={20} /> : <VolumeX size={20} />}
                </button>
              ) : null}
              {typeof onOpenAddParticipant === 'function' ? (
                <button
                  type="button"
                  className="call-ctrl"
                  onClick={onOpenAddParticipant}
                  aria-label="Add participant"
                  title="Add participant"
                >
                  <UserPlus size={20} />
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
