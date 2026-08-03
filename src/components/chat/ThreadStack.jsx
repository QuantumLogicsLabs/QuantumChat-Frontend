import { useState } from 'react';
import { motion } from 'framer-motion';
import useSwipe from '../../hooks/useSwipe.js';

/**
 * Mobile thread stack: swipe-right to go back to the conversation list.
 */
export default function ThreadStack({
  active,
  onBack,
  children,
  className = '',
}) {
  const [dragX, setDragX] = useState(0);
  const swipe = useSwipe({
    enabled: active,
    threshold: 72,
    onMove: (dx) => setDragX(Math.max(0, dx)),
    onSwipe: (dir) => {
      setDragX(0);
      if (dir === 'right') onBack?.();
    },
  });

  return (
    <motion.div
      className={`qc-thread-stack ${active ? 'is-active' : ''} ${className}`}
      style={{ '--swipe-x': `${dragX}px` }}
      animate={active ? { x: dragX } : { x: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 40 }}
      {...(active ? swipe : {})}
      onPointerUp={(e) => {
        swipe.onPointerUp?.(e);
        setDragX(0);
      }}
    >
      {children}
    </motion.div>
  );
}
