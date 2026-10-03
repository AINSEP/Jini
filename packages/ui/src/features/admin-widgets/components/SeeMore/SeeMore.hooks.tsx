import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/** Sub-pixel line-height rounding can make fitting text report a tiny overflow.
 * One pixel avoids showing an expand control for an already visible single line. */
const OVERFLOW_TOLERANCE_PX = 1;

/** Separate measurement from JSX so callers can substitute a hook without a real layout engine.
 * children participates in layout measurement so content changes are noticed as well as width reflow. */
export function useSeeMoreClamp({ lines, children }: { lines: number; children: React.ReactNode }) {
  // Collapsed by default, per the request that created this component.
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLDivElement | null>(null);
  const regionId = useId();

  const lineCount = Math.max(1, Math.round(lines));


  const measure = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight + OVERFLOW_TOLERANCE_PX);
  }, []);

  // Both measuring effects bail while expanded, and that is the whole design rather than an
  // oversight: expanding removes the clamp, at which point `scrollHeight === clientHeight` by
  // definition and the check would report "does not overflow" for text that plainly does — which
  // would unmount the toggle and strand the user in the expanded state with no way back. So
  // `overflows` deliberately goes stale while expanded and is re-measured the moment it collapses.
  // The visible consequence is narrow and self-correcting: if the children change while expanded so
  // that they no longer overflow, the toggle lingers until the next collapse, then disappears with
  // the (now fully visible) text.
  //
  // `useLayoutEffect` so the toggle's presence is settled before paint — a `useEffect` here shows
  // one frame of clamped text with no way to expand it, then pops the button in.
  useLayoutEffect(() => {
    if (expanded) return;
    measure();
    // `children` is a fresh object on every parent render, so this re-runs whenever the host
    // re-renders (the first caller is a dialog that re-renders on each keystroke). That is two DOM
    // reads, deliberately accepted: the alternative is missing a genuine content change. The
    // `ResizeObserver` below is the expensive thing, and it is kept out of this dependency list.
  }, [expanded, lineCount, children, measure]);

  useEffect(() => {
    if (expanded) return;
    const el = textRef.current;
    // Guarded rather than assumed, the same way `Select.tsx` guards `elementFromPoint` and
    // `scrollIntoView`: this app's jsdom test harness implements no `ResizeObserver` at all, so an
    // unguarded `new ResizeObserver` throws on mount in every test that renders this component.
    // Where it is missing, the layout effect above still measures on mount and on content change —
    // only reflow-from-width-change goes unnoticed, which jsdom has no layout engine to produce.
    if (!el || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, measure]);

  return { expanded, setExpanded, overflows, textRef, regionId, lineCount };
}
