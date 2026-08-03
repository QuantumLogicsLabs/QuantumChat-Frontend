import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getNotificationSettings, updateNotificationSettings } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const DEFAULT_SETTINGS = {
  messageNotifications: 'all',
  statusNotifications: 'all',
  soundEnabled: true,
  soundVolume: 80,
  messagePreview: 'full',
  vibration: 'on',
  doNotDisturb: { enabled: false, startTime: '22:00', endTime: '07:00', allowedContacts: [] },
  groupNotifications: 'all',
  callNotifications: {
    voiceCallEnabled: true,
    videoCallEnabled: true,
    vibrateOnCall: true,
    missedCallReminders: true,
  },
  badgeCount: 'show',
  webNotifications: { enabled: true, soundOnWeb: true, syncReadAcrossDevices: true },
  priority: 'normal',
};

const NotificationSettingsContext = createContext(null);

export function NotificationSettingsProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setSettings(DEFAULT_SETTINGS);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getNotificationSettings()
      .then((res) => {
        if (!cancelled && res?.data) {
          setSettings((prev) => ({ ...prev, ...res.data }));
        }
      })
      .catch(() => {
        // keep defaults on failure
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const updateSettings = useCallback(async (partial) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    try {
      const res = await updateNotificationSettings(partial);
      if (res?.data) {
        setSettings((prev) => ({ ...prev, ...res.data }));
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.response?.data?.error || err.message };
    }
  }, []);

  const isMuted = useCallback(
    (chatId) => {
      // Placeholder hook point for per-chat mute logic (Section 7).
      // Per-chat mutes will live on the chat/conversation model, not here.
      return false;
    },
    []
  );

  const value = useMemo(
    () => ({ settings, loading, updateSettings, isMuted }),
    [settings, loading, updateSettings, isMuted]
  );

  return (
    <NotificationSettingsContext.Provider value={value}>
      {children}
    </NotificationSettingsContext.Provider>
  );
}

export function useNotificationSettings() {
  const ctx = useContext(NotificationSettingsContext);
  if (!ctx) throw new Error('useNotificationSettings must be used within NotificationSettingsProvider');
  return ctx;
}