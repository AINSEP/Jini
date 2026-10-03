import { useRef, useState, type KeyboardEvent } from "react";

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
  show: () => void;
  hide: () => void;
  /** Escape closes in place; blur only covers leaving the trigger with Tab/Shift+Tab. */
  handleIconKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => void;
}

export function useInfoTip(): InfoTipController {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"above" | "below">("above");
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const iconRef = useRef<HTMLSpanElement>(null);

  const show = () => {
    const rect = iconRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextPlacement = rect.top < ABOVE_HEADROOM_PX ? "below" : "above";
    setPlacement(nextPlacement);
    setCoords({
      top: nextPlacement === "above" ? rect.top : rect.bottom,
      left: clampBubbleLeft(rect.left + rect.width / 2),
    });
    setOpen(true);
  };
  const hide = () => setOpen(false);

  function handleIconKeyDown(e: KeyboardEvent<HTMLSpanElement>) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      hide();
    }
  }

  return { open, placement, coords, iconRef, show, hide, handleIconKeyDown };
}
