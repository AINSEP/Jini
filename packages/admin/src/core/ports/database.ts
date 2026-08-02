/**
 * @file `AdminDatabasePort` — the append-only operations ledger, on-demand restore points, and the
 * forward-migration ceremony.
 *
 * ## Restore points are shared with `AdminRecoveryPort`; the ledger and migration are not
 *
 * `AdminRestorePoint` is the same entity `AdminRecoveryPort.listRecoveryRestorePoints` lists —
 * Database and Recovery are two different *views* onto one persisted set (Database lets an
 * operator create one on demand and see it in the timeline; Recovery lets them restore to one).
 * This port owns the type since `createDatabaseRestorePoint` is where a restore point actually
 * comes into being; `recovery.ts` imports it rather than redeclaring it.
 *
 * ## `migrateForward` satisfies `GatedOperation`; see `recovery.ts` for the triad that doesn't
 *
 * The reference implementation's `planMigrateForward` takes no input and `executeMigrateForward` takes only the
 * confirmation token — no operation-specific extra fields on any of the three calls. That means
 * this triad is a clean, direct instance of `../gated/types.js`'s `GatedOperation`, unlike
 * Recovery's restore ceremony (see that file's header for why restore is different). A
 * compile-time assertion of that fact lives in `../__tests__/database-gated.test.ts`.
 */
import type { GatedConfirmResult, GatedOperation, GatedPlanResult } from '../gated/types.js';

/** One row in the operations ledger — an append-only record of what happened and when, not an
 *  editable entity. */
export interface AdminLedgerRow {
  readonly id: string;
  /** Host-defined event kind (e.g. `"migration"`, `"restore"`, `"restore-point-created"`) — not
   *  enumerated here; see `../transport/errors.ts`'s header for the same reasoning applied to error
   *  codes instead of ledger kinds. */
  readonly kind: string;
  readonly createdAt: string;
  /** The restore point this event produced or consumed, if any. */
  readonly restorePointId: string | null;
  /** Host-defined outcome string (e.g. `"success"`, `"failed"`, `"interrupted"`). */
  readonly outcome: string;
}

/**
 * Whether capturing or restoring to a given point is cheap, expensive, or currently impossible.
 * A host surfaces this so a panel can warn an operator before they trigger a costly capture
 * rather than after.
 */
export type RestorePointCostClass = "cheap" | "expensive" | "unavailable";

/** A persisted restore point — the entity `AdminDatabasePort` and `AdminRecoveryPort` share. */
export interface AdminRestorePoint {
  readonly id: string;
  /** What caused this point to be captured (e.g. `"manual"`, `"pre-migration"`) — host-defined. */
  readonly trigger: string;
  readonly costClass: string;
  readonly kind: string;
  /** Null when the host has no watermark concept or none was available at capture time. */
  readonly watermarkAtCapture: number | null;
  readonly createdAt: string;
}

/** The trimmed shape `createDatabaseRestorePoint` returns — a summary, not the full row, since the
 *  caller just created it and mainly needs to know it succeeded and how expensive it was. */
export interface AdminRestorePointSummary {
  readonly id: string;
  readonly costClass: RestorePointCostClass;
  readonly kind: string;
}

/** `migrateForward`'s terminal success shape. Literal `true` rather than `boolean`: there is no
 *  "migrated: false" response — a non-migration outcome is a rejection, not a `false` payload. */
export interface MigrateForwardResult {
  readonly migrated: true;
}

export interface AdminDatabasePort {
  /**
   * A page of the operations ledger, newest-relevant-first, optionally filtered by `kind` and
   * `outcome` and bounded by `fromDate`/`toDate`. Keyset-paginated via `cursor`/`nextCursor`, not
   * offset-paginated — do not compute a page number from `limit`.
   */
  getDatabaseTimeline(options?: {
    kind?: string;
    outcome?: string;
    fromDate?: string;
    toDate?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: readonly AdminLedgerRow[]; nextCursor: string | null }>;
  listDatabaseRestorePoints(): Promise<readonly AdminRestorePoint[]>;
  /**
   * Captures a new restore point on demand. `costAck` should be `true` once the operator has
   * acknowledged a shown cost warning for a `RestorePointCostClass` of `"expensive"` — a host may
   * reject the call without it rather than silently proceeding.
   */
  createDatabaseRestorePoint(options?: {
    trigger?: string;
    costAck?: boolean;
  }): Promise<AdminRestorePointSummary>;
  /**
   * The forward-migration ceremony (schema/data migration to the host's current expected state),
   * as a `GatedOperation` — see the file header for why this triad, unlike Recovery's restore, fits
   * the generic shape directly. `plan` takes no meaningful input beyond the ceremony trigger; the
   * plan is computed entirely from the site's current migration state server-side.
   */
  readonly migrateForward: GatedOperation<void, unknown, MigrateForwardResult>;
}

// Re-exported for callers that want the gated-protocol types alongside this port's own, without a
// second import from `../gated/types.js`.
export type { GatedConfirmResult, GatedOperation, GatedPlanResult };
