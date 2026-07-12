import { useEffect } from 'react';

// Shared reference counter to avoid premature unlocks when multiple overlays are open
let lockCount = 0;
let originalOverflow = '';

export function useScrollLock(lock) {
  useEffect(() => {
    if (!lock) return;

    if (lockCount === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount++;

    return () => {
      lockCount--;
      if (lockCount === 0) {
        document.body.style.overflow = originalOverflow || '';
      }
    };
  }, [lock]);
}
