import type { TabStripHapticsPort } from './ports.js';

/** SSR-safe, opportunistic browser haptics. Unavailable or failed vibration must never stop dragging. */
export function createBrowserTabStripHaptics(): TabStripHapticsPort {
  return {
    pulse(durationMs: number) {
      if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
      try {
        navigator.vibrate(durationMs);
      } catch {
        // Haptics are opportunistic; unsupported environments keep dragging normally.
      }
    },
  };
}
