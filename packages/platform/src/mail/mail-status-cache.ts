/**
 * @file A short-TTL, single-flight cache for the mail status report.
 * Building the report can call the provider (domain status) and decrypt keys, which took 4–9 s per
 * admin page load; within the TTL every reader shares one result. `refresh` requests a fresh build,
 * subject to the optional minimum refresh interval.
 * `invalidate` drops the cached one (a provider switch or a key save). A failed build is never
 * cached, and a build that started before an invalidation is not stored over it.
 */

/** Default freshness window for mail status. */
export const MAIL_STATUS_TTL_MS = 30_000;

export interface TtlCache<T> {
  get(optional?: { refresh?: boolean }): Promise<T>;
  invalidate(): void;
}

/**
 * @param required.load - Builds a fresh value; its rejection reaches every concurrent caller.
 * @param required.ttlMs - How long a built value is served.
 * @param required.nowMs - Injected clock.
 * @param optional.minRefreshIntervalMs - Ignore forced refresh inside this interval after a build
 *   starts; zero preserves unrestricted superseding refreshes. Invalidation resets the interval.
 * @complexity O(1) per call; ordinary reads share one pending load. Explicit refresh may supersede it.
 * @example const cache = createTtlCache({ load, ttlMs: MAIL_STATUS_TTL_MS, nowMs }); await cache.get();
 */
export function createTtlCache<T>(required: { load: () => Promise<T>; ttlMs: number; nowMs: () => number }, optional: { minRefreshIntervalMs?: number } = {}): TtlCache<T> {
  let cached: { value: T; expiresAt: number } | undefined;
  let inFlight: Promise<T> | undefined;
  let generation = 0;
  let lastBuildAt = -Infinity;

  const start = (): Promise<T> => {
    lastBuildAt = required.nowMs();
    const startedIn = generation;
    const started = required.load().then((value) => {
      if (startedIn === generation) cached = { value, expiresAt: required.nowMs() + required.ttlMs };
      return value;
    }).finally(() => { if (inFlight === started) inFlight = undefined; });
    inFlight = started;
    return started;
  };

  const minRefreshIntervalMs = optional.minRefreshIntervalMs ?? 0;
  return {
    get: async (optional = {}) => {
      if (optional.refresh && required.nowMs() - lastBuildAt >= minRefreshIntervalMs) {
        generation += 1;
        return start();
      }
      if (cached && required.nowMs() < cached.expiresAt) return cached.value;
      return inFlight ?? start();
    },
    invalidate: () => {
      generation += 1;
      cached = undefined;
      inFlight = undefined;
      lastBuildAt = -Infinity;
    },
  };
}
