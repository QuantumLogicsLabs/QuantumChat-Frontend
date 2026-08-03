import { useCallback, useRef } from 'react';

const DEFAULT_MS = 450;

/**
 * Long-press detector for message action sheets.
 * Cancels on move beyond threshold or early release.
 */
export default function useLongPress(onLongPress, {
  delay = DEFAULT_MS,
  moveThreshold = 10,
  enabled = true,
} = {}) {
  const timerRef = useRef(null);
  const startRef = useRef(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e) => {
      if (!enabled || !onLongPress) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      firedRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
      clear();
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        onLongPress(e);
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try {
            navigator.vibrate(12);
          } catch {
            /* ignore */
          }
        }
      }, delay);
    },
    [clear, delay, enabled, onLongPress],
  );

  const onPointerMove = useCallback(
    (e) => {
      if (!startRef.current || !timerRef.current) return;
      const dx = Math.abs(e.clientX - startRef.current.x);
      const dy = Math.abs(e.clientY - startRef.current.y);
      if (dx > moveThreshold || dy > moveThreshold) clear();
    },
    [clear, moveThreshold],
  );

  const onPointerUp = useCallback(() => {
    clear();
    startRef.current = null;
  }, [clear]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onPointerLeave: onPointerUp,
    didFire: () => firedRef.current,
  };
}
