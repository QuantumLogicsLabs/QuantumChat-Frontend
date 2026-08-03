import { useCallback, useRef } from 'react';

/**
 * Horizontal swipe detector (reply / back).
 * @param {Object} opts
 * @param {(dir: 'left'|'right', deltaX: number) => void} opts.onSwipe
 * @param {number} [opts.threshold=56]
 * @param {number} [opts.maxVertical=48] - cancel if vertical drift exceeds this
 * @param {boolean} [opts.enabled=true]
 * @param {(deltaX: number) => void} [opts.onMove] - live drag for visual feedback
 */
export default function useSwipe({
  onSwipe,
  onMove,
  threshold = 56,
  maxVertical = 48,
  enabled = true,
  axis = 'x',
} = {}) {
  const startRef = useRef(null);
  const activeRef = useRef(false);

  const reset = useCallback(() => {
    startRef.current = null;
    activeRef.current = false;
    onMove?.(0);
  }, [onMove]);

  const onPointerDown = useCallback(
    (e) => {
      if (!enabled) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      activeRef.current = true;
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (e) => {
      if (!activeRef.current || !startRef.current) return;
      if (startRef.current.id !== e.pointerId) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (Math.abs(dy) > maxVertical && Math.abs(dy) > Math.abs(dx)) {
        reset();
        return;
      }
      if (axis === 'x') onMove?.(dx);
    },
    [axis, maxVertical, onMove, reset],
  );

  const onPointerUp = useCallback(
    (e) => {
      if (!activeRef.current || !startRef.current) return;
      if (startRef.current.id !== e.pointerId) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      reset();
      if (Math.abs(dy) > maxVertical && Math.abs(dy) > Math.abs(dx)) return;
      if (Math.abs(dx) < threshold) return;
      onSwipe?.(dx > 0 ? 'right' : 'left', dx);
    },
    [maxVertical, onSwipe, reset, threshold],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: reset,
  };
}
