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

export const DEFAULT_TRASH_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export const DEFAULT_TRASH_SWEEP_BATCH_SIZE = 50;

export const DEFAULT_TRASH_SWEEP_LEASE_MS = 5 * 60 * 1000;

export interface TrashSweepDeps {
  repo: TrashRepoPort;

  adapters: ReadonlyMap<TrashEntityType, TrashAdapter>;

  transaction: TransactionRunner;
  entityPolicy: TrashEntityPolicy;
}

export interface TrashSweepReport {

  claimed: number;
  purged: number;
  results: { id: string; outcome: PurgeItemOutcome }[];
}

export type TrashSweepOnce = (required: {
  now: string;
  leaseOwner: string;
  leaseUntil: string;
  limit: number;
}) => Promise<TrashSweepReport>;

export interface TrashSweeper {

  stop(required: Record<string, never>): Promise<void>;
}

export function createTrashSweep(deps: TrashSweepDeps): TrashSweepOnce {
  return async function sweepTrashOnce(required): Promise<TrashSweepReport> {
    const claims = await deps.repo.claimDue(required);
    const results: { id: string; outcome: PurgeItemOutcome }[] = [];

    for (const claim of claims) {
      if (!deps.entityPolicy({ entityType: claim.entityType })) { results.push({ id: claim.id, outcome: "forbidden" }); continue; }
      const adapter = deps.adapters.get(claim.entityType);
      if (!adapter) {

        results.push({ id: claim.id, outcome: "adapter-unavailable" });
        continue;
      }

      const outcome = await deps.transaction({ work: async (): Promise<PurgeItemOutcome> => {

        const [row] = await deps.repo.findByIds({ workspaceId: claim.workspaceId, ids: [claim.id] });
        if (!row) return "not-found";

        const result = await adapter.purge({
          workspaceId: row.workspaceId,
          entityId: row.entityId,
          expectedVersion: row.entityVersion,
        });
        if (result === "purged" || result === "already-gone") {
          await deps.repo.deleteById({ workspaceId: row.workspaceId, id: row.id });
        }
        return result;
      } });
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
  schedule(required: { delayMs: number; run: () => void }): unknown;
  cancel(required: { handle: unknown }): void;
}
export function startTrashSweeper(
  required: { sweep: TrashSweepOnce; clock: Clock; scheduler: TrashSchedulerPort; leaseOwner: string },
  optional: { intervalMs?: number; batchSize?: number; leaseMs?: number; onError?: (required: { error: unknown }) => void } = {},
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
      const report = await required.sweep({ now, leaseOwner: required.leaseOwner,
        leaseUntil: new Date(Date.parse(now) + leaseMs).toISOString(), limit: batchSize });
      claimed = report.claimed;
    } catch (error) {
      try { optional.onError?.({ error }); } catch { /* reporter cannot stop the loop */ }
    }
    schedule(claimed >= batchSize ? 0 : intervalMs);
  };
  schedule(0);
  return { async stop(_required) { stopped = true; required.scheduler.cancel({ handle: timer }); await inFlight; } };
}
