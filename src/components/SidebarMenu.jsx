import { AnimatePresence, motion } from 'framer-motion';
import { Cake, CheckCheck, Clock, Lock, LogOut, MoreVertical, Settings, Star, Unlock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { preload } from '../utils/preload.js';

// Self-contained (inline styles, no CSS file dependency) so the dot can't
// silently go missing if a stylesheet edit didn't get applied.
function UnreadDot({ style }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: '#ef4444',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

export default function SidebarMenu({
  onSettings,
  onLogout,
  onMarkAllRead,
  onOpenStarred,
  vaultEnabled,
  vaultUnlocked,
  onOpenVault,
  unreadNotificationCount = 0,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function onDocClick(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="sidebar-menu" ref={rootRef}>
      <motion.button
        type="button"
        className={`sidebar-menu-trigger ${open ? 'open' : ''}`}
        aria-label="Open menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.97 }}
        style={{ position: 'relative' }}
      >
        <MoreVertical size={18} strokeWidth={2.2} aria-hidden="true" />
          {unreadNotificationCount > 0 && (
            <UnreadDot style={{ position: 'absolute', top: 3, right: 3, border: '2px solid var(--bg-elevated, #fff)', width: 11, height: 11, boxSizing: 'border-box' }} />
          )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="sidebar-menu-dropdown"
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              type="button"
              className="sidebar-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onMarkAllRead?.();
              }}
            >
              <span className="sidebar-menu-item-left">
                <CheckCheck size={16} aria-hidden="true" />
                <span>{t('nav.markAllRead', 'Mark all as read')}</span>
              </span>
            </button>

            <div className="sidebar-menu-divider" />

            <button
              type="button"
              className="sidebar-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenStarred?.();
              }}
            >
              <span className="sidebar-menu-item-left">
                <Star size={16} aria-hidden="true" />
                <span>{t('nav.starredMessages', 'Important messages')}</span>
              </span>
            </button>

           <div className="sidebar-menu-divider" />

            <button
              type="button"
              className="sidebar-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenVault?.();
              }}
            >
              <span className="sidebar-menu-item-left">
                {vaultEnabled && vaultUnlocked ? (
                  <Unlock size={16} aria-hidden="true" />
                ) : (
                  <Lock size={16} aria-hidden="true" />
                )}
                <span>
                  {!vaultEnabled
                    ? t('nav.setUpVault', 'Set up vault')
                    : vaultUnlocked
                      ? t('nav.lockVault', 'Lock vault')
                      : t('nav.unlockVault', 'Unlock vault')}
                </span>
              </span>
            </button>

            <div className="sidebar-menu-divider" />
            <button
              type="button"
              className="sidebar-menu-item"
              role="menuitem"
              onMouseEnter={() => preload('settings')}
              onFocus={() => preload('settings')}
              onTouchStart={() => preload('settings')}
              onClick={() => {
                setOpen(false);
                onSettings?.();
              }}
            >
              <span className="sidebar-menu-item-left">
                <Settings size={16} aria-hidden="true" />
                <span>{t('nav.settings', 'Settings')}</span>
              </span>
            </button>

            <button
              type="button"
              className="sidebar-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate('/chat/activity');
              }}
            >
              <span className="sidebar-menu-item-left">
                <Clock size={16} aria-hidden="true" />
                <span>{t('nav.activity', 'Activity')}</span>
                 {unreadNotificationCount > 0 && <UnreadDot style={{ marginLeft: 8 }} />}
              </span>
            </button>

              <button
                type="button"
                className="sidebar-menu-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  navigate('/chat/birthdays');
                }}
              >
                <span className="sidebar-menu-item-left">
                  <Cake size={16} aria-hidden="true" />
                  <span>{t('nav.birthdays', 'Birthday Calendar')}</span>
                </span>
              </button>

            <div className="sidebar-menu-divider" />

            <button
              type="button"
              className="sidebar-menu-item danger"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLogout?.();
              }}
            >
              <span className="sidebar-menu-item-left">
                <LogOut size={16} aria-hidden="true" />
                <span>{t('nav.logout', 'Log out')}</span>
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
