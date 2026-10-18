import type { CSSProperties } from "react";

/** Above is a preference: require this much headroom before allowing an above-opening bubble
 * whose height is not measured yet. */
export const ABOVE_HEADROOM_PX = 176;

/** The bubble's 18rem CSS max-width at a 16px root font. Before the portal renders there is no
 * real width to measure, so the first estimate assumes the worst case. */
export const MAX_BUBBLE_WIDTH_PX = 288;

/** Keep breathing room between the bubble and either edge of its bounds. */
export const EDGE_MARGIN_PX = 8;

/** The CSS gap between icon and bubble (`translate(…, 8px)`), plus the arrow. */
const GAP_PX = 16;

/** The arrow is 10px wide; keep its centre clear of the bubble's rounded corners. */
const ARROW_INSET_PX = 10;

export interface InfoTipPlacement {
  placement: "above" | "below";
  /** Viewport y the CSS translates from: the icon's top (above) or bottom (below). */
  top: number;
  /** The bubble's centre x in viewport pixels (its CSS is `translate(-50%, …)`). */
  left: number;
  /** The arrow's x inside the bubble, so it still points at the icon after a shift. */
  arrowLeft: number;
}

/**
 * Where an `InfoTip`-style bubble goes: centred under/over its icon, then shifted (never squeezed)
 * just far enough to stay inside `bounds` (e.g. the assistant dock) and the viewport.
 *
 * Why the real measured width: the old clamp assumed every bubble was 18rem wide, so every short tip
 * within 152px of the right edge got the same left — "Remove" sat ~86px away from its ✕ in the
 * dock (Chrome re-check, 2026-10-11). Shared by `useInfoTip` and the host's dock-header tips so both
 * place identically.
 * @param input.anchor The icon's `getBoundingClientRect()`.
 * @param input.bubble The rendered bubble's measured size; `null` before the portal exists.
 * @param input.viewport `window.innerWidth` / `innerHeight`.
 * @param options.bounds Horizontal limits of a containing panel; ignored when the bubble cannot fit
 *   in them (it then only has to fit the viewport).
 * @param options.preferred A host's preferred side. Bottom flips above only when it would overflow
 *   the viewport's bottom and fits above; top falls back below without the measured headroom.
 * @returns Coordinates for the portal plus the arrow offset. A bubble wider than the viewport's
 *   usable span centres in the viewport rather than using an inverted clamp range.
 * @complexity O(1).
 */
export function placeInfoTipBubble(
  input: {
    anchor: { left: number; top: number; width: number; height: number };
    bubble: { width: number; height: number } | null;
    viewport: { width: number; height: number };
  },
  { bounds, preferred }: { bounds?: { left: number; right: number } | undefined; preferred?: "top" | "bottom" | undefined } = {},
): InfoTipPlacement {
  const { anchor, bubble, viewport } = input;
  const width = bubble && bubble.width > 0 ? bubble.width : MAX_BUBBLE_WIDTH_PX;
  const anchorCentre = anchor.left + anchor.width / 2;

  const viewportSpan = { lo: EDGE_MARGIN_PX, hi: viewport.width - EDGE_MARGIN_PX };
  const boundsSpan = bounds
    ? { lo: Math.max(bounds.left, 0) + EDGE_MARGIN_PX, hi: Math.min(bounds.right, viewport.width) - EDGE_MARGIN_PX }
    : null;
  const span = boundsSpan && boundsSpan.hi - boundsSpan.lo >= width ? boundsSpan : viewportSpan;
  const left = span.hi - span.lo < width
    ? viewport.width / 2
    : Math.min(Math.max(anchorCentre, span.lo + width / 2), span.hi - width / 2);

  const bubbleLeftEdge = left - width / 2;
  const arrowLeft = Math.min(Math.max(anchorCentre - bubbleLeftEdge, ARROW_INSET_PX), width - ARROW_INSET_PX);

  const anchorBottom = anchor.top + anchor.height;
  const height = bubble && bubble.height > 0 ? bubble.height : 0;
  const fitsAbove = height > 0 ? anchor.top >= height + GAP_PX : anchor.top >= ABOVE_HEADROOM_PX;
  const fitsBelow = height === 0 || anchorBottom + GAP_PX + height <= viewport.height;
  const placement = preferred === "bottom"
    ? (!fitsBelow && fitsAbove ? "above" : "below")
    : fitsAbove ? "above" : "below";

  return { placement, top: placement === "above" ? anchor.top : anchorBottom, left, arrowLeft };
}

/**
 * The portal's inline style: position plus, once measured, the arrow offset as a CSS variable
 * (`.info-tip-bubble::after` reads `--info-tip-arrow-left`, defaulting to centred).
 * @param coords The controller's coordinates.
 * @returns Inline style for the bubble.
 * @complexity O(1).
 */
export function infoTipBubbleStyle(coords: { top: number; left: number; arrowLeft?: number | undefined }): CSSProperties {
  const style: CSSProperties & { "--info-tip-arrow-left"?: string } = { top: coords.top, left: coords.left };
  if (coords.arrowLeft !== undefined) style["--info-tip-arrow-left"] = `${coords.arrowLeft}px`;
  return style;
}

/** One line of a bubble that holds a bulleted list. */
export interface InfoTipLine { text: string; bullet: boolean }

/**
 * Splits a label into lines when any line is a "• " bullet (e.g. a settings group's one tip, a line
 * per option), so each bullet's wrapped text can hang past its dot; `pre-line` alone wraps under it.
 * @param label The tip text; newlines separate lines.
 * @returns The lines with their "• " removed, or `null` when the label has no bullet line.
 * @complexity O(n) in the label's length.
 */
export function infoTipLines(label: string): InfoTipLine[] | null {
  const lines = label.split("\n");
  if (!lines.some((line) => line.startsWith("• "))) return null;
  return lines.map((line) => line.startsWith("• ") ? { text: line.slice(2), bullet: true } : { text: line, bullet: false });
}
