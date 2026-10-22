import { useCallback, useEffect, useState } from "react";

import { scrollJumpBehavior, scrollJumpTarget, scrollJumpVisibility, type ScrollJumpVisibility } from "./ScrollJump.rules.js";

const HIDDEN: ScrollJumpVisibility = { showTop: false, showBottom: false };
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface ScrollJumpController extends ScrollJumpVisibility {
  jump: (edge: "top" | "bottom") => void;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && (window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false);

/**
 * Tracks whether `container` is tall enough for jump buttons and which edges it is away from.
 * Scroll events alone miss content that loads or grows without scrolling (a media grid filling in),
 * so a ResizeObserver watches the container and each direct child, and a MutationObserver
 * re-observes when a route swaps the children out.
 */
export function useScrollJump(
  { container }: { container: HTMLElement | null },
  { reducedMotion = prefersReducedMotion }: { reducedMotion?: () => boolean } = {},
): ScrollJumpController {
  const [visibility, setVisibility] = useState<ScrollJumpVisibility>(HIDDEN);

  useEffect(() => {
    if (!container) return;
    // Same-value updates keep the previous object so a scroll that changes nothing does not re-render.
    const update = () => setVisibility((previous) => {
      const next = scrollJumpVisibility(container);
      return next.showTop === previous.showTop && next.showBottom === previous.showBottom ? previous : next;
    });
    update();
    container.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    const observeChildren = () => {
      resize?.disconnect();
      resize?.observe(container);
      for (const child of Array.from(container.children)) resize?.observe(child);
    };
    observeChildren();
    const mutation = typeof MutationObserver === "function" ? new MutationObserver(() => { observeChildren(); update(); }) : null;
    mutation?.observe(container, { childList: true });
    return () => {
      container.removeEventListener("scroll", update);
      resize?.disconnect();
      mutation?.disconnect();
    };
  }, [container]);

  const jump = useCallback((edge: "top" | "bottom") => {
    container?.scrollTo({ top: scrollJumpTarget({ edge, scrollHeight: container.scrollHeight }), behavior: scrollJumpBehavior({ reducedMotion: reducedMotion() }) });
  }, [container, reducedMotion]);

  return { ...(container ? visibility : HIDDEN), jump };
}
