import { useState, memo, useRef } from 'react';
import { Reply } from 'lucide-react';
import useSwipe from '../../hooks/useSwipe.js';
import useLongPress from '../../hooks/useLongPress.js';
import MessageBubble from '../MessageBubble.jsx';

/**
 * Swipe-to-reply + long-press action sheet trigger around a message bubble.
 */
function SwipeableMessage({
  message,
  isMine,
  onReply,
  onLongPress,
  onDoubleTap,
  children,
  ...bubbleProps
}) {
  const [dx, setDx] = useState(0);
  const lastTapRef = useRef(0);
  const swipe = useSwipe({
    threshold: 56,
    onMove: (d) => {
      setDx(Math.max(0, Math.min(72, d)));
    },
    onSwipe: (dir) => {
      setDx(0);
      if (dir === 'right') onReply?.(message);
    },
  });

  const longPress = useLongPress(
    (e) => {
      e?.preventDefault?.();
      onLongPress?.(message);
    },
    { delay: 480 },
  );

  const handleClick = (e) => {
    if (longPress.didFire?.()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      onDoubleTap?.(message);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };

  return (
    <div
      className={`qc-swipe-reply-wrap qc-msg-row${dx > 12 ? ' is-swiping' : ''}`}
      style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
      onClick={handleClick}
      {...swipe}
      {...longPress}
    >
      <span className="qc-swipe-reply-hint" aria-hidden="true">
        <Reply size={18} />
      </span>
      {children || (
        <MessageBubble
          message={message}
          isMine={isMine}
          onReply={onReply}
          {...bubbleProps}
        />
      )}
    </div>
  );
}

export default memo(SwipeableMessage);
