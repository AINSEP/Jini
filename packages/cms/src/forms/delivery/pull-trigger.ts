/**
 * @file Fire-and-forget runner for trigger-driven pulls (startup, sign-in). The trigger's caller
 * must never wait on or fail because of a pull, yet shutdown must be able to stop new pulls and
 * wait for live ones. No scheduling or polling happens here; the lease owns concurrency.
 */

/**
 * @example const trigger = createFormPullTrigger({ run: pullOnce, onError: logSafeLine }); void trigger.run(); await trigger.stop();
 */
export function createFormPullTrigger(
  required: { run: () => Promise<void>; onError: (error: unknown) => void },
  _optional: Record<string, never> = {},
): { run(required?: Record<string, never>, optional?: Record<string, never>): Promise<void>; stop(required?: Record<string, never>, optional?: Record<string, never>): Promise<void> } {
  let stopped = false;
  const inFlight = new Set<Promise<void>>();
  return {
    // Never rejects: background work has no caller to report to except `onError`.
    run: () => {
      if (stopped) return Promise.resolve();
      const work = Promise.resolve()
        .then(() => required.run())
        .catch(error => {
          try { required.onError(error); } catch { /* A failing reporter must not reject background work. */ }
        })
        .finally(() => { inFlight.delete(work); });
      inFlight.add(work);
      return work;
    },
    stop: async () => {
      stopped = true;
      await Promise.all(inFlight);
    },
  };
}
