import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import useFocusTrap from '../../hooks/useFocusTrap.js';

/**
 * Mobile-first bottom sheet / desktop-centered modal sheet.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  className = '',
  labelledBy,
}) {
  const panelRef = useRef(null);
  useFocusTrap(panelRef, open, { onEscape: onClose });

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={`qc-sheet-root ${className}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <button
            type="button"
            className="qc-sheet-backdrop"
            aria-label="Close"
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            className="qc-sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy || (title ? 'qc-sheet-title' : undefined)}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            <div className="qc-sheet-handle" aria-hidden="true" />
            {title ? (
              <header className="qc-sheet-header">
                <h2 id="qc-sheet-title">{title}</h2>
                <button type="button" className="qc-sheet-close" onClick={onClose} aria-label="Close">
                  ×
                </button>
              </header>
            ) : null}
            <div className="qc-sheet-body">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
