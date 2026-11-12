/**
 * Shared getUserMedia helpers for calls: device picking + noise cancellation.
 */

export function buildAudioConstraints(deviceId, { noiseCancel = true, voiceIsolation = true } = {}) {
  const audio = {
    echoCancellation: true,
    noiseSuppression: Boolean(noiseCancel),
    autoGainControl: true,
  };
  // Chromium "voice isolation" — stronger background voice/noise cancel when supported.
  if (noiseCancel && voiceIsolation) {
    audio.voiceIsolation = true;
  }
  if (deviceId) {
    audio.deviceId = { exact: deviceId };
  }
  return audio;
}

export function buildVideoConstraints(deviceId) {
  if (!deviceId) return true;
  return { deviceId: { exact: deviceId } };
}

/** Try preferred constraints, then fall back if the browser rejects voiceIsolation. */
export async function getCallMedia({
  audio = true,
  video = false,
  audioDeviceId,
  videoDeviceId,
  noiseCancel = true,
} = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Media devices are not available');
  }

  const videoConstraint = video ? buildVideoConstraints(videoDeviceId) : false;

  if (!audio) {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraint,
    });
  }

  const attempts = [
    {
      audio: buildAudioConstraints(audioDeviceId, { noiseCancel, voiceIsolation: true }),
      video: videoConstraint,
    },
    {
      audio: buildAudioConstraints(audioDeviceId, { noiseCancel, voiceIsolation: false }),
      video: videoConstraint,
    },
    {
      audio: audioDeviceId
        ? { deviceId: { exact: audioDeviceId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: videoConstraint,
    },
  ];

  let lastError;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      // Only fall through on constraint / not-found errors.
      if (
        err?.name !== 'OverconstrainedError' &&
        err?.name !== 'NotFoundError' &&
        err?.name !== 'TypeError'
      ) {
        throw err;
      }
    }
  }
  throw lastError || new Error('Could not access microphone/camera');
}

export async function listInputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { audioInputs: [], videoInputs: [] };
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Microphone ${i + 1}`,
      groupId: d.groupId,
    }));
  const videoInputs = devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
      groupId: d.groupId,
    }));
  return { audioInputs, videoInputs };
}

export function currentTrackDeviceId(stream, kind) {
  if (!stream) return '';
  const track =
    kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
  return track?.getSettings?.()?.deviceId || '';
}
