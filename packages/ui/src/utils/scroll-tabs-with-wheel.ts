// Translates vertical mouse-wheel motion into horizontal scrolling for an
// overflowing tab strip, so a plain trackpad/mouse wheel scrolls sideways
// without requiring Shift. Deliberately generic over the DOM: callers pass
// only the exact `HTMLDivElement`/`WheelEvent` fields this needs (via
// `Pick`), which makes it trivial to unit-test with a plain object double
// instead of a real DOM node.

/**
 * Applies one wheel event to `tabBar`'s horizontal scroll position, if the
 * event represents vertical wheel motion over an overflowing strip.
 *
 * Skipped (no scroll, no `preventDefault`) when:
 * - `ctrlKey` is set (pinch-zoom gesture, not a scroll intent).
 * - The horizontal delta is already dominant (a trackpad two-finger
 *   horizontal swipe should scroll natively, not be redirected).
 * - The strip isn't actually overflowing (`scrollWidth <= clientWidth`).
 * - The computed scroll would not change `scrollLeft` (already at the
 *   start/end of the strip) — lets the browser handle page scroll instead
 *   of swallowing the event at a boundary.
 *
 * Otherwise scrolls `tabBar` horizontally by the vertical delta (converted
 * to pixels per `deltaMode`) and calls `event.preventDefault()` so the page
 * itself doesn't also scroll vertically.
 */
export function scrollTabsWithWheel(
  { tabBar, event }: {
    tabBar: Pick<HTMLDivElement, 'clientWidth' | 'scrollLeft' | 'scrollWidth'>;
    event: Pick<globalThis.WheelEvent, 'ctrlKey' | 'deltaMode' | 'deltaX' | 'deltaY' | 'preventDefault'>;
  },
): void {
  if (event.ctrlKey) return;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  if (tabBar.scrollWidth <= tabBar.clientWidth) return;

  const before = tabBar.scrollLeft;
  tabBar.scrollLeft += wheelDeltaToPixels(event.deltaY, event.deltaMode);
  if (tabBar.scrollLeft === before) return;

  event.preventDefault();
}

const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;

/** Converts a wheel delta to pixels per the standard `WheelEvent.deltaMode` values (0=pixel, 1=line, 2=page). */
function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  if (deltaMode === WHEEL_DELTA_LINE) return delta * 16;
  if (deltaMode === WHEEL_DELTA_PAGE) return delta * 160;
  return delta;
}
