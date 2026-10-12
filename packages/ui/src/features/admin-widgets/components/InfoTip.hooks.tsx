import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDismissOnOutsideOrEscape } from "../../../browser/index.js";
import { placeInfoTipBubble } from "./InfoTip.rules.js";

/** Separate the hook for injectable rendering state. Its only outside effect is synchronous DOM
 * measurement, so another async dependency/port layer would provide no rejection seam to test. */

/** Hosts mark a panel (e.g. an assistant dock) with this attribute to keep tips inside it. */
export const TIP_BOUNDS_ATTRIBUTE = "data-jini-tip-bounds";

export interface InfoTipController {
  open: boolean;
  placement: "above" | "below";
  /** `arrowLeft` (px inside the bubble) keeps the arrow on the icon after an edge shift; optional
   *  for injected controllers, whose arrow stays centred. */
  coords: { top: number; left: number; arrowLeft?: number | undefined };
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
  const [coords, setCoords] = useState<InfoTipController["coords"]>({ top: 0, left: 0 });
  const [pinned, setPinned] = useState(false);
  const iconRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  // Placement math lives in `placeInfoTipBubble`; this only gathers the measurements. Before the
  // portal exists the bubble is unmeasured and the rules assume the worst-case width.
  const place = () => {
    const icon = iconRef.current;
    const rect = icon?.getBoundingClientRect();
    if (!icon || !rect) return false;
    const measured = bubbleRef.current?.getBoundingClientRect();
    const boundsRect = icon.closest(`[${TIP_BOUNDS_ATTRIBUTE}]`)?.getBoundingClientRect();
    const next = placeInfoTipBubble(
      {
        anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.bottom - rect.top },
        bubble: measured ? { width: measured.width, height: measured.height } : null,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },
      { bounds: boundsRect ? { left: boundsRect.left, right: boundsRect.right } : undefined, preferred: preferredPlacement },
    );
    setPlacement(next.placement);
    setCoords(measured && measured.width > 0 ? { top: next.top, left: next.left, arrowLeft: next.arrowLeft } : { top: next.top, left: next.left });
    return true;
  };
  const show = () => {
    if (place()) setOpen(true);
  };
  // The portal exists only after opening. Re-place before paint with its real size, so a short tip
  // near an edge shifts only as far as it must and a short tip fits above its label.
  useLayoutEffect(() => {
    if (open) place();
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
