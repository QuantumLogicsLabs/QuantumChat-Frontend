import { useEffect } from 'react';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * useFocusTrap — Traps keyboard focus inside the element pointed to by `ref`.
 * When `active` is true, Tab/Shift+Tab will cycle within the container.
 *
 * @param {React.RefObject} ref - Ref to the modal/dialog container element.
 * @param {boolean} [active=true] - Whether the trap is active.
 */
export default function useFocusTrap(ref, active = true) {
  useEffect(() => {
    if (!active || !ref.current) return;

    const container = ref.current;

    // Focus the first focusable element on mount
    const firstFocusable = container.querySelectorAll(FOCUSABLE_SELECTORS)[0];
    firstFocusable?.focus();

    function handleKeyDown(e) {
      if (e.key !== 'Tab') return;

      const focusableEls = Array.from(container.querySelectorAll(FOCUSABLE_SELECTORS));
      if (focusableEls.length === 0) return;

      const first = focusableEls[0];
      const last = focusableEls[focusableEls.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if focus is on first element, wrap to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if focus is on last element, wrap to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [ref, active]);
}
