import { useCallback, useEffect, useRef, useState } from 'react';
import useFocusTrap from '../hooks/useFocusTrap.js';

/**
 * Camera capture modal — takes a still photo and returns a File (JPEG).
 */
export default function CameraCapture({ open, onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const containerRef = useRef(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useFocusTrap(containerRef, open);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return undefined;
    }

    let cancelled = false;
    setError('');

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError('Camera is not supported in this browser');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch {
        if (!cancelled) setError('Could not access camera — check permissions');
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, stopCamera]);

  function handleCapture() {
    const video = videoRef.current;
    if (!video || !ready) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
        stopCamera();
        onCapture?.(file);
        onClose?.();
      },
      'image/jpeg',
      0.92
    );
  }

  if (!open) return null;

  return (
    <div className="camera-overlay" role="dialog" aria-modal="true" aria-label="Camera capture">
      <div className="camera-panel" ref={containerRef}>
        <div className="camera-header">
          <strong>Take a photo</strong>
          <button type="button" className="composer-context-close" onClick={onClose} aria-label="Close camera">
            ✕
          </button>
        </div>
        {error ? (
          <p className="camera-error">{error}</p>
        ) : (
          <video ref={videoRef} className="camera-video" playsInline muted autoPlay />
        )}
        <div className="camera-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleCapture} disabled={!ready || !!error}>
            Capture
          </button>
        </div>
        <p className="camera-hint">Photo is end-to-end encrypted before upload</p>
      </div>
    </div>
  );
}
