/**
 * @file Serving intake fence. The parent suggests idle; only this process can prove it.
 *
 * Framework-neutral: the host's HTTP adapter calls `admit()` once per request, refuses the request
 * when it returns `undefined` (the fence is up), and calls the returned `release` when the request
 * ends (finish or close — `release` is idempotent, so wiring both is safe).
 */
import { orFallback } from "@jini-ai/core/errors/idioms";

/** Inject the ledger, the shared finalizer, the existing graceful stop and the exit code it should
 * carry. Uncertainty is busy. Any admitted request holds intake until it is released. Disconnected
 * handlers that keep working remain protected by their finalizer, ledger or domain-job owner.
 * @returns `admit` for the host's per-request adapter and a private-channel idle operation.
 * @example const park = createIdlePark({ hasActiveRuns, hasBackgroundWork, activeCount, stop, exitCode });
 * @complexity O(1) request state; an eligible probe uses up to two bounded existence queries.
 */
export function createIdlePark({ hasActiveRuns, hasBackgroundWork, activeCount, stop, exitCode }: {
  hasActiveRuns: () => Promise<boolean>; hasBackgroundWork: () => Promise<boolean>; activeCount: () => number;
  stop: (input: { exitCode: number }) => void; exitCode: number;
}, _optional = {}) {
  let requests = 0;
  let fenced = false;
  let probing = false;
  const hasOpenWork = () => activeCount() !== 0 || requests !== 0;
  return {
    /** Count one request in; `undefined` means intake is fenced and the request must be refused. */
    admit(_required = {}, _options = {}): (() => void) | undefined {
      if (fenced) return undefined;
      requests++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        requests--;
      };
    },
    /** Skip storage for known requests/watches, then check background owners and the ledger.
     * Recheck watches/holds and fence without yielding. A request that
     * arrives during the query must still veto shutdown; never insert an await after these checks.
     * Failures leave intake open, so the next maintenance pass can try again.
     */
    async stopIfIdle(_required = {}, _options = {}): Promise<{ idle: boolean }> {
      if (fenced || probing) return { idle: false };
      probing = true;
      try {
        // Any failure (a probe or the stop) means "not idle" and reopens intake.
        const idle = await orFallback({ step: "idle-park probe", fallback: false, work: async () => {
          if (hasOpenWork()) return false;
          if (await hasActiveRuns()) return false;
          if (await hasBackgroundWork()) return false;
          if (hasOpenWork()) return false;
          fenced = true;
          stop({ exitCode });
          return true;
        } });
        if (!idle) fenced = false;
        return { idle };
      } finally { probing = false; }
    },
  };
}
