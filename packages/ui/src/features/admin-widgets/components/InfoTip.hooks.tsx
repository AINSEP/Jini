import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDismissOnOutsideOrEscape } from "../../../browser/index.js";

/** Separate the hook for injectable rendering state. Its only outside effect is synchronous DOM
 * measurement, so another async dependency/port layer would provide no rejection seam to test. */
/** Above is a preference: require this much headroom before allowing an above-opening bubble. */
const ABOVE_HEADROOM_PX = 176;

/** Half the bubble's 18rem CSS max-width at a 16px root font. This worst-case width keeps narrow
 * copy safe too. Pure icon-centering previously placed half a tip offscreen near a viewport edge. */
const HALF_MAX_BUBBLE_WIDTH_PX = 144;

/** Keep breathing room between the clamped bubble and either viewport edge. */
const EDGE_MARGIN_PX = 8;

/** Below 304px the clamp's minimum exceeds its maximum; center instead of using an inverted range. */
function clampBubbleLeft(idealLeft: number): number {
  const minLeft = EDGE_MARGIN_PX + HALF_MAX_BUBBLE_WIDTH_PX;
  const maxLeft = window.innerWidth - EDGE_MARGIN_PX - HALF_MAX_BUBBLE_WIDTH_PX;
  if (maxLeft < minLeft) return window.innerWidth / 2;
  return Math.min(Math.max(idealLeft, minLeft), maxLeft);
}

export interface InfoTipController {
  open: boolean;
  placement: "above" | "below";
  coords: { top: number; left: number };
  iconRef: React.RefObject<HTMLSpanElement | null>;
  /** Portal measurement for a requested placement; optional for injected controllers. */
  bubbleRef?: React.RefObject<HTMLSpanElement | null>;
  show: () => void;
  /** Closes and unpins: blur, Escape, an outside tap. */
  hide: () => void;
  /** Pointer left the icon: closes only a hover-opened tip, never one the operator tapped open. */
  leave: () => void;
  /** Tap/click/Enter/Space: pins an open tip so it survives the pointer leaving (touch has no
   *  hover to keep it up), or closes a pinned one. Hover alone never pins. */
  toggle: () => void;
  /** Escape closes in place; Enter/Space toggle like a button; blur covers Tab/Shift+Tab. */
  handleIconKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => void;
}

/** Prefer a host's placement when the measured bubble fits; default preserves automatic flipping.
 * @complexity Time/space: O(1), with one icon and one bubble measurement.
 */
export function useInfoTip(_input: Record<string, never> = {}, { placement: preferredPlacement }: { placement?: "top" | "bottom" | undefined } = {}): InfoTipController {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"above" | "below">("above");
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [pinned, setPinned] = useState(false);
  const iconRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  const show = () => {
    const rect = iconRef.current?.getBoundingClientRect();
    if (!rect) return;
    const measuredHeight = bubbleRef.current?.getBoundingClientRect().height ?? 0;
    const headroom = preferredPlacement === "top" && measuredHeight > 0 ? measuredHeight + 16 : ABOVE_HEADROOM_PX;
    const nextPlacement = preferredPlacement === "bottom" || rect.top < headroom ? "below" : "above";
    setPlacement(nextPlacement);
    setCoords({
      top: nextPlacement === "above" ? rect.top : rect.bottom,
      left: clampBubbleLeft(rect.left + rect.width / 2),
    });
    setOpen(true);
  };
  // The portal exists only after opening. Measure before paint to avoid covering a field when
  // a short tip fits above its label; insufficient headroom still uses the automatic fallback.
  useLayoutEffect(() => {
    if (open && preferredPlacement === "top") show();
  }, [open, preferredPlacement]);
  const hide = () => {
    setOpen(false);
    setPinned(false);
  };
  const leave = () => {
    if (!pinned) setOpen(false);
  };
  const toggle = () => {
    if (open && pinned) {
      hide();
      return;
    }
    show();
    setPinned(true);
  };

  // A tapped-open tip stays up until the operator taps elsewhere; the bubble itself is
  // pointer-events:none, so "outside the icon" is every other target.
  useDismissOnOutsideOrEscape({ onDismiss: hide }, { enabled: pinned, containerRef: iconRef });

  // The bubble is position:fixed at measured viewport coordinates, so a scroll while it is open
  // would leave it floating over the wrong content. Re-measure instead of closing: a pinned tip
  // the operator is reading should follow its icon.
  useEffect(() => {
    if (!open) return;
    const follow = () => show();
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  function handleIconKeyDown(e: KeyboardEvent<HTMLSpanElement>) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      hide();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  }

  return { open, placement, coords, iconRef, bubbleRef, show, hide, leave, toggle, handleIconKeyDown };
}
