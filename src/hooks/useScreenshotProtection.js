import { useEffect, useRef } from 'react';

/**
 * Best-effort screenshot / screen-capture protection for the web app.
 *
 * Browsers cannot fully block OS screenshots. This hook:
 * - Instantly blacks out the viewport on known capture shortcuts
 * - Blacks out while the tab is hidden (helps Snipping Tool / app switch)
 * - Holds the blackout briefly after the tab returns (capture often finishes then)
 * - Notifies via onAttempt (debounced)
 *
 * Mobile apps use FLAG_SECURE / iOS capture APIs for stronger enforcement.
 */
export function useScreenshotProtection(enabled, { onAttempt, scope = 'chat' } = {}) {
  const onAttemptRef = useRef(onAttempt);
  onAttemptRef.current = onAttempt;
  const flashTimerRef = useRef(null);
  const holdTimerRef = useRef(null);
  const lastNotifyAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;

    const root = document.documentElement;
    root.classList.add('qc-screenshot-protection');
    root.dataset.qcProtectScope = scope;
    root.classList.remove('qc-screenshot-blur');

    function ensureOverlay() {
      let overlay = document.getElementById('qc-screenshot-flash');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'qc-screenshot-flash';
        overlay.className = 'qc-screenshot-flash';
        overlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(overlay);
      }
      return overlay;
    }

    function notify(reason) {
      const now = Date.now();
      // Avoid toast spam when keydown+keyup both fire.
      if (now - lastNotifyAtRef.current < 1600) return;
      lastNotifyAtRef.current = now;
      onAttemptRef.current?.(reason || 'screenshot');
    }

    function setBlackout(active) {
      const overlay = ensureOverlay();
      if (active) {
        // Force a synchronous paint path: no fade-in (OS often captures within ms).
        overlay.style.transition = 'none';
        overlay.classList.add('is-active');
        // Re-enable fade-out for when we clear.
        requestAnimationFrame(() => {
          overlay.style.transition = '';
        });
      } else {
        overlay.classList.remove('is-active');
      }
    }

    function flashPrivacyOverlay(reason, holdMs = 1100) {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      setBlackout(true);
      notify(reason);
      flashTimerRef.current = window.setTimeout(() => {
        setBlackout(false);
      }, holdMs);
    }

    function isPrintScreen(e) {
      const key = e.key || '';
      const code = e.code || '';
      // keyCode 44 = PrintScreen (still set on some browsers)
      return (
        key === 'PrintScreen' ||
        code === 'PrintScreen' ||
        e.keyCode === 44 ||
        e.which === 44
      );
    }

    function isScreenshotChord(e) {
      if (isPrintScreen(e)) return true;

      // Windows Snipping Tool: Win+Shift+S
      if (e.shiftKey && !e.ctrlKey && !e.altKey) {
        const k = String(e.key || '').toLowerCase();
        const win =
          e.metaKey ||
          e.getModifierState?.('Meta') ||
          e.getModifierState?.('OS') ||
          e.getModifierState?.('Super');
        if (win && (k === 's' || e.code === 'KeyS')) return true;
      }

      // macOS: Cmd+Shift+3/4/5
      if (e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey) {
        const k = String(e.key || '').toLowerCase();
        if (k === '3' || k === '4' || k === '5') return true;
        if (e.code === 'Digit3' || e.code === 'Digit4' || e.code === 'Digit5') return true;
      }

      return false;
    }

    function onCaptureKey(e) {
      if (!isScreenshotChord(e)) return;
      // Cannot cancel OS capture, but blackout ASAP.
      flashPrivacyOverlay('screenshot', 1200);
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
        if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
        setBlackout(true);
        notify('screen-capture');
        return;
      }
      // Tab visible again — keep blackout briefly (Snipping Tool / Share often
      // finishes the grab after focus returns).
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = window.setTimeout(() => {
        if (document.visibilityState === 'visible') setBlackout(false);
      }, 900);
    }

    // Capture phase so we run before other handlers.
    document.addEventListener('keydown', onCaptureKey, true);
    // PrintScreen often only surfaces on keyup in Chromium/Windows.
    document.addEventListener('keyup', onCaptureKey, true);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('keydown', onCaptureKey, true);
      document.removeEventListener('keyup', onCaptureKey, true);
      document.removeEventListener('visibilitychange', onVisibility);
      root.classList.remove('qc-screenshot-protection', 'qc-screenshot-blur');
      delete root.dataset.qcProtectScope;
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      document.getElementById('qc-screenshot-flash')?.remove();
    };
  }, [enabled, scope]);
}
