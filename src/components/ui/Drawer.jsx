import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import useFocusTrap from '../../hooks/useFocusTrap.js';

/**
 * Side drawer for secondary menus (not primary chat navigation).
 */
export default function Drawer({
  open,
  onClose,
  side = 'left',
  children,
  className = '',
  label = 'Drawer',
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

  const xFrom = side === 'right' ? '100%' : '-100%';

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className={`qc-drawer-root ${className}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" className="qc-drawer-backdrop" aria-label="Close drawer" onClick={onClose} />
          <motion.aside
            ref={panelRef}
            className={`qc-drawer-panel qc-drawer-${side}`}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={{ x: xFrom }}
            animate={{ x: 0 }}
            exit={{ x: xFrom }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            {children}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
