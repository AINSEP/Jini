import { describeErrorForLog } from "./model-facing-tool-errors.js";

/**
 * A `.catch` / catch-block handler for work that is best-effort by design (closing a handle, removing a
 * temp file, a cleanup that runs while another failure is already propagating) and must never throw
 * into the caller. The failure is not hidden: it is logged at debug with what was being done and the
 * cause's redacted message (class, approved code, credential-redacted text), so a leak or a refused
 * cleanup is findable.
 * @param required.operation - Plain words for what was being attempted ("close the pglite client").
 * @param optional.scope - Log prefix naming the package (default `jini`).
 * @returns A handler taking the caught value; never throws.
 * @complexity O(1).
 */
export function ignoreBestEffortFailure(required: { operation: string }, optional: { scope?: string } = {}): (cause: unknown) => void {
  const { scope = "jini" } = optional;
  return (cause: unknown): void => {
    console.debug(`[${scope}] best-effort step failed and was ignored: ${required.operation}: ${describeErrorForLog({ err: cause })}`);
  };
}
