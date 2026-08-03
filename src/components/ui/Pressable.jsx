import { useCallback, useRef } from 'react';
import useLongPress from '../../hooks/useLongPress.js';

/**
 * Pressable wrapper: long-press + optional double-tap.
 */
export default function Pressable({
  children,
  className = '',
  onLongPress,
  onDoubleTap,
  onClick,
  longPressDelay = 450,
  disabled = false,
  as: Comp = 'div',
  ...rest
}) {
  const lastTapRef = useRef(0);
  const longPress = useLongPress(
    (e) => {
      onLongPress?.(e);
    },
    { delay: longPressDelay, enabled: !disabled && Boolean(onLongPress) },
  );

  const handleClick = useCallback(
    (e) => {
      if (longPress.didFire?.()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const now = Date.now();
      if (onDoubleTap && now - lastTapRef.current < 320) {
        lastTapRef.current = 0;
        onDoubleTap(e);
        return;
      }
      lastTapRef.current = now;
      onClick?.(e);
    },
    [longPress, onClick, onDoubleTap],
  );

  return (
    <Comp
      className={`qc-pressable ${className}`}
      onClick={handleClick}
      {...longPress}
      {...rest}
    >
      {children}
    </Comp>
  );
}
