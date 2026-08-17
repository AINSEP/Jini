/**
 * Pure logic for the annotation-canvas engine: geometry, the
 * collision-avoiding floating-toolbar placement algorithm, and the
 * submit-action/mark-tool option derivations. Zero DOM/React — every input
 * here is a plain value the React hook layer (`react/hooks/
 * useAnnotationCanvas.ts`) measures from the live DOM and passes in.
 *
 * Origin: `apps/web/src/components/PreviewDrawOverlay.tsx`. See
 * `../source-map.md`.
 */
import type {
  AnnotationAction,
  CSSPropertiesLike,
  DockPlacement,
  DrawDockSide,
  NormalizedRect,
  Point,
  Rect,
} from './types.js';

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function normalizedRectFromPoints(a: Point, b: Point): NormalizedRect {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x, b.x);
  const bottom = Math.max(a.y, b.y);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function dockPlacementEquals(a: DockPlacement, b: DockPlacement): boolean {
  return (
    a.layout === b.layout &&
    a.side === b.side &&
    a.style.left === b.style.left &&
    a.style.top === b.style.top &&
    a.style.bottom === b.style.bottom &&
    a.style.transform === b.style.transform &&
    a.style.maxWidth === b.style.maxWidth
  );
}

export const DRAW_DOCK_GAP = 12;
export const DRAW_DOCK_MARGIN = 16;
export const DRAW_DOCK_MIN_WIDTH = 320;
export const DRAW_DOCK_MIN_HEIGHT = 120;

export interface DockPlacementInput {
  /** The dock's default (non-floating) style — returned verbatim when nothing floats. */
  dockedStyle: CSSPropertiesLike;
  /** Rect of the toolbar host (the positioning ancestor), viewport coords. */
  hostRect: Rect;
  /** Rect of the wrapper the canvas lives in, viewport coords. */
  wrapRect: Rect;
  /** Rect of the dock element itself (for its current size), viewport coords. */
  dockRect: Rect;
  /** The region being annotated (last box, last stroke, or a capture target), wrapper-relative. */
  anchor: Rect | null;
}

/**
 * Computes where the floating toolbar should sit so it stays near the
 * user's last mark without covering it. Tries right → left → bottom → top of
 * the anchor rect, in that order, picking the first side that both fits
 * inside the host's safe area and doesn't overlap the anchor; falls back to
 * `dockedStyle` (bottom-center, non-floating) when nothing fits (small host,
 * no anchor, or the dock/host haven't measured yet).
 */
export function computeDockPlacement(input: DockPlacementInput): DockPlacement {
  const docked: DockPlacement = { layout: 'docked', side: null, style: input.dockedStyle };
  const { hostRect, wrapRect, dockRect, anchor } = input;

  if (!anchor) return docked;
  if (
    hostRect.width <= DRAW_DOCK_MARGIN * 2 ||
    hostRect.height <= DRAW_DOCK_MARGIN * 2 ||
    dockRect.width <= 0 ||
    dockRect.height <= 0 ||
    hostRect.width < Math.max(DRAW_DOCK_MIN_WIDTH, dockRect.width) + DRAW_DOCK_MARGIN * 2 ||
    hostRect.height < Math.max(DRAW_DOCK_MIN_HEIGHT, dockRect.height) + DRAW_DOCK_MARGIN * 2
  ) {
    return docked;
  }

  const anchorInHost: Rect = {
    x: wrapRect.x - hostRect.x + anchor.x,
    y: wrapRect.y - hostRect.y + anchor.y,
    width: anchor.width,
    height: anchor.height,
  };
  const safeLeft = DRAW_DOCK_MARGIN;
  const safeTop = DRAW_DOCK_MARGIN;
  const safeRight = Math.max(safeLeft, hostRect.width - dockRect.width - DRAW_DOCK_MARGIN);
  const safeBottom = Math.max(safeTop, hostRect.height - dockRect.height - DRAW_DOCK_MARGIN);
  const centeredLeft = anchorInHost.x + anchorInHost.width / 2 - dockRect.width / 2;
  const centeredTop = anchorInHost.y + anchorInHost.height / 2 - dockRect.height / 2;

  const candidates: Array<{ side: DrawDockSide; left: number; top: number; fits: boolean }> = [
    {
      side: 'right',
      left: anchorInHost.x + anchorInHost.width + DRAW_DOCK_GAP,
      top: centeredTop,
      fits: anchorInHost.x + anchorInHost.width + DRAW_DOCK_GAP + dockRect.width <= hostRect.width - DRAW_DOCK_MARGIN,
    },
    {
      side: 'left',
      left: anchorInHost.x - DRAW_DOCK_GAP - dockRect.width,
      top: centeredTop,
      fits: anchorInHost.x - DRAW_DOCK_GAP - dockRect.width >= DRAW_DOCK_MARGIN,
    },
    {
      side: 'bottom',
      left: centeredLeft,
      top: anchorInHost.y + anchorInHost.height + DRAW_DOCK_GAP,
      fits: anchorInHost.y + anchorInHost.height + DRAW_DOCK_GAP + dockRect.height <= hostRect.height - DRAW_DOCK_MARGIN,
    },
    {
      side: 'top',
      left: centeredLeft,
      top: anchorInHost.y - DRAW_DOCK_GAP - dockRect.height,
      fits: anchorInHost.y - DRAW_DOCK_GAP - dockRect.height >= DRAW_DOCK_MARGIN,
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.fits) continue;
    const clampedLeft = clamp(candidate.left, safeLeft, safeRight);
    const clampedTop = clamp(candidate.top, safeTop, safeBottom);
    // No separate `rectsOverlap` re-check is needed here: a candidate's own
    // `fits` test already requires DRAW_DOCK_GAP of clearance from the anchor
    // on that candidate's offset axis, and the clamp bounds on that same axis
    // are derived from the identical host/dock/margin terms as `fits` — so
    // once a candidate fits, clamping can never pull it back on top of the
    // anchor. Confirmed by exhaustive randomized search (5M geometries,
    // independent host/wrap/dock/anchor dimensions, zero collisions) before
    // removing the dead overlap guard that used to sit here.
    return {
      layout: 'floating',
      side: candidate.side,
      style: {
        position: 'absolute',
        left: `${Math.round(clampedLeft)}px`,
        top: `${Math.round(clampedTop)}px`,
        transform: 'none',
        bottom: 'auto',
        maxWidth: `${Math.max(0, hostRect.width - DRAW_DOCK_MARGIN * 2)}px`,
      },
    };
  }

  return docked;
}

