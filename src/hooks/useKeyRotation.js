import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const ROTATION_INTERVAL_MS = 30 * 60 * 1000;

// Keeps the user's published public key fresh: rotates it every 30 minutes
// while the app is open, catching up immediately on load if the last local
// key is already older than the window (e.g. the tab was closed overnight).
// Rotation only runs client-side while mounted — it cannot fire while the
// browser is closed, which is an inherent limit of a browser-only keyholder.
export function useKeyRotation() {
  const { user, hasLocalKeyring, currentKeyPair, rotateKey } = useAuth();
  const rotatingRef = useRef(false);

  useEffect(() => {
    if (!user || !hasLocalKeyring) return undefined;

    let timeoutId;

    const scheduleNext = (delayMs) => {
      timeoutId = setTimeout(runRotation, Math.max(delayMs, 0));
    };

    async function runRotation() {
      if (rotatingRef.current) return;
      rotatingRef.current = true;
      try {
        await rotateKey();
      } catch (err) {
        console.error('Key rotation failed, will retry next cycle:', err);
      } finally {
        rotatingRef.current = false;
        scheduleNext(ROTATION_INTERVAL_MS);
      }
    }

    const age = Date.now() - (currentKeyPair?.createdAt ?? 0);
    const delay = age >= ROTATION_INTERVAL_MS ? 0 : ROTATION_INTERVAL_MS - age;
    scheduleNext(delay);

    return () => clearTimeout(timeoutId);
    // Deliberately excludes currentKeyPair/rotateKey from deps: this effect
    // should only re-evaluate the schedule when the user identity changes,
    // not every time rotation updates currentKeyPair (which would loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, hasLocalKeyring]);
}
