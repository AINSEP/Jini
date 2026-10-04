/**
 * @file The retention auto-purge backstop (60 days by default) — claim, compare, delete, in that order.
 *
 * Two halves on purpose, because they fail in completely different ways:
 *
 *  - {@link createTrashSweep} is the decision half. It has no clock, no timer and no randomness, so
 *    every branch below (the restore race, a stale version, a missing adapter) is a plain function
 *    call in a test rather than something you have to wait for.
 *  - {@link startTrashSweeper} is the effect half: a non-overlapping loop over an injected scheduler. The host owns timer cancellation and
 *    `unref`, so the loop stays portable without changing its first-turn and shutdown behavior.
 *
 * **A concurrent restore always wins.** That is the whole safety property, and it is bought twice
 * over, because either guard alone has a hole:
 *
 *  1. Inside the purge transaction the index row is re-read by id. A restore deletes that row in
 *     its own transaction, so a sweep whose claim is already in hand finds nothing and never calls
 *     `purge` at all. Version alone would not cover a domain whose `entity_version` is `null`
 *     (comments and redirects both are) — there is no version there to have changed.
 *  2. `adapter.purge` is still a compare-and-delete on the version captured at trash time, so a
 *     domain that does carry a version stands down even if the row somehow survived step 1.
 *
 * The lease is the third leg: a claimed row is invisible to other sweeps until `leaseUntil`, so two
 * processes serving the same file cannot both purge it, and a sweep that dies mid-batch releases
 * its rows by expiry rather than wedging them forever.
 */
import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
import type { Clock } from "@jini-ai/core/primitives";
/** Claim then re-read inside the purge transaction; a concurrent restore always wins. */
import type {
  PurgeItemOutcome,
  TrashAdapter,
  TrashEntityType,
  TrashEntityPolicy,
  TrashRepoPort,
  TransactionRunner,
} from "./ports.js";

/** Idle wait between sweeps. Retention is measured in days, so an hour of lateness costs nothing,
 *  and a desktop site that is only open for minutes still sweeps once at boot. */
export const DEFAULT_TRASH_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Rows claimed per sweep. Each one costs a transaction, so this bounds a single sweep's hold on
 *  the write lock; a full batch sweeps again immediately rather than waiting out the interval. */
export const DEFAULT_TRASH_SWEEP_BATCH_SIZE = 50;

/** How long a claim hides a row from other sweeps. Also the retry backoff for a row that stood
 *  down: nothing releases it early, so it is re-tried at most once per lease. */
export const DEFAULT_TRASH_SWEEP_LEASE_MS = 5 * 60 * 1000;

export interface TrashSweepDeps {
  repo: TrashRepoPort;
  /** The same call-time `Map` the write service resolves against — never a module-level registry. */
  adapters: ReadonlyMap<TrashEntityType, TrashAdapter>;
  /** Reentrant; see {@link TransactionRunner}. */
  transaction: TransactionRunner;
  entityPolicy: TrashEntityPolicy;
}

export interface TrashSweepReport {
  /** Rows this sweep leased. `claimed === limit` means there is probably more due right now. */
  claimed: number;
  purged: number;
  results: { id: string; outcome: PurgeItemOutcome; }[];
}

/**
 * One pass of the backstop. Time, identity and batch size are arguments rather than dependencies so
 * the decision logic stays deterministic.
 */
export type TrashSweepOnce = (required: {
  now: string;
  leaseOwner: string;
  leaseUntil: string;
  limit: number;
}) => Promise<TrashSweepReport>;

export interface TrashSweeper {
  /** Stops scheduling sweeps, then resolves once a sweep already running has settled. Idempotent. */
  stop(required: Record<string, never>): Promise<void>;
}

/**
 * Builds the sweep pass.
 *
 * @param deps the trash repo, the call-time adapter map and a reentrant transaction runner.
 * @returns a {@link TrashSweepOnce}. It never throws for a single bad row — one missing adapter or
 *          one stale version is recorded as that row's outcome and the rest of the batch continues.
 *          A repo-level failure (a locked database) does propagate; the caller's `onError` owns it.
 * @complexity O(limit) transactions per pass, each O(1); one indexed claim query.
 */
