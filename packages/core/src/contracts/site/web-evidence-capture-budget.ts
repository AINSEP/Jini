/**
 * @file Host-supplied screenshot capture time limits. Types only; this module owns the
 * declarations that `@jini-ai/diagnostics/web-evidence/capture-budget` (`capture-budget.ts`) used
 * to declare. That package imports them from here and keeps its runtime values.
 */

/** Host values. There are no defaults on purpose: the cap and the reserve belong to the host. */
export interface CaptureBudgetLimits {
  baseMs: number;
  /** Extra time a full-page scroll needs. */
  fullPageMs: number;
  /** The total never exceeds this. */
  capMs: number;
  /** Time kept at the end of the capture for the fallback on the current page. */
  reserveMs: number;
}
