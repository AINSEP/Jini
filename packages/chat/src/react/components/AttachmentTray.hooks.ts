/**
 * @file Keeps the composer's newest attachment chip visible. The tray is height-capped and scrolls
 * (`.jini-attachment-tray`'s `max-height` in `features/chat-pane/styles.ts`), so without this a chip
 * added past the second row (often the "Uploading…" placeholder) appears below the fold and the
 * operator cannot see that anything happened.
 */
import { useEffect, useRef, type RefObject } from 'react';

/** The selector for every chip the tray renders, staged or uploading; the newest is always last. */
const CHIP_SELECTOR = '.jini-attachment-chip';

/**
 * Scrolls the tray's last chip into view whenever the chip count GROWS. Not on mount (a restored
 * draft must not move the page), not on removal, and not when the uploading chip is swapped for the
 * finished one (same count, same slot). `block/inline: 'nearest'` scrolls the tray itself and moves
 * the page only if the tray is off-screen. `scrollIntoView` is checked before the call because jsdom
 * and some embedded webviews do not implement it.
 */
export function useScrollNewestChipIntoView(required: { count: number }, _optional: Record<string, never> = {}): RefObject<HTMLDivElement | null> {
  const trayRef = useRef<HTMLDivElement | null>(null);
  const previousCount = useRef(required.count);
  useEffect(() => {
    const grew = required.count > previousCount.current;
    previousCount.current = required.count;
    if (!grew) return;
    const chips = trayRef.current?.querySelectorAll<HTMLElement>(CHIP_SELECTOR);
    const newest = chips?.[chips.length - 1];
    if (newest && typeof newest.scrollIntoView === 'function') newest.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [required.count]);
  return trayRef;
}
