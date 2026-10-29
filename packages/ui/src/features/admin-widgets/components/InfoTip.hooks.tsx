import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDismissOnOutsideOrEscape } from "../../../browser/index.js";
import { placeInfoTipBubble } from "./InfoTip.rules.js";

/** Separate the hook for injectable rendering state. Its only outside effect is synchronous DOM
 * measurement, so another async dependency/port layer would provide no rejection seam to test. */

/** Hosts mark a panel (e.g. an assistant dock) with this attribute to keep tips inside it. */
export const TIP_BOUNDS_ATTRIBUTE = "data-jini-tip-bounds";

/** How long a tap-opened tip stays up on its own; touch has no pointer-leave to close it. */
export const TAP_TIP_MS = 2500;

/** A pinned or focused tip used to stay up beside the one the pointer had just reached
 * (owner, 2026-10-25: two "Soon" tips open at once). Each claim owns its document listener. */
const OPEN_TIP_EVENT = "jini:claim-open-tip";

/**
 * Makes `close` the one open tip, closing whichever tip held that slot before. Hosts with their own
 * tip state (e.g. a dock-header tip) can call it too, to join the same one-open rule.
 * @param close Closes the claiming tip; identity must stay stable while it is open.
 * @returns A release that empties the slot only if `close` still holds it.
 * @complexity O(1).
 */
export function claimOpenTip(close: () => void): () => void {
  const target = document;
  const claim: { close: () => void; release?: () => void } = { close };
  const release = () => target.removeEventListener(OPEN_TIP_EVENT, onClaim);
  const onClaim = (event: Event) => {
    const next = (event as CustomEvent<typeof claim>).detail;
    if (next.close === close) { next.release = release; return; }
    release();
    close();
  };
  target.dispatchEvent(new CustomEvent(OPEN_TIP_EVENT, { detail: claim }));
  if (claim.release) return claim.release;
  target.addEventListener(OPEN_TIP_EVENT, onClaim);
  return release;
}

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
  /** Tap/Enter/Space: pins an open tip so it survives the pointer leaving (touch has no hover to
   *  keep it up), or closes a pinned one. Hover and mouse clicks never pin. */
  toggle: () => void;
  /** Records the pointer type of the press a following click comes from; optional for injected
   *  controllers. */
  pointerDown?: (e: { pointerType: string }) => void;
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
  // "tap" pins auto-hide; "key" (Enter/Space) pins stay until blur or Escape.
  const [pinned, setPinned] = useState<false | "tap" | "key">(false);
  const iconRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const pointerTypeRef = useRef<string | null>(null);
  // Stable identity for the one-open-tip slot; state setters never change.
  const hide = useRef(() => {
    setOpen(false);
    setPinned(false);
  }).current;

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
  const leave = () => {
    if (!pinned) setOpen(false);
  };
  const pointerDown = (e: { pointerType: string }) => {
    pointerTypeRef.current = e.pointerType;
  };
  const toggle = () => {
    const via = pointerTypeRef.current;
    pointerTypeRef.current = null;
    if (open && pinned) {
      hide();
      return;
    }
    show();
    // A mouse already has hover to hold the tip up; pinning on a mouse click is what left tips
    // stuck open after the pointer moved on. No pointer press means Enter/Space.
    if (via !== "mouse") setPinned(via ? "tap" : "key");
  };

  useEffect(() => {
    if (!open) return undefined;
    return claimOpenTip(hide);
  }, [open]);

  // A tapped-open tip stays up until the operator taps elsewhere or it times out; the bubble
  // itself is pointer-events:none, so "outside the icon" is every other target.
  useDismissOnOutsideOrEscape({ onDismiss: hide }, { enabled: pinned !== false, containerRef: iconRef });
  useEffect(() => {
    if (pinned !== "tap") return undefined;
    const timer = setTimeout(hide, TAP_TIP_MS);
    return () => clearTimeout(timer);
  }, [pinned]);

  // The bubble is position:fixed at measured viewport coordinates, so a scroll that moves the icon
  // would leave it floating over the wrong content, and the pointer has usually left the icon
  // without a mouseleave firing yet: close it. A scroll in an unrelated pane (a streaming chat)
  // leaves it be. A resize re-measures instead, so it keeps following its icon.
  useEffect(() => {
    if (!open) return undefined;
    const closeIfMoved = (e: Event) => {
      const icon = iconRef.current;
      if (icon && e.target instanceof Node && !e.target.contains(icon)) return;
      hide();
    };
    const follow = () => show();
    window.addEventListener("scroll", closeIfMoved, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", closeIfMoved, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  function handleIconKeyDown(e: KeyboardEvent<HTMLSpanElement>) {
    if (e.key === "Escape" && open) {
      // preventDefault also stops an enclosing modal <dialog> from closing on the same keypress.
      e.preventDefault();
      e.stopPropagation();
      hide();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  }

  return { open, placement, coords, iconRef, bubbleRef, show, hide, leave, toggle, pointerDown, handleIconKeyDown };
}
