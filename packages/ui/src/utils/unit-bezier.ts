/**
 * cubic-bezier(x1, y1, x2, y2) timing-function solver (WebKit UnitBezier shape): Newton iteration
 * on x(t), then y(t). Pure math, kept local so animation utilities need no motion library.
 */

/** Returns the easing function for the given control points; inputs are clamped to [0, 1]. */
export function unitBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) break;
      const d = sampleDX(t);
      // A flat x-derivative would make the Newton step divide by ~0. For smooth-scroll-to-top's
      // fixed ease-out curve sampleDX stays at least about 0.6095 over [0, 1], so it never fires
      // there; it does for degenerate control points (e.g. x1 = x2 = 0 near x = 0), where the
      // current estimate is kept rather than stepping to Infinity/NaN.
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sampleY(Math.min(1, Math.max(0, t)));
  };
}
