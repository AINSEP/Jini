import type { RetireTarget, ReferenceHolder, MediaSourceReplacement } from "./type-registry.js";
import type { PackedEntity } from "../transfer/index.js";

/**
 * @file The planner's row and report shapes, the natural entity key and the on-screen labels —
 * split out of `planner.ts` (publish-engine P0.8) so a caller that only reads a report does not
 * import the planner. `planner.ts`'s own header documents what a row means and why a refusal is a
 * whole-run state.
 */

/** One entity's recorded sync memory with a specific peer — the read side of
 *  `publish_content_baselines` (`platform/db/schema.sqlite.ts`), abstracted behind a callback so this
 *  module never has to know its caller's storage (SQLite today, an in-memory fake in this module's
 *  own tests). `hashVersion` is checked, never ignored — see this file's header. */
export interface BaselineRecord {
  readonly hashAtLastSync: string;
  readonly hashVersion: number;
}

/**
 * The import side's input: an already-exported, already-hashed set of entities (Task 4's export
 * route builds this; this module never re-derives it and never calls a handler's `pack()`).
 * `sourceLabel` is display-only, mirroring `publishContentRuns.peerLabel` — never used in any
 * comparison or trust decision.
 */
export interface PublishContentBundle {
  readonly artifactFormatVersion: number;
  readonly hashVersion: number;
  readonly sourceLabel?: string;
  readonly entities: readonly PackedEntity[];
}

/** Every outcome a single entity can resolve to. `refused` is deliberately excluded — see this
 *  file's header for why it is a whole-run state, not a per-entity one. */
export type PublishContentOutcomeKind = "created" | "unchanged" | "applied" | "conflict" | "blocked" | "forced";


/** One entity's classification. `writes` describes what a LATER apply pass (Task 8) would do if this
 *  report were accepted as-is — `planImport` itself never writes regardless of this flag's value. */
export interface PublishContentOutcomeRow {
  /** Included in the confirmation hash; binds replacement to the reviewed live bytes/version. */
  readonly sourceReplacement?: MediaSourceReplacement;
  readonly entityType: string;
  readonly entityId: string;
  /** What a human calls this entity — see {@link entityDisplayLabel}. `null` when the packed state
   *  carries nothing human-readable, which is the ONLY case a caller may fall back to showing an id
   *  for. Never load-bearing: nothing compares, keys or authorizes on this field. */
  readonly entityLabel: string | null;
  readonly outcome: PublishContentOutcomeKind;
  readonly writes: boolean;
  /** Human-readable explanation for `conflict`/`blocked`/`forced` (why it was a conflict before being
   *  forced); `null` for `created`/`unchanged`, which need no explanation. */
  readonly reason: string | null;
  /**
   * publish-overwrite-live-plan §4 — true for every `conflict` row (the operator can already force
   * those via {@link PlanImportDeps.forcedEntityKeys}), and for a `blocked` row whose handler resolved
   * a {@link RetireTarget} that is NOT itself part of this bundle (see {@link planEntity}). `false`
   * everywhere else, including a `forced` row reached via the pre-existing conflict-forcing path —
   * that row is already what an operator asked for, not something still being offered.
   */
  readonly canOverwrite: boolean;
  /** Set on a slug-clash `blocked`/`forced` row whose handler resolved a live holder that overwriting
   *  would have to retire first (see {@link PublishContentHandler.planRetire}'s own doc, S4). `null`
   *  for every other row, including a `blocked` row whose handler has no `planRetire` at all. */
  readonly retires: RetireTarget | null;
  /**
   * `publish-repoint-menus-plan-2026-09-24.md` §2.2 — live entities that still link to this row's
   * {@link retires} holder by id (e.g. a menu item whose `entryRef` targets it), collected by a
   * post-pass over every registered handler's {@link PublishContentHandler.referencesTo}. Present
   * ONLY when non-empty — absent for every row with no retire target, and for a retire target with
   * no live references at all — so every pre-existing exact-object row assertion in
   * `planner.test.ts` stays valid without having to name a key it never expected.
   */
  readonly referencedBy?: readonly ReferenceHolder[];
}

