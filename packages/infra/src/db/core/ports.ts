/**
 * @file Driver-neutral persistence contracts.
 *
 * Purpose:
 * The vocabulary a host talks to its database through, with no statement about which database
 * that is. Every declaration here is an `interface`/`type` that erases at compile time, so this
 * module contributes zero bytes and zero `require()` calls to a consumer's runtime graph.
 *
 * How it relates to the package:
 * `db/core` is the half of `@jini-ai/infra` that must stay installable with no native module
 * present — a host running Supabase/Postgres pulls `@jini-ai/infra/db/core` and never compiles
 * `better-sqlite3`. That property is not a convention here, it is enforced: `pnpm guard`'s
 * R12 check walks this directory's transitive import closure and fails if it reaches a driver
 * folder or a driver package. See `scripts/check-driver-isolation.ts`.
 *
 * Architectural role:
 * Ports. Drivers under `db/<driver>/` implement these; host domain code depends on these and
 * never on a driver. The direction is one-way — `db/sqlite` may import `db/core`, never the
 * reverse — which is what lets a second driver land later without restructuring either side.
 */

/**
 * How expensive a restore point is to capture, which is what lets a caller decide whether to
 * take one inline or defer it. SQLite's whole-file online backup is `cheap`; a logical dump
 * against a networked Postgres is not.
 */
export type RestoreCostClass = 'cheap' | 'expensive';

/**
 * What a captured artifact physically is. `file-snapshot` is a byte-level copy restorable by
 * swapping it into place; `logical-dump` is a replayable statement stream. The distinction
 * matters to callers because only the former is guaranteed to round-trip a database's exact
 * page state (indexes, FTS shadow tables, vacuum layout).
 */
export type RestoreKind = 'file-snapshot' | 'logical-dump';

export interface RestoreCapability {
  readonly costClass: RestoreCostClass;
  readonly kind: RestoreKind;
}

export interface RestorePoint {
  /** Opaque handle the same adapter can later restore from — a filesystem path for file-snapshot drivers. */
  readonly artifactRef: string;
  /** The host's monotonic write counter at capture time, so a caller can tell how stale an artifact is. */
  readonly watermarkAtCapture: number;
}

/**
 * A host-supplied read of the current write watermark. Injected rather than imported so this
 * package never needs to know the host's schema — the watermark lives in a host-owned table
 * whose name this package deliberately does not know, and a driver here only needs its value.
 */
export type WatermarkReader = () => number;

/**
 * Database-level operations that sit beneath the ORM: capability discovery, restore-point
 * capture, and physical restore. Deliberately narrow — anything expressible as a query belongs
 * in a repository, not here.
 */
export interface DbOpsPort {
  getCapabilities(): Promise<{ restorePoint: RestoreCapability }>;
  captureRestorePoint(required: { scopeId: string }): Promise<RestorePoint>;
  restoreFromArtifact(required: { artifactRef: string }): Promise<{ restartRequired: boolean }>;
}
