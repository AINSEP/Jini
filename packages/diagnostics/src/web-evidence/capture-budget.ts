import type { CaptureBudgetLimits } from "@jini-ai/core/contracts/site/web-evidence-capture-budget";
/** Deprecated re-export: import these from `@jini-ai/core/contracts/site/web-evidence-capture-budget`; removed at the next major. */
export type { CaptureBudgetLimits } from "@jini-ai/core/contracts/site/web-evidence-capture-budget";

/** What the caller asked a capture to do. Every field is optional input from a tool call. */
export interface CaptureRequest {
  /** Settle time in milliseconds. Replaced by `waitForSeconds` when that is given. */
  settleMs?: number;
  fullPage?: boolean;
  /** The renderer's requested wait, in seconds. */
  waitForSeconds?: number;
}

export interface CaptureBudget {
  totalMs: number;
  /** `totalMs − reserveMs`: ordinary work must be done by then. */
  softDeadlineMs: number;
  reserveMs: number;
}

/** A request value that is not a finite, positive number adds nothing. */
const extraMs = ({ value, unitMs }: { value: number | undefined; unitMs: number }): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value * unitMs : 0;

/** The time one capture may take: the base, plus what the request itself asks for, up to the cap.
 * @throws RangeError when the reserve is not above 0 and below the total (a host configuration bug).
 * @complexity O(1). */
export function captureBudget(
  { settleMs, fullPage, waitForSeconds }: CaptureRequest,
  { baseMs, fullPageMs, capMs, reserveMs }: CaptureBudgetLimits,
): CaptureBudget {
  const waitMs = waitForSeconds === undefined ? extraMs({ value: settleMs, unitMs: 1 }) : extraMs({ value: waitForSeconds, unitMs: 1_000 });
  const totalMs = Math.min(capMs, baseMs + waitMs + (fullPage === true ? fullPageMs : 0));
  if (!(reserveMs > 0 && reserveMs < totalMs)) {
    throw new RangeError(`capture reserve ${reserveMs}ms must be above 0 and below the capture total ${totalMs}ms`);
  }
  return { totalMs, softDeadlineMs: totalMs - reserveMs, reserveMs };
}
