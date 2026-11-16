import { describeErrorForLog } from "@jini-ai/core";

/**
 * A `.catch` handler for work that is best-effort by design (closing a browser, aborting a route)
 * and must never throw into the caller. The failure is not hidden: it is logged at debug with what was
 * being done and the cause's redacted message, so a leaking browser or a refused abort is findable.
 * @param required.operation - Plain words for what was being attempted ("close the page browser").
 * @returns A handler taking the rejection; never throws.
 * @complexity O(1).
 */
export function ignoreBestEffortFailure(required: { operation: string }, _optional: Record<string, never> = {}): (cause: unknown) => void {
  return (cause: unknown): void => {
    console.debug(`[diagnostics] best-effort step failed and was ignored: ${required.operation}: ${describeErrorForLog({ err: cause })}`);
  };
}
