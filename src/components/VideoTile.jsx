import { useEffect, useRef } from 'react';

export default function VideoTile({ stream, muted = false, mirror = false, label }) {
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
