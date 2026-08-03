import { useEffect, useState } from 'react';

/**
 * Tracks visualViewport so the composer stays above the mobile keyboard.
 * Sets --vv-height / --vv-offset-top on documentElement.
 */
export default function useVisualViewport(enabled = true) {
  const [viewport, setViewport] = useState(() => ({
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
    offsetTop: 0,
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
  }));

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;

    const vv = window.visualViewport;
    const sync = () => {
      const height = vv?.height ?? window.innerHeight;
      const offsetTop = vv?.offsetTop ?? 0;
      const width = vv?.width ?? window.innerWidth;
      setViewport({ height, offsetTop, width });
      const root = document.documentElement;
      root.style.setProperty('--vv-height', `${height}px`);
      root.style.setProperty('--vv-offset-top', `${offsetTop}px`);
      root.style.setProperty('--vv-keyboard-inset', `${Math.max(0, window.innerHeight - height - offsetTop)}px`);
    };

    sync();
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [enabled]);

  return viewport;
}
