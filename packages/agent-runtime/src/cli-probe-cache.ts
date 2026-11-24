/** Background inventory caching for detected CLIs; the host injects the probe (its inventory port).
 * Discovery stays behind the existing runtime port; requests only read settled snapshots. */

/** The shared probe tail: caches given the same queue never launch overlapping CLI sweeps.
 * Host-owned (one per process is typical) so this module keeps no state of its own. */
export interface CliProbeQueue { tail: Promise<void> }

/** A fresh, idle probe queue for {@link createCliProbeCache}'s `probeQueue`. */
export function createCliProbeQueue(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): CliProbeQueue {
  return { tail: Promise.resolve() };
}

/** One inventory per host port. Catalog expiry schedules a lazy background refresh.
 * Failed scans keep the snapshot until the optional retry cooldown; explicit Rescan always retries.
 * A rescan during a scan coalesces into one forced follow-up, never a second concurrent sweep.
 * @complexity O(1) bookkeeping; snapshot/probe cost belongs to the injected inventory port. */
export function createCliProbeCache<T>(
  { initial, probe, probeQueue }: { initial: () => T; probe: (input: { force: boolean }, options: Record<string, never>) => Promise<T>; probeQueue: CliProbeQueue },
  { expiresAt, retryAfterMs }: {
    expiresAt?: (input: { snapshot: T }, options: Record<string, never>) => number;
    retryAfterMs?: number;
  } = {},
) {
  let snapshot: Promise<T> | undefined;
  let pending: Promise<void> | undefined;
  let started = false;
  let rescanQueued = false;
  let snapshotExpiresAt = Infinity;

  function refresh({ force }: { force: boolean }, _options: Record<string, never> = {}): void {
    if (pending) { rescanQueued ||= force; return; }
    started = true;
    // Let the request serialize its cached response before even launching the first CLI.
    const turn = new Promise<void>(resolve => { setImmediate(resolve); });
    pending = probeQueue.tail.then(() => turn).then(async () => {
      try {
        const result = await probe({ force }, {});
        snapshotExpiresAt = expiresAt?.({ snapshot: result }, {}) ?? Infinity;
        snapshot = Promise.resolve(result);
      }
      catch {
        // Keep last-good data without hammering a failing host or caching an initial failure forever.
        snapshotExpiresAt = retryAfterMs === undefined ? Infinity : Date.now() + retryAfterMs;
      }
    }).finally(() => {
      pending = undefined;
      if (rescanQueued) { rescanQueued = false; refresh({ force: true }); }
    });
    probeQueue.tail = pending;
  }

  return {
    isPending(_input: Record<string, never>, _options: Record<string, never> = {}): boolean { return pending !== undefined; },
    read({ force = false }: { force?: boolean }, _options: Record<string, never> = {}): Promise<T> {
      snapshot ??= Promise.resolve(initial());
      if (!started || force || snapshotExpiresAt <= Date.now()) refresh({ force });
      return snapshot;
    },
    /** Explicit completion port for diagnostics/tests; HTTP readers never call it. */
    async settled(_input: Record<string, never>, _options: Record<string, never> = {}): Promise<void> {
      while (pending) await pending;
    },
  };
}
