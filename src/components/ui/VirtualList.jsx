import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Thin virtual list wrapper for conversation / message lists.
 * Falls back to plain children render when itemCount is small.
 */
export default function VirtualList({
  count,
  estimateSize,
  overscan = 8,
  className = '',
  style,
  getItemKey,
  children,
  scrollRef,
  enabled = true,
  threshold = 40,
}) {
  const internalRef = useRef(null);
  const parentRef = scrollRef || internalRef;
  const shouldVirtualize = enabled && count >= threshold;

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? count : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: typeof estimateSize === 'function' ? estimateSize : () => estimateSize || 72,
    overscan,
    getItemKey: getItemKey || ((i) => i),
  });

  if (!shouldVirtualize) {
    return (
      <div ref={parentRef} className={className} style={{ overflow: 'auto', ...style }}>
        {Array.from({ length: count }, (_, index) => children({ index, key: getItemKey?.(index) ?? index }))}
      </div>
    );
  }

  const items = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef} className={className} style={{ overflow: 'auto', ...style }}>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {items.map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start}px)`,
            }}
          >
            {children({ index: item.index, key: item.key })}
          </div>
        ))}
      </div>
    </div>
  );
}
