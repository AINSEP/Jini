import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort } from "@jini-ai/core/primitives";
import type { GatedMutationHooks } from "@jini-ai/core/gated-mutations";
import type { RecoveryHookPolicy } from "./hook-policy.js";

/**
 * @file Database's `GatedMutationHooks` factory for the `migrate-forward` ceremony (SPEC-017
 * C-103/C-105) — the domain-specific quarter of what used to be
 * `server/gated-mutations-composition.ts`, split out so Database no longer needs a back-edge into
 * `server/` for its own hook builder. The generic pieces every ceremony shares (`buildGatewayDeps`,
 * `planHashOf`, `resolveActorClassIdentity`, `buildConfirmOnlyHooks`) stayed in
 * `core/gated-mutations/composition.ts`, which this file imports from — the correct direction (a
 * domain depending on `core`), unlike the old direction (a domain depending on `server`).
 *
 * `LedgerAppendPort` also lives here (not a generic `core` type) because `migrate-forward`'s hooks
 * were its first user; `features/recovery/gated-hooks.ts` imports it from here for its own
 * `restore` ceremony's `databaseLedgerRepo` field rather than duplicating the shape — Recovery
 * already imports several other Database-owned ports (`restore-points.ts`,
 * `boot/reconcile-interrupted-migration.ts`), so this is the established direction, not a new one.
 */

export interface LedgerAppendPort {
  append(row: {
    id: string;
    kind: string;
    correlationId?: string | null;
    restorePointId?: string | null;
    schemaBeforeVersion?: number | null;
    schemaBeforeTag?: string | null;
    schemaAfterVersion?: number | null;
    schemaAfterTag?: string | null;
    driftStatus?: string | null;
    outcome: string;
    detailJson?: string | null;
    actorWorkspaceId?: string | null;
    actorId?: string | null;
    delegatedByWorkspaceId?: string | null;
    delegatedById?: string | null;
    createdAt: string;
  }): Promise<void>;
}

export interface MigrateForwardDbOpsPort {
  getCapabilities(): Promise<{ restorePoint: { costClass: "cheap" | "expensive" | "unavailable"; kind: string } }>;
  captureRestorePoint(params: { scopeId: string }): Promise<{ artifactRef: string; watermarkAtCapture: number }>;
}

export interface BuildMigrateForwardHooksInput extends RecoveryHookPolicy {
  workspaceId: string;
  actorId: string;
  clock: ClockPort;
  idGen: IdGeneratorPort;
  dbOps: MigrateForwardDbOpsPort;
  restorePointsRepo: { save(row: { restorePointId: string; idempotencyKey: string; trigger: string; createdAt: string; createdBy: string; costClass?: string; kind?: string; watermarkAtCapture?: number | null; artifactRef?: string }): Promise<void> };
  databaseLedgerRepo: LedgerAppendPort;
}

