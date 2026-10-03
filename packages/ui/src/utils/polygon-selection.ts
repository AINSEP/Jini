/**
 * Freehand-lasso multi-element selection geometry — pure, zero-dependency
 * hit-testing math (closed-loop detection, point-in-polygon, line/rect
 * intersection). Ported from a vendored OD file-viewer god-component's
 * single-user "pod" annotation tool: draw a freehand stroke over a
 * rendered surface, and every element whose bounding rect the stroke
 * crosses (or, for a closed loop, whose center or any corner falls inside
 * it) is selected as one group.
 *
 * Correction to an earlier framing: this is NOT multi-user
 * presence/collaboration (no cursors-of-other-users, no realtime presence
 * state exist in the source) — it is a single-user lasso-select tool. See
 * `packages/ui/archived provenance ledger`'s `html-viewer` classification section.
 *
 * Only the geometry primitives ship here — the source's own
 * `buildPodSnapshot`/`pruneContainerSelections`/`podOverlayWeights` (which
 * this geometry feeds) also build human-readable summaries and per-element
 * visual-weight styling from OD's own `PreviewCommentSnapshot` type, and
 * stay behind pending the DOM-pinned overlay + sandboxed-iframe core this
 * geometry would actually be consumed by (deferred — see the classification
 * section for why). These primitives have no such dependency and are
 * useful standalone (e.g. `rectContains`/`pointInPolygon` for any
 * marquee/lasso-select UI), so they ship ahead of that consumer, matching
 * this package's existing precedent for small, proven-zero-dependency
 * helpers (`dom-subscriptions.ts`, `visual-stability.ts`).
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A stroke is "closed" if its last point lands back near its first —
 *  within `closeThreshold` px — and it has enough points to plausibly
 *  enclose an area. */
export function isClosedLoop(points: readonly Point[], closeThreshold = 28): boolean {
  if (points.length < 4) return false;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return Math.hypot(first.x - last.x, first.y - last.y) <= closeThreshold;
}

/** Does `outer` fully contain `inner`? */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

/** Do line segments `a1`→`a2` and `b1`→`b2` intersect? Standard
 *  parametric-line-intersection test; parallel (or coincident) segments
 *  never intersect under this test. */
export function lineIntersectsLine(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const denominator = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (denominator === 0) return false;
  const ua = ((b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x)) / denominator;
  const ub = ((a2.x - a1.x) * (a1.y - b1.y) - (a2.y - a1.y) * (a1.x - b1.x)) / denominator;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

/** Standard even-odd-rule ray-casting point-in-polygon test. */
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    // No `|| Number.EPSILON` divide-by-zero guard on `(pj.y - pi.y)`: the
    // `&&`'s left operand is only true when `pi.y > point.y` and
    // `pj.y > point.y` differ, which is impossible when `pi.y === pj.y` (the
    // same comparison against the same value can't disagree with itself) —
    // so this division can never actually see a zero divisor, and a guard
    // for it would be dead code, not a real defense.
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Does the polyline `points` pass through `rect`, either by a point
 *  landing inside it or a segment crossing one of its 4 edges? */
export function pathIntersectsRect(points: readonly Point[], rect: Rect): boolean {
  if (points.length === 0) return false;
  const x1 = rect.x;
  const y1 = rect.y;
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    if (point.x >= x1 && point.x <= x2 && point.y >= y1 && point.y <= y2) return true;
    const next = points[index + 1];
    if (!next) continue;
    if (
      lineIntersectsLine(point, next, { x: x1, y: y1 }, { x: x2, y: y1 }) ||
      lineIntersectsLine(point, next, { x: x2, y: y1 }, { x: x2, y: y2 }) ||
      lineIntersectsLine(point, next, { x: x2, y: y2 }, { x: x1, y: y2 }) ||
      lineIntersectsLine(point, next, { x: x1, y: y2 }, { x: x1, y: y1 })
    ) {
      return true;
    }
  }
  return false;
}

export interface LassoHitTestInput {
  points: readonly Point[];
  rect: Rect;
  closedLoop: boolean;
}

/**
 * Does a freehand lasso stroke select `rect`? True if the stroke's path
 * crosses the rect at all; for a closed loop, also true if the rect's
 * center or any of its 4 corners falls inside the enclosed area (so a
 * loop drawn entirely around a small element without literally touching
 * its border still selects it).
 */
export function lassoSelectionHitsRect(input: LassoHitTestInput): boolean {
  const { points, rect, closedLoop } = input;
  if (pathIntersectsRect(points, rect)) return true;
  if (!closedLoop) return false;
  const center: Point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  if (pointInPolygon(center, points)) return true;
  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  return corners.some((corner) => pointInPolygon(corner, points));
}
