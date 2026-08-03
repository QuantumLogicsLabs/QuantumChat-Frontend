import { playReceiveSound } from "./sounds";

/** Returns true if the current time falls inside the configured DND window (handles overnight ranges). */
function isWithinDoNotDisturb(dnd) {
  if (!dnd?.enabled) return false;
  const [startH, startM] = (dnd.startTime || '22:00').split(':').map(Number);
  const [endH, endM] = (dnd.endTime || '07:00').split(':').map(Number);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes === endMinutes) return true; // 24h DND if start === end
  if (startMinutes < endMinutes) {
    // Same-day window, e.g. 09:00 -> 17:00
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Overnight window, e.g. 22:00 -> 07:00
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

/**
 * Decide whether an incoming message/event should notify the user, given their
 * notification settings. Centralizes DND, per-type toggles, and priority so
 * every call site (socket handlers, push, etc.) applies the same rules.
 *
 * kind: 'dm' | 'group' | 'status' | 'call'
 */
export function shouldNotify(notifSettings, { kind, isMention = false } = {}) {
  if (!notifSettings) return true; // fail-open before settings load
  if (isWithinDoNotDisturb(notifSettings.doNotDisturb)) return false;
  if (notifSettings.priority === 'silent') return false;

  if (kind === 'group') {
    const mode = notifSettings.groupNotifications;
    if (mode === 'off') return false;
    if (mode === 'mentions_only' && !isMention) return false;
    if (mode === 'important_only' && !isMention) return false; // "important" = announcements/mentions for now
    return true;
  }

  if (kind === 'dm') {
    const mode = notifSettings.messageNotifications;
    if (mode === 'off') return false;
    return true; // 'all', 'direct_only', 'all_except_reactions' all permit DMs
  }

 if (kind === 'status') {
    return notifSettings.statusNotifications !== 'off';
  }

  if (kind === 'call') {
    return true; // per-type (voice/video) enable check + DND/priority already handled above
  }

  return true;
}

/** Plays the notification sound if enabled, scaled by the configured volume. */
export function playNotificationSound(notifSettings) {
  if (!notifSettings?.soundEnabled) return;
  const scale = typeof notifSettings.soundVolume === 'number' ? notifSettings.soundVolume / 100 : 1;
  playReceiveSound(scale);
}

/** Builds the { title, body } text for a popup, respecting the messagePreview setting. */
export function buildNotificationText({ senderName, messageText, isGroup, groupName }, notifSettings) {
  const preview = notifSettings?.messagePreview || 'full';
  const context = isGroup ? groupName : senderName;

  if (preview === 'hidden') {
    return { title: 'QuantumChat', body: 'New message' };
  }
  if (preview === 'sender_only') {
    return { title: context || 'QuantumChat', body: 'New message' };
  }
  // 'full'
  const body = messageText?.trim() ? messageText : '[Attachment]';
  return { title: context || 'QuantumChat', body };
}

/** Shows a real browser Notification popup, if permission is already granted. */
export function showNotificationPopup({ title, body }, notifSettings, onClick) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (notifSettings?.webNotifications?.enabled === false) return;

  try {
    const n = new Notification(title, {
      body,
      icon: '/logo.png',
      silent: true, // sound is handled separately via playNotificationSound to respect volume
      requireInteraction: notifSettings?.priority === 'high',
    });
    if (onClick) {
      n.onclick = () => {
        window.focus();
        onClick();
        n.close();
      };
    }
  } catch {
    // ignore unsupported/blocked notifications
  }
}