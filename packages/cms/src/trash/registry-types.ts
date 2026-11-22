import type { TrashEntityType } from "./ports.js";

/**
 * Where a domain's "trashed" state lives:
 *  - `timestamp` — a nullable column, `NULL` = live (posts, media, redirects, `form`). Restoring
 *    always clears it; there is no "previous value" to remember.
 *  - `status` — an enum-ish text column with a distinct `trashed` value, and a `restoreFallback` for
 *    rows with no recorded prior value.
 */
export type TrashMarkerSpec =
  | { kind: "timestamp"; column: string }
  | { kind: "status"; column: string; trashed: string; restoreFallback: string };

/** Column-only snapshot for a Trash row's two display lines (SEE `TrashDisplay` in `ports.ts`).
 *  `join` reaches ONE parent row for a column that is not on the entry's own table (a submission's
 *  form name) — an inner join, so it is only for parents a foreign key guarantees. */
export interface TrashDisplaySpec {
  /** Qualified `table.column`. */
  title: string;
  /** Qualified `table.column`. */
  subtitle?: string;
  join?: TrashDisplayJoin;
}

/** One inner join: `table` joined on `on[0] = on[1]` (both qualified `table.column`). */
export interface TrashDisplayJoin {
  table: string;
  on: readonly [string, string];
}

/**
 * A child table to delete, in order, before the parent row itself — e.g. a form's submissions.
 *
 * Exactly one of `parentIdColumn`/`via` is set:
 *  - `parentIdColumn` — the DIRECT case, `table`'s own column holds the parent id (a submission's
 *    `form_definition_id`).
 *  - `via` — the TWO-HOP case, `table` has no column pointing at the parent directly (`entry_terms`
 *    has only `term_id`, not `taxonomy_id`), so its rows are resolved through another table first:
 *    `entry_terms.term_id IN (SELECT id FROM terms WHERE taxonomy_id = ?)`.
 */
export interface TrashCascadeSpec {
  table: string;
  /** DIRECT case: the child column holding the parent's id. */
  parentIdColumn?: string;
  /** TWO-HOP case: `table`'s child rows are resolved through `throughTable` first. */
  via?: {
    /** The column on `table` matched against the ids resolved from `throughTable` (`entry_terms.term_id`). */
    matchColumn: string;
    /** The table the parent's children are actually recorded on (`terms`). */
    throughTable: string;
    /** `throughTable`'s own id column (`terms.id`). */
    throughIdColumn: string;
    /** `throughTable`'s column holding the id of the entity being purged (`terms.taxonomy_id`). */
    throughParentIdColumn: string;
  };
  /** `table`'s own id column — required only alongside `entityType`, to know which child ids are
   *  about to be removed before their `trashed_items` rows are cleaned up. */
  idColumn?: string;
  /**
   * Set when the cascaded child kind is ITSELF a `TRASHABLE` registry entry (`form_submission` under
   * `form`, `term` under `taxonomy`). A purge then also deletes the `trashed_items` rows of the child
   * ids it is about to remove, in the same transaction, before the child rows go — otherwise a
   * child that was trashed independently (a submission moved to the Trash on its own, then its form
   * purged) leaves a phantom Trash row pointing at nothing (the opus-1 known gap, T1 item 5).
   */
  entityType?: TrashEntityType;
}

/**
 * Refuses `hide` (and therefore `purge`, which only ever runs on an already-trashed row) while rows
 * matching this spec exist — e.g. a term with child terms, live or trashed, so a purge can never
 * leave a dangling `parent_id`.
 */
export interface TrashBlockerSpec {
  /** The table to count rows in (`terms`, checking for children of the term being trashed). */
  table: string;
  /** The child column holding this entity's id (`terms.parent_id`). */
  parentIdColumn: string;
  /** Machine-readable reason surfaced in the 409 body (`TERM_HAS_CHILDREN`). */
  code: string;
}

/**
 * A term is trashed the moment its taxonomy is — there is no second write, no cascade-hide of every
 * member term. `notTrashed` (`not-trashed.ts`) read this to treat a live term
 * whose taxonomy is trashed as trashed too, so `moveToTrash` on it reads `not-found` (a caller cannot
 * re-trash what is already hidden through its parent) — same precedence `not-trashed.ts`'s own file
 * header already documents for the plain marker check.
 *
 * `isTrashedRecord` (the in-memory twin) CANNOT evaluate this: a flat record has no parent row to
 * join against, so it reports the entity's own marker only — see its doc.
 */
export interface TrashHiddenWithParentSpec {
  /** The parent's own table (`taxonomies`). */
  parentTable: string;
  /** This entity's column pointing at the parent (`terms.taxonomy_id`). */
  parentIdColumn: string;
  /** The parent table's own id column (`taxonomies.id`). */
  parentPkColumn: string;
  /** The parent's own marker spec, reused to test whether the parent itself is currently trashed. */
  parentMarker: TrashMarkerSpec;
}

/**
 * One domain's registration. Optional fields are added when the first entry needs one, never ahead
 * of it — see the plan's entry table (§4) for the full eventual shape.
 */
export interface TrashEntry {
  readonly entityType: TrashEntityType;
  /** English; the admin translates it with `t()`. */
  readonly label: string;
  readonly permission: string;
  readonly table: string;
  readonly idColumn: string;
  readonly workspaceColumn: string;
  /** A fixed `column = value` predicate ANDed into every query this entry's adapter runs — e.g.
   *  `type = 'widget'` against the shared `entries` table. */
  readonly scope?: { column: string; equals: string };
  readonly marker: TrashMarkerSpec;
  /** Optimistic-concurrency column. `undefined` for a domain with no version column (none in G1). */
  readonly versionColumn?: string;
  /** `updated_at`-shaped column, stamped alongside the marker. */
  readonly touchColumn?: string;
  readonly display: TrashDisplaySpec;
  /** Child rows removed, in this order, before the entry's own row — see `TrashCascadeSpec`. */
  readonly purgeFirst?: readonly TrashCascadeSpec[];
  /** Refuses `hide` while blocking rows exist — see `TrashBlockerSpec`. */
  readonly blocker?: TrashBlockerSpec;
  /** This entity reads as trashed whenever its parent is — see `TrashHiddenWithParentSpec`. */
  readonly hiddenWithParent?: TrashHiddenWithParentSpec;
}

export type TrashRegistry = ReadonlyMap<TrashEntityType, TrashEntry>;
