/** A page must be at least this many viewports tall before the jump buttons are worth their space. */
export const SCROLL_JUMP_MIN_VIEWPORTS = 2;

/** Within this many px of an edge counts as AT that edge (fractional scroll positions never hit 0 exactly). */
export const SCROLL_JUMP_EDGE_SLACK_PX = 8;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface ScrollJumpVisibility {
  showTop: boolean;
  showBottom: boolean;
}

/**
 * Which jump buttons a scroll container shows: none on a short page, ↑ only once scrolled away from
 * the top, ↓ only while there is more below.
 * @complexity O(1).
 */
export function scrollJumpVisibility(
  { scrollTop, scrollHeight, clientHeight }: ScrollMetrics,
  { minViewports = SCROLL_JUMP_MIN_VIEWPORTS, edgeSlackPx = SCROLL_JUMP_EDGE_SLACK_PX }: { minViewports?: number; edgeSlackPx?: number } = {},
): ScrollJumpVisibility {
  if (clientHeight <= 0 || scrollHeight < clientHeight * minViewports) return { showTop: false, showBottom: false };
  return {
    showTop: scrollTop > edgeSlackPx,
    showBottom: scrollHeight - scrollTop - clientHeight > edgeSlackPx,
  };
}

/** Reduced-motion users get an instant jump instead of a long animated scroll. */
export function scrollJumpBehavior({ reducedMotion }: { reducedMotion: boolean }): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth";
}

/** The `scrollTo` target for an edge: 0 for the top, the full content height for the bottom. */
export function scrollJumpTarget({ edge, scrollHeight }: { edge: "top" | "bottom"; scrollHeight: number }): number {
  return edge === "top" ? 0 : scrollHeight;
}