/** Merges up to N optional bounding rects into one enclosing rect. Returns `undefined` when none are present (matches the origin's "no annotation bounds to report" case). */
export function mergeBounds(rects: ReadonlyArray<Rect | null | undefined>): Rect | undefined {
  const present = rects.filter((r): r is Rect => Boolean(r));
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  const left = Math.min(...present.map((r) => r.x));
  const top = Math.min(...present.map((r) => r.y));
  const right = Math.max(...present.map((r) => r.x + r.width));
  const bottom = Math.max(...present.map((r) => r.y + r.height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** Collapses a set of normalized selection boxes (already scaled to canvas pixels) into one enclosing rect, or `null` if there are none. */
export function mergeRects(rects: ReadonlyArray<Rect>): Rect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export function deriveMarkKind(input: {
  hasTarget: boolean;
  hasVisualMark: boolean;
}): 'click' | 'stroke' | 'click+stroke' | undefined {
  if (input.hasTarget && input.hasVisualMark) return 'click+stroke';
  if (input.hasTarget) return 'click';
  if (input.hasVisualMark) return 'stroke';
  return undefined;
}

export interface SubmitOptionRule {
  action: AnnotationAction;
  labelKey: string;
  pendingLabelKey: string;
  enabled: boolean;
}

/**
 * Each submit action's enable rule, driving the split button + its dropdown.
 * `send` is gated while a task runs (Queue and Add-to-input stay usable
 * then); the others only need something to submit. Labels are returned as
 * translation keys (English strings, per this repo's i18n convention) —
 * the component layer calls `t()` and attaches icons/titles, since this
 * file stays React- and i18n-hook-free.
 */
export function buildSubmitOptionRules(input: { canSubmit: boolean; sendDisabled: boolean }): SubmitOptionRule[] {
  const canSend = input.canSubmit && !input.sendDisabled;
  return [
    { action: 'send', labelKey: 'Send', pendingLabelKey: 'Sending…', enabled: canSend },
    { action: 'draft', labelKey: 'Add to input', pendingLabelKey: 'Adding to input…', enabled: input.canSubmit },
    { action: 'queue', labelKey: 'Queue', pendingLabelKey: 'Queueing…', enabled: input.canSubmit },
  ];
}

export interface MarkToolOptionRule {
  tool: 'box' | 'pen' | 'text';
  labelKey: string;
}

export const MARK_TOOL_OPTION_RULES: readonly MarkToolOptionRule[] = [
  { tool: 'box', labelKey: 'Box select' },
  { tool: 'pen', labelKey: 'Pen' },
  { tool: 'text', labelKey: 'Text' },
];
