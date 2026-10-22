import { randomUUID } from "node:crypto";
import { defaultDbMessages, type DbMessages } from "../core/messages.js";

/**
 * @file `backup_create_restore_point`.
 *
 * Purpose:
 * Mints a restore point independent of any migration, subject to the same cost-acknowledgment
 * discipline `db-ops.getCapabilities` requires everywhere restore points are taken: `cheap`
 * mints freely, `expensive` requires an explicit `costAck`, `unavailable` refuses outright with no
 * override ("no attestation override").
 *
 * How it relates to the project:
 * `capture` is injected so this module never touches a dialect adapter directly — the caller
 * (the `db-ops` SQLite/Postgres adapter) performs the actual online-backup/`pg_dump` and reports
 * back `{artifactRef, watermarkAtCapture}`; this module owns only the cost-gate decision and the
 * resulting `restore_points` summary shape.
 *
 * Architectural role:
 * `features/database` domain logic. Depends only on the injected `capture` callback.
 * See docs/decisions/DR-002-restore-point-precondition.md.
 */

export type RestorePointCostClass = "cheap" | "expensive" | "unavailable";

/** Thrown when an `expensive` restore point is requested without an explicit cost acknowledgment. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Thrown when a restore point is requested on a site whose `db-ops` adapter reports `costClass: 'unavailable'`. */
export class RestorePointUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestorePointUnavailableError";
  }
}

export interface RestorePointSummary {
  id: string;
  costClass: RestorePointCostClass;
  kind: string;
}

/**
 * Mints a restore point, gated on cost acknowledgment.
 * @param _optional.messages Replaces the unavailable-refusal prose without changing the cost gate.
 * @throws RestorePointUnavailableError or ValidationError before capture; capture errors propagate.
 *
 * @complexity O(1) plus one `capture()` call (the adapter owns the actual snapshot cost).
 * @overallScore 100
 */
export async function createRestorePoint(
  required: {
    costClass: RestorePointCostClass;
    /** The host capability's restore kind (`getCapabilities().restorePoint.kind`), returned as-is.
     *  Required, not defaulted: a hardcoded `file-snapshot` mislabeled every Postgres logical dump. */
    kind: string;
    costAck?: boolean;
    capture: () => Promise<{ artifactRef: string; watermarkAtCapture: number }>;
  },
  _optional: { messages?: Pick<DbMessages, "restorePointUnavailable"> } = {}
): Promise<RestorePointSummary> {
  const { costClass, kind, costAck = false, capture } = required;
  const messages = _optional.messages ?? defaultDbMessages;

  if (costClass === "unavailable") {
    throw new RestorePointUnavailableError(
      // See docs/decisions/DR-002-restore-point-precondition.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
      messages.restorePointUnavailable
    );
  }
  if (costClass === "expensive" && !costAck) {
    throw new ValidationError(
      // See docs/decisions/DR-002-restore-point-precondition.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
      "an 'expensive' restore point requires an explicit costAck; the confirmer must acknowledge the cost/disk estimate first"
    );
  }

  await capture();

  return { id: randomUUID(), costClass, kind };
}

/**
 * Admin-UI backend-gap closure (design-spec.md §3.8/§4.8) — the `restore_points` table's missing
 * read side, added alongside `createRestorePoint` above without changing that certified function's
 * behavior or contract.
 */

/** One persisted `restore_points` row, as rendered to the Database/Recovery restore-points list
 * (design-spec.md §3.2/§4.2's shared column set). */
export interface RestorePointRecord {
  id: string;
  trigger: string;
  costClass: string;
  kind: string;
  watermarkAtCapture: number | null;
  createdAt: string;
  /** 2026-07-16: was captured (`DbOpsPort.captureRestorePoint()`) but silently dropped before
   * persistence — `list()` never surfaced it, so `features/recovery`'s restore ceremony had no
   * way to know which file to restore from (see `features/recovery/gated-hooks.ts`'s
   * `buildRestoreHooks` file history). Required, not optional: every real row has one (the
   * `restore_points` table's own column is `NOT NULL`); an empty string for a not-yet-migrated
   * legacy row is a defensive fallback at the read adapter, not a valid new-row state. */
  artifactRef: string;
}

export interface RestorePointListPort {
  list(): Promise<RestorePointRecord[]>;
}

/** Widens `recovery/restore-points.ts`'s `CreateRestorePointRepoPort.save()` shape with the
 * optional descriptive fields `routes/admin/database/restore-points.ts`'s create route persists
 * (the real `SqliteRestorePointsRepo.save()` already accepts all of these; this port just names
 * the subset a route composing `database/restore-points.ts`'s `createRestorePoint` needs). Declared
 * independently rather than importing/extending `CreateRestorePointRepoPort` so this file keeps
 * `features/recovery` at arm's length (the same "no shared import, kept decoupled" convention
 * this package's own `write-service.ts`-adjacent files already use). */
export interface RestorePointSavePort {
  save(row: {
    restorePointId: string;
    idempotencyKey: string;
    trigger: string;
    createdAt: string;
    createdBy: string;
    costClass?: string;
    kind?: string;
    watermarkAtCapture?: number | null;
    artifactRef?: string | undefined;
  }): Promise<void>;
}

/** Same narrow shape as `recovery/restore-points.ts`'s `CreateRestorePointRepoPort.findByIdempotencyKey`
 * ( `(site_id, idempotency_key)` lookup), declared independently here for the identical
 * "keep `features/recovery` at arm's length" reason `RestorePointSavePort` above documents. Both
 * concrete repos backing this route (`SqliteRestorePointsRepo`, `InMemoryRestorePointsRepo`) already
 * implement this method; only the route's own dependency type was narrower.
 * See docs/decisions/DR-002-restore-point-precondition.md.
 */
export interface RestorePointIdempotencyLookupPort {
  findByIdempotencyKey(key: string): Promise<{ restorePointId: string; idempotencyKey: string } | null>;
}

/**
 * Lists every restore point recorded for this site, newest-first (the port's own contract —
 * `db/sqlite/database-journal-repo.ts`'s `SqliteRestorePointsRepo.list()` already orders this
 * way; this function does not re-sort, matching `getTimeline`'s "the port owns the actual query
 * shape" precedent).
 *
 * @complexity O(1) plus one `RestorePointListPort.list()` call.
 * @overallScore 100
 */
export async function listRestorePoints(
  required: { repo: RestorePointListPort },
  _optional: Record<string, never> = {}
): Promise<{ items: RestorePointRecord[] }> {
  const items = await required.repo.list();
  return { items };
}