export function createTrashSweep(deps: TrashSweepDeps): TrashSweepOnce {
  return async function sweepTrashOnce(required): Promise<TrashSweepReport> {
    const claims = await deps.repo.claimDue(required);
    const results: { id: string; outcome: PurgeItemOutcome; }[] = [];

    for (const claim of claims) {
      const adapter = deps.adapters.get(claim.entityType);
      if (!adapter) {

        // Keep the lease: immediately retrying an uninstalled domain would starve the batch.
        // Its snapshot stays listed until expiry, and removal can resume when the domain returns.
        results.push({ id: claim.id, outcome: "adapter-unavailable" });
        continue;
      }
      if (!deps.entityPolicy({ entityType: claim.entityType })) { results.push({ id: claim.id, outcome: "forbidden" }); continue; }

      const outcome = await deps.transaction({
        work: async (): Promise<PurgeItemOutcome> => {

          // Restore removes the index in its own transaction, including unversioned domains.
          const [row] = await deps.repo.findByIds({ workspaceId: claim.workspaceId, ids: [claim.id] });
          if (!row) return "not-found";

          // Versioned domains also stand down on a compare-and-delete mismatch.
          const result = await adapter.purge({
            workspaceId: row.workspaceId,
            entityId: row.entityId,
            expectedVersion: row.entityVersion,
          });
          if (result === "purged" || result === "already-gone") {
            await deps.repo.deleteById({ workspaceId: row.workspaceId, id: row.id });
          }
          return result;
        }
      });
      results.push({ id: claim.id, outcome });
    }

    return {
      claimed: claims.length,
      purged: results.filter((r) => r.outcome === "purged").length,
      results,
    };
  };
}

/** Host scheduler owns timers, unref and cancellation. schedule must defer run to a later turn. */
export interface TrashSchedulerPort {
  schedule(required: { delayMs: number; run: () => void; }): unknown;
  cancel(required: { handle: unknown; }): void;
}
export function startTrashSweeper(
  required: { sweep: TrashSweepOnce; clock: Clock; scheduler: TrashSchedulerPort; leaseOwner: string; },
  optional: { intervalMs?: number; batchSize?: number; leaseMs?: number; onError?: (required: { error: unknown; }) => void; } = {},
): TrashSweeper {
  const intervalMs = optional.intervalMs ?? DEFAULT_TRASH_SWEEP_INTERVAL_MS;
  const batchSize = optional.batchSize ?? DEFAULT_TRASH_SWEEP_BATCH_SIZE;
  const leaseMs = optional.leaseMs ?? DEFAULT_TRASH_SWEEP_LEASE_MS;
  for (const value of [intervalMs, batchSize, leaseMs]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("trash sweep bounds must be positive integers");
  }
  if (!required.leaseOwner) throw new RangeError("trash sweep leaseOwner must not be empty");
  let stopped = false;
  let timer: unknown;
  let inFlight: Promise<void> = Promise.resolve();
  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = required.scheduler.schedule({ delayMs, run: () => { inFlight = sweep(); } });
  };
  const sweep = async (): Promise<void> => {
    let claimed = 0;
    try {
      const now = kernelNowIso({ clock: required.clock });
      const report = await required.sweep({
        now, leaseOwner: required.leaseOwner,
        leaseUntil: new Date(Date.parse(now) + leaseMs).toISOString(), limit: batchSize
      });
      claimed = report.claimed;
    } catch (error) {
      try { optional.onError?.({ error }); } catch { /* reporter cannot stop the loop */ }
    }
    schedule(claimed >= batchSize ? 0 : intervalMs);
  };
  schedule(0);
  return { async stop(_required) { stopped = true; required.scheduler.cancel({ handle: timer }); await inFlight; } };
}