/**
 * The full result of one `planImport` call. When {@link refused} is `true`, {@link rows} and
 * {@link applyOrder} are always empty — see this file's header for why a refusal never coexists with
 * a partial per-entity report.
 */
export interface PublishContentReport {
  readonly backstop?: import("../transfer/index.js").BackstopMetadata;
  readonly refused: boolean;
  readonly refusalReason: string | null;
  /** Entity types in the order Task 8's apply loop must walk them — derived from every currently
   *  registered handler's validated `dependsOn` order (see `buildPublishContentCatalog`), plus,
   *  appended at the
   *  end, any type present in the bundle that has NO registered handler on this instance (always
   *  `blocked`; order among those is bundle-first-seen order, since they carry no `dependsOn` to sort
   *  by). Empty when {@link refused} is `true`. */
  readonly applyOrder: readonly string[];
  readonly rows: readonly PublishContentOutcomeRow[];
}

/** The natural key an entity is addressed by everywhere in this module: baselines, forced
 *  selections, and grouping. Exported so a caller building {@link PlanImportDeps.forcedEntityKeys}
 *  (an operator's row selection in Task 7/11) constructs the identical string, rather than
 *  re-deriving the `${type}:${id}` convention by hand and risking a mismatch. */
export function entityKey({ entityType, entityId }: { entityType: string; entityId: string }, _optional = {}): string {
  return `${entityType}:${entityId}`;
}

/** The packed-state fields a human identifier may live under, most identifying first. `slug` leads
 *  because every type that has one guarantees it unique per workspace and derives it from the
 *  operator's own words (`post.slug` is `NOT NULL`; `MediaRecord.slug` is derived from `title` at
 *  upload and unique per `(workspaceId, slug)`), so it is the one value that is both readable AND
 *  addresses exactly one row. `title`/`name`/`filename` follow for a type that has no slug yet;
 *  `label` names a content type (its id is the machine `key`), `regionKey` a widget area. */
const HUMAN_IDENTIFIER_FIELDS = ["slug", "title", "name", "filename", "label", "regionKey"] as const;

/**
 * What to call one packed entity on screen, or `null` when its state carries nothing readable.
 *
 * Derived HERE, in the planner, rather than looked up by whatever renders the report: the report
 * travels to an admin client that holds no content of its own (and, for a push, to an operator
 * looking at a REMOTE instance's plan of the LOCAL site's entities), so the only place both the id
 * and the entity's own fields exist together is this pass. A UI-side lookup would have to re-fetch
 * every row's entity from an instance that may not have it.
 *
 * Reads well-known field names off `state` rather than asking the handler, because `PackedEntity.
 * state` is a `Record<string, unknown>` by contract and every registered type already names its
 * human key one of the fields below. A type whose key is none of them gets `null` and its caller
 * shows a short id — degraded, never wrong.
 *
 * @complexity O(1) — at most six property reads, no allocation on the miss path.
 */
export function entityDisplayLabel({ state }: { state: Record<string, unknown> }, _optional = {}): string | null {
  for (const field of HUMAN_IDENTIFIER_FIELDS) {
    const value = state[field];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

/**
 * What to call one packed entity on screen: its handler's own {@link PackedEntity.displayLabel} when
 * it set one, else {@link entityDisplayLabel} off its `state`. `displayLabel` came off the network on
 * a destination, so anything but a non-blank string is ignored rather than trusted.
 *
 * @complexity O(1).
 */
export function packedEntityLabel({ entity }: { entity: PackedEntity }, _optional = {}): string | null {
  const label: unknown = entity.displayLabel;
  if (typeof label === "string" && label.trim().length > 0) return label;
  return entityDisplayLabel({ state: entity.state });
}