/**
 * SPEC-017 C-103/C-105 — the Database `migrate-forward` ceremony's `GatedMutationHooks`.
 *
 * `computePlan()` reads live `dbOps.getCapabilities()` every call (never cached) — a site whose
 * capability changes between plan and execute (e.g. `cheap` -> `unavailable`) correctly produces a
 * different plan hash.
 *
 * `executeMutation()` performs the two safe, real, ADR-041 §2/§3-mandated actions this composition
 * root can perform without inventing an unreviewed live-schema-swap mechanism: it captures a real
 * restore point (`dbOps.captureRestorePoint` — an online-backup file copy in the real SQLite
 * composition, a deterministic double in the hermetic one) and appends a `core.migration`
 * `database_ledger` row anchored to it. It deliberately does NOT re-run `drizzle-orm`'s migrator
 * directly against `content.db` — every composition root already runs `migrate()` unconditionally
 * at `openContentDb()` boot time (`db/sqlite/content-db.ts`), so by the time any ceremony could
 * run, the schema is already at head; re-invoking the migrator here would be a no-op in every
 * environment this dispatch can actually exercise, and this file has no reachable seam into the
 * hermetic (`server/app.ts`) composition's non-existent `content.db` at all. Persisting a
 * `migration_runs` row (the former state machine's attempt ledger) is likewise
 * out of this pass's scope — no composition root wires `SqliteMigrationRunsRepo`/an in-memory
 * counterpart into `RouteDeps` yet; disclosed, not silently skipped.
 *
 * `scopeKind: "instance"` (internal audit, 2026-08-12): `executeMutation()`'s only real side
 * effects are `dbOps.captureRestorePoint` (a whole-file online-backup COPY of `content.db` — the
 * same "never a partial/logical export" mechanism `db/sqlite/db-ops.ts` documents for restore,
 * so the resulting artifact carries every workspace's data, not just the caller's) plus one
 * `restorePointsRepo`/`databaseLedgerRepo` write each. The restore-points subsystem this feeds is
 * itself not workspace-partitioned in practice: the real SQLite repo is nominally `siteId`-scoped
 * but bound to exactly one `siteId` for a whole process's lifetime (`server/deps.ts`), the
 * in-memory test double has no partitioning field at all (`features/database/repo.memory.ts`),
 * and `features/recovery/gated-hooks.ts`'s `buildRestoreHooks` reads `restorePointsRepo.list()`
 * completely unfiltered — so a restore point this ceremony captures is exactly as instance-wide
 * as the one `backup.restore` (`features/recovery/gated-hooks.ts`, same `scopeKind` reasoning)
 * consumes. A workspace-scoped admin should not be able to trigger a whole-instance backup capture
 * that a single workspace's RBAC grant was never meant to cover.
 *
 * @complexity O(1) plus one `captureRestorePoint()` call and two persistence writes.
 * state-machine.ts (features/database/migrate-forward/state-machine.ts) was deleted 2026-10-03: unused; see development/DELETED-CODE.md.
 */
export function buildMigrateForwardHooks(input: BuildMigrateForwardHooksInput, _optional: Record<string, never> = {}): GatedMutationHooks<{ costClass: string; siteId: string }, { migrated: true }> {
  return {
    domain: "database.migrate",
    readPermission: "database.read",
    mutatePermission: "database.migrate",
    scopeId: input.workspaceId,
    scopeKind: "instance",
    computePlan: async () => {
      const capabilities = await input.dbOps.getCapabilities();
      const details = { costClass: capabilities.restorePoint.costClass, siteId: input.workspaceId };
      return { planHash: input.planHashOf({ details }, {}), details };
    },
    executeMutation: async () => {
      // Read fresh, not the `computePlan()` value — CIC U-003: a capability check cached across the
      // plan/execute boundary can go stale, and the saved row must reflect what was ACTUALLY captured.
      const capabilities = await input.dbOps.getCapabilities();
      const captured = await input.dbOps.captureRestorePoint({ scopeId: input.workspaceId });
      const restorePointId = input.idGen.newId();
      const now = clockNowIso({ clock: input.clock });
      await input.restorePointsRepo.save({
        restorePointId,
        idempotencyKey: restorePointId,
        trigger: "migrate-forward",
        createdAt: now,
        createdBy: input.actorId,
        costClass: capabilities.restorePoint.costClass,
        kind: capabilities.restorePoint.kind,
        watermarkAtCapture: captured.watermarkAtCapture,
        artifactRef: captured.artifactRef,
      });
      await input.databaseLedgerRepo.append({
        id: input.idGen.newId(),
        kind: "core.migration",
        restorePointId,
        outcome: "success",
        detailJson: JSON.stringify({ artifactRef: captured.artifactRef }),
        actorWorkspaceId: input.workspaceId,
        actorId: input.actorId,
        createdAt: now,
      });
      return { migrated: true as const };
    },
    resolveActorClassIdentity: input.resolveActorClassIdentity,
  };
}
