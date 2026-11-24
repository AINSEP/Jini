import { CONTENT_HASH_VERSION } from "./content-hash.js";
import { PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION } from "../transfer/index.js";
import { entityKey, packedEntityLabel } from "./plan-rows.js";
import type {
  BaselineRecord, PublishContentBundle, PublishContentOutcomeRow, PublishContentReport,
} from "./plan-rows.js";
import type { PublishContentDeps, PublishContentHandler, PublishContentTypeRegistry, ReferenceHolder } from "./type-registry.js";
import type { PackedEntity } from "../transfer/index.js";

/**
 * @file Task 5 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4 task 5 / §5 risks
 * #1–#3 and #10.
 *
 * `planImport()` is **pure planning — it never writes.** It is what an operator sees before
 * confirming anything (plan §1.5's gated-mutation `computePlan()`), and it is what Task 7's
 * `PLAN_STALE` re-derivation re-runs at execute time to detect a destination that moved between
 * plan and apply. Every code path in this file only ever calls a handler's `inspect()`/`precheck()`
 * (both documented read-only in `type-registry.ts`) or the caller-supplied `getBaseline`/`hasBlob`
 * reads — never a handler's `apply()`, never a repo write.
 *
 * ## The seven outcomes (plan §4's own safety-property table)
 *
 * | Outcome     | Condition                                                              | Writes (later, in Task 8)? |
 * |-------------|-------------------------------------------------------------------------|-----------------------------|
 * | `created`   | no destination row with this id                                        | yes |
 * | `unchanged` | destination hash == source hash                                        | no  |
 * | `applied`   | destination hash == recorded baseline (untouched since we last spoke)  | yes |
 * | `applied`   | no recorded baseline, but destination hash == the SHIPPED SEED's hash  | yes |
 * | `conflict`  | destination hash differs from BOTH source and baseline — edited there  | no  |
 * | `conflict`  | no baseline AND no seed match (or no seed hash supplied at all)        | no  |
 * | `blocked`   | a precondition fails: slug taken, required blob gone, etc.             | no  |
 * | `forced`    | outcome was `conflict` and the operator explicitly chose this row      | yes |
 *
 * The `applied`-via-seed row is D1 (2026-09-24 owner decision) — see {@link PlanImportDeps.getSeedHash}'s
 * own doc for why "no baseline" no longer means "conflict, always" once a seed hash is wired.
 *
 * `refused` is deliberately NOT a `PublishContentOutcomeKind` — it is a WHOLE-RUN state (see
 * {@link PublishContentReport.refused}) for incompatible incoming bundles. Stored baselines from
 * another hash generation are instead unknown history: current source/destination hashes can
 * still be compared, but an obsolete hash must never authorize an automatic overwrite.
 *
 * The critical asymmetry the table encodes, restated because it is the one a competent implementer
 * is most likely to get backwards: **no baseline is a `conflict`, never a free pass to `created`.**
 * A destination that already holds unrelated content — most importantly, the very first sync against
 * an existing production database — must never be silently overwritten just because this peer never
 * recorded a baseline for it. Fail closed, never open. D1's seed-hash fallback does not weaken this:
 * it only ever turns "no baseline" into `applied` (an ordinary overwrite of a row proven byte-identical
 * to what this install itself shipped there), never into `created`, and only when the destination's
 * CURRENT content still matches the seed exactly — any drift at all, from any cause, stays a `conflict`.
 *
 * ## Two-pass structure
 *
 * Pass 1 prefetches every entity's baseline, treating a different `CONTENT_HASH_VERSION`
 * generation as missing history so upgrades can re-baseline through the usual safe outcomes.
 * Pass 2 classifies every entity into exactly one outcome, walking types in `dependsOn`-derived
 * apply order (see `buildPublishContentCatalog`) so a caller applying `rows` in this exact
 * sequence (Task 8) always writes a prerequisite before its dependent.
 *
 * ## Why `buildPublishContentCatalog()` is called INSIDE `planImport`, every call
 *
 * Plan §3 rule 2, verbatim: "`listPublishContentContributors()` is called at publish time, inside
 * the planner, never captured at module load." `buildPublishContentCatalog()` performs that fresh
 * read and validates the dependency graph before it builds handlers. `planImport` never caches the
 * catalog across calls — a contributor registered between two calls is picked up by the next one.
 */

/**
 * Dependencies `planImport` needs, none of which it is ever allowed to write through.
 *
 * `publishContentDeps` is handed to every registered contributor's `build()` (see this file's
 * header on why the registry is read fresh, inside this function, every call) — it is NOT this
 * module's own deps shape, it is `type-registry.ts`'s, unchanged, so a new contributor's needs never
 * require touching this planner.
 */
export interface PlanImportDeps<P> {
  readonly publishContentDeps: PublishContentDeps<P>;
  /** The host-bound publishable-type registry's catalog builder. Injected (required, never defaulted) because the
   *  engine registry is generic over the host's port bag and the process-wide instance lives in the host; the planner
   *  still calls it INSIDE every `planImport` so it reads the registry fresh (rule 2 above). */
  readonly catalog: { readonly build: PublishContentTypeRegistry<P>["buildCatalog"] };
  /** Reads one entity's baseline for the peer this import is running against — already scoped to
   *  `(workspaceId, peerPrincipalId)` by the caller's own closure (plan §1.6: baselines are keyed by
   *  the AUTHENTICATED principal, never a bundle-declared id — this module has no principal of its
   *  own to leak into that key by mistake, because it never sees one). */
  readonly getBaseline: (args: { entityType: string; entityId: string }, optional?: {}) => Promise<BaselineRecord | null>;
  /** Whether a blob this instance would need (by sha256) is already available — Task 6's blob store
   *  is not this module's concern; this is a narrow read-only probe a later composition wires to the
   *  real `BlobStorePort`. Required (not optional) so a caller is forced to make a deliberate choice
   *  for it rather than the check silently always passing. */
  readonly hasBlob: (required: { sha256: string }, optional?: Record<string, never>) => Promise<boolean>;
  /**
   * D1 (2026-09-24 owner decision, publish-types-plan §6) — the hash this entity had in the SHIPPED
   * SEED database (`content.seed.db`) this destination was originally hydrated from, consulted only
   * when {@link getBaseline} found no recorded baseline. A destination row that still matches the
   * seed exactly has never been touched there since — the very first real publish against it should
   * overwrite it like any other `applied` row, not sit in `conflict` forever for want of a
   * `publish_content_baselines` row nothing has ever had a reason to write (the owner's own reported
   * bug: publishing a new header nav never replaces the ORIGINAL seeded one).
   *
   * Optional, and consulted ONLY when there is no real baseline (see {@link planEntity}) — a real
   * recorded baseline always wins outright, exactly like before D1; this is purely a fallback for
   * "no baseline yet", never a second vote once one exists. Absent entirely (`undefined`), or
   * resolving `null` for a given entity (not present in that seed at all), falls straight through to
   * the pre-D1 "no baseline" conflict — the safe, unchanged default. Wiring a real implementation
   * (packing the matching entity out of `dist/content/seed-sites/<site>/content.seed.db`) is a
   * separate follow-up; today's one production caller (`gated-hooks.ts`) does not supply it yet.
   */
  readonly getSeedHash?: (args: { entityType: string; entityId: string }, optional?: {}) => Promise<string | null>;
  /** Entity keys (see {@link entityKey}) the operator has explicitly chosen to force past a
   *  `conflict`, turning that one row's outcome into `forced`. Absent/empty means "force nothing" —
   *  every conflict stays a conflict, the safe default. */
  readonly forcedEntityKeys?: ReadonlySet<string>;
}

interface PlanEntityArgs<P> {
  entity: PackedEntity;
  handler: PublishContentHandler | undefined;
  baseline: BaselineRecord | null;
  deps: PlanImportDeps<P>;
  bundleKeys: ReadonlySet<string>;
}

/**
 * Classifies exactly one entity — the per-row half of {@link planImport}'s pass 2.
 * Pass 1 supplies only current-generation baselines, or null for unknown history.
 *
 * Precondition checks (required blobs, then `handler.precheck`) run UNCONDITIONALLY, before any
 * hash comparison — deliberately not skipped for an entity that would otherwise turn out
 * `unchanged`/non-writing, so a real data-integrity problem (e.g. a slug collision) is always visible
 * in the report rather than hidden behind "nothing would have changed anyway".
 *
 * @complexity O(1) plus whatever `handler.inspect`/`handler.precheck`/`deps.hasBlob` cost — one call
 * to each, never more, regardless of `entity.requiredBlobs.length` beyond the first failing blob
 * (short-circuits on the first missing one).
 */
async function planEntity<P>(
  { entity, handler, baseline, deps, bundleKeys }: PlanEntityArgs<P>,
  _optional = {}
): Promise<PublishContentOutcomeRow> {
  const identity = {
    entityType: entity.entityType,
    entityId: entity.id,
    entityLabel: packedEntityLabel({ entity }),
  };

  if (!handler) {
    return {
      ...identity,
      outcome: "blocked",
      writes: false,
      reason: `no registered publish-content handler for entity type '${entity.entityType}' on this instance`,
      canOverwrite: false,
      retires: null,
    };
  }

  for (const sha256 of entity.requiredBlobs) {
    if (!(await deps.hasBlob({ sha256 }))) {
      return {
        ...identity,
        outcome: "blocked",
        writes: false,
        reason: `required blob '${sha256}' is not available on this instance`,
        canOverwrite: false,
        retires: null,
      };
    }
  }

  const blockReason = await handler.precheck({ entity });
  if (blockReason) {
    if (typeof blockReason !== "string") {
      const forced = deps.forcedEntityKeys?.has(entityKey({ entityType: entity.entityType, entityId: entity.id })) ?? false;
      return { ...identity, outcome: forced ? "forced" : "blocked", writes: forced,
        reason: await replacementReason({ entity, handler, baseline, reason: blockReason.reason }), canOverwrite: true, retires: null, sourceReplacement: blockReason.sourceReplacement };
    }
    return planBlockedEntity({ entity, handler, deps, bundleKeys, identity, blockReason });
  }
  return planCheckedEntity({ entity, handler, baseline, deps, identity });
}

/** Keep the live-edit warning when a file change offers Overwrite before ordinary conflict planning.
 * @returns Operator copy. @complexity O(1), one indexed inspect only when a baseline exists. */
async function replacementReason({ entity, handler, baseline, reason }: {
  entity: PackedEntity; handler: PublishContentHandler; baseline: BaselineRecord | null; reason: string;
}, _options = {}): Promise<string> {
  const destination = baseline ? await handler.inspect({ id: entity.id }) : null;
  return destination && baseline && destination.hash !== baseline.hashAtLastSync
    ? `${reason} This file has been edited on the destination since the last sync with this peer.` : reason;
}

type RowIdentity = Pick<PublishContentOutcomeRow, "entityType" | "entityId" | "entityLabel">;

/** Resolves a precheck refusal into an overwrite offer when safe. @complexity O(1) plus handler I/O. */
async function planBlockedEntity<P>({ entity, handler, deps, bundleKeys, identity, blockReason }: {
  entity: PackedEntity; handler: PublishContentHandler; deps: PlanImportDeps<P>;
  bundleKeys: ReadonlySet<string>; identity: RowIdentity; blockReason: string;
}, _options = {}): Promise<PublishContentOutcomeRow> {
  // publish-overwrite-live-plan §4/S2 — a slug clash this handler knows how to resolve gets offered
  // as an overwrite, UNLESS the row that would have to be retired is itself part of this same
  // bundle (retiring it would move its own slug out from under it mid-run — an ordering problem,
  // not an overwrite; plan §2's last table row). An already-forced key (the operator's own prior
  // "overwrite on live" tick, the same `forcedEntityKeys` mechanism the conflict branch below uses)
  // turns a valid target straight into `forced` with the target attached.
  const target = await handler.planRetire?.({ entity }) ?? null;
  if (target !== null) {
    if (bundleKeys.has(entityKey({ entityType: target.entityType, entityId: target.entityId }))) {
      return { ...identity, outcome: "blocked", writes: false, reason: blockReason, canOverwrite: false, retires: null };
    }
    const forced = deps.forcedEntityKeys?.has(entityKey({ entityType: entity.entityType, entityId: entity.id })) ?? false;
    if (forced) {
      return { ...identity, outcome: "forced", writes: true, reason: blockReason, canOverwrite: true, retires: target };
    }
    return { ...identity, outcome: "blocked", writes: false, reason: blockReason, canOverwrite: true, retires: target };
  }
  return { ...identity, outcome: "blocked", writes: false, reason: blockReason, canOverwrite: false, retires: null };
}

/** Compares checked incoming content against destination and sync memory. @complexity O(1) plus reads. */
async function planCheckedEntity<P>({ entity, handler, baseline, deps, identity }: {
  entity: PackedEntity; handler: PublishContentHandler; baseline: BaselineRecord | null;
  deps: PlanImportDeps<P>; identity: RowIdentity;
}, _options = {}): Promise<PublishContentOutcomeRow> {
  const destination = await handler.inspect({ id: entity.id });
  if (!destination) {
    return { ...identity, outcome: "created", writes: true, reason: null, canOverwrite: false, retires: null };
  }
  if (destination.hash === entity.contentHash) {
    return { ...identity, outcome: "unchanged", writes: false, reason: null, canOverwrite: false, retires: null };
  }
  if (baseline && destination.hash === baseline.hashAtLastSync) {
    return { ...identity, outcome: "applied", writes: true, reason: null, canOverwrite: false, retires: null };
  }

  // D1 (2026-09-24 owner decision, see this module's header and `getSeedHash`'s own doc): no
  // RECORDED baseline exists, but the destination still matches exactly what the shipped seed put
  // there. Treat the seed's own hash as a virtual baseline — the same "untouched since we last
  // agreed" reasoning as the branch above, just with the seed standing in for a sync that never
  // happened. Only reachable when `baseline` is falsy, so a real recorded baseline always takes
  // priority and this never re-litigates an already-resolved conflict.
  //
  // S-F4: when the generic seed-db lookup has no answer, a handler whose seed is not a DB row (e.g.
  // `theme-files`' `__original-themes__` folders) answers for itself via `handler.seedHash`.
  if (!baseline) {
    const seedHash = await entitySeedHash({ entity, handler, deps });
    if (seedHash !== null && destination.hash === seedHash) {
      return { ...identity, outcome: "applied", writes: true, reason: null, canOverwrite: false, retires: null };
    }
  }

  return planConflict({ entity, baseline, deps, identity });
}

/** Requires explicit operator choice for destination drift. @complexity O(1). */
function planConflict<P>({ entity, baseline, deps, identity }: {
  entity: PackedEntity; baseline: BaselineRecord | null; deps: PlanImportDeps<P>; identity: RowIdentity;
}, _options = {}): PublishContentOutcomeRow {
  // Destination differs from both the incoming source AND the recorded baseline (or there is no
  // baseline at all) — plan §4's two `conflict` rows, unified here because both mean the same thing
  // to the operator: "this destination row does not match what we last agreed on; overwriting it
  // needs your explicit say-so." The reason text is the only place the two causes are distinguished.
  const conflictReason = baseline
    ? `${entity.entityType} '${entity.id}' has been edited on the destination since the last sync with this peer`
    : `no prior sync baseline for ${entity.entityType} '${entity.id}' with this peer — the destination already holds different content`;
  const forced = deps.forcedEntityKeys?.has(entityKey({ entityType: entity.entityType, entityId: entity.id })) ?? false;
  if (forced) {
    // Unlike the retire-offered `forced` row above, this one already went through the (separate,
    // pre-existing) plain conflict-forcing path — nothing is still being "offered" here, so it gets
    // the same `canOverwrite:false, retires:null` as any other non-offer row (publish-overwrite-live-
    // plan §4: only the `conflict` outcome itself, and a valid retire target, ever set `true`).
    return { ...identity, outcome: "forced", writes: true, reason: conflictReason, canOverwrite: false, retires: null };
  }
  return { ...identity, outcome: "conflict", writes: false, reason: conflictReason, canOverwrite: true, retires: null };
}

/** Uses the handler's seed only when the shared lookup has no answer. @complexity O(1) plus reads. */
async function entitySeedHash<P>({ entity, handler, deps }: {
  entity: PackedEntity; handler: PublishContentHandler; deps: PlanImportDeps<P>;
}, _options = {}): Promise<string | null> {
  return (await deps.getSeedHash?.({ entityType: entity.entityType, entityId: entity.id })) ??
    (await handler.seedHash?.({ id: entity.id })) ?? null;
}

/**
 * `publish-repoint-menus-plan-2026-09-24.md` §2.2 — the planner's post-pass. Collects every row's
 * {@link PublishContentOutcomeRow.retires} target id, asks each registered handler that has a
 * {@link PublishContentHandler.referencesTo} for the live entities that still link to any of them
 * (one call per handler, never per row — `ids` carries every retire target across the whole report
 * at once), and attaches the survivors back onto their row's `referencedBy`. Returns `rows`
 * unchanged — the exact same array reference — whenever there is nothing to attach, so the ordinary
 * run (no retires at all) pays zero extra handler calls.
 *
 * A returned holder is dropped when ITS OWN row in this same report already writes: the bundle also
 * republishes that referencing entity this run, so its incoming tree already carries the new id and
 * repointing it live would fight the source's own intent (plan §2.5's "written this run" row).
 *
 * @complexity O(h) handler calls (h = handlers with `referencesTo`, one call each) plus O(r) to
 * index `rows` by key and O(k) to redistribute the returned holders (k = holders returned) — never
 * one read per row.
 */
async function attachReferencedBy(
  rows: readonly PublishContentOutcomeRow[],
  handlerByType: ReadonlyMap<string, PublishContentHandler>
): Promise<readonly PublishContentOutcomeRow[]> {
  const ids = [...new Set(rows.flatMap((row) => row.retires === null ? [] : [row.retires.entityId]))];
  if (ids.length === 0) return rows;

  const holders: ReferenceHolder[] = [];
  for (const handler of handlerByType.values()) {
    if (!handler.referencesTo) continue;
    holders.push(...(await handler.referencesTo({ ids })));
  }
  if (holders.length === 0) return rows;

  // A holder whose OWN referencing entity is itself written this run is dropped — plan §2.5: the
  // incoming tree already targets the new id, so repointing the live copy would be redundant (and,
  // for a row later overwritten by this same run, actively wrong).
  const rowByKey = new Map(rows.map((row) => [entityKey({ entityType: row.entityType, entityId: row.entityId }), row] as const));
  const holdersByReferencedId = new Map<string, ReferenceHolder[]>();
  for (const holder of holders) {
    const ownRow = rowByKey.get(entityKey({ entityType: holder.entityType, entityId: holder.entityId }));
    if (ownRow?.writes) continue;
    const list = holdersByReferencedId.get(holder.referencedId) ?? [];
    list.push(holder);
    holdersByReferencedId.set(holder.referencedId, list);
  }
  if (holdersByReferencedId.size === 0) return rows;

  return rows.map((row) => {
    if (row.retires === null) return row;
    const referencedBy = holdersByReferencedId.get(row.retires.entityId);
    return referencedBy && referencedBy.length > 0 ? { ...row, referencedBy } : row;
  });
}

/**
 * Plans an import: for every entity in `bundle`, decides one of the seven outcomes (this file's
 * header) with ZERO writes. See this file's header for the two-pass structure and the whole-run
 * refusal semantics.
 *
 * @complexity O(n) handler resolution/reads in `bundle.entities.length` (two passes, each one
 * read-shaped call per entity) plus O(t²) for `buildPublishContentCatalog` over the small
 * number of distinct types `t` — dominated by whatever I/O `getBaseline`/`hasBlob`/`inspect`/
 * `precheck` themselves cost, not by this function's own control flow.
 */
export async function planImport<P>({ bundle, deps }: { bundle: PublishContentBundle; deps: PlanImportDeps<P> }, _optional = {}): Promise<PublishContentReport> {
  if (bundle.artifactFormatVersion !== PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION) {
    return {
      refused: true,
      refusalReason:
        `bundle artifact format version ${bundle.artifactFormatVersion} does not match this instance's ` +
        `${PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION} — use an exporter/importer pair with a supported format`,
      applyOrder: [],
      rows: [],
    };
  }

  if (bundle.hashVersion !== CONTENT_HASH_VERSION) {
    return {
      refused: true,
      refusalReason: `bundle content-hash version ${bundle.hashVersion} does not match this instance's ${CONTENT_HASH_VERSION} — ` +
        (bundle.hashVersion < CONTENT_HASH_VERSION
          ? "upgrade the exporting instance and re-export before syncing"
          : "upgrade this importing instance before syncing"),
      applyOrder: [],
      rows: [],
    };
  }

  // Rule 2 (this file's header): read and validate the registry FRESH, inside this call, every call.
  const catalog = deps.catalog.build(deps.publishContentDeps);
  const { handlerByType } = catalog;

  const schemaRefusal = checkBundleSchemas({ bundle, handlerByType });
  if (schemaRefusal) return schemaRefusal;

  const baselineByKey = await prefetchBaselines({ bundle, deps });

  // Pass 2 — classify every entity, walking types in dependsOn-derived apply order. Types present in
  // the bundle with no registered handler are appended after, in first-seen order (plan §3 rule 4
  // only orders types that declare dependsOn; an unhandled type has none to sort by, and is always
  // `blocked` regardless of where it sits).
  const entitiesByType = groupBundleEntities({ bundle });
  const unhandledTypes = [...entitiesByType.keys()].filter((type) => !handlerByType.has(type));
  const applyOrder = [...catalog.applyOrder, ...unhandledTypes];

  // publish-overwrite-live-plan §4/S2 — every entity's own key, built once, so `planEntity` can tell
  // "the row a slug clash would retire" apart from "an entity this very bundle is also publishing"
  // without re-walking `bundle.entities` per blocked row.
  const bundleKeys = new Set(bundle.entities.map((entity) => entityKey({ entityType: entity.entityType, entityId: entity.id })));

  const rows: PublishContentOutcomeRow[] = [];
  for (const type of applyOrder) {
    const handler = handlerByType.get(type);
    for (const entity of entitiesByType.get(type) ?? []) {
      const baseline = baselineByKey.get(entityKey({ entityType: entity.entityType, entityId: entity.id })) ?? null;
      rows.push(await planEntity({ entity, handler, baseline, deps, bundleKeys }));
    }
  }

  // publish-repoint-menus-plan §2.2 — attach any live references to a row's retire target, so the
  // confirm dialog can show what still points at a holder before an operator chooses to overwrite it.
  const rowsWithReferences = await attachReferencedBy(rows, handlerByType);

  return { refused: false, refusalReason: null, applyOrder, rows: rowsWithReferences };
}

/** Refuses incompatible entity DTOs before any baseline reads. @complexity O(n) in entity count. */
function checkBundleSchemas({ bundle, handlerByType }: {
  bundle: PublishContentBundle; handlerByType: ReadonlyMap<string, PublishContentHandler>;
}, _options = {}): PublishContentReport | null {
  // Entity DTO compatibility is also exact. Refuse before baseline/blob/destination reads so an
  // operator never receives a partially credible plan for a bundle this importer cannot decode.
  for (const entity of bundle.entities) {
    const handler = handlerByType.get(entity.entityType);
    if (handler && entity.schemaVersion !== handler.schemaVersion) {
      return {
        refused: true,
        refusalReason:
          `${entity.entityType} '${entity.id}' uses schema version ${entity.schemaVersion}, but this ` +
          `instance supports version ${handler.schemaVersion} for that type`,
        applyOrder: [],
        rows: [],
      };
    }
  }

  return null;
}

/** Reads current-generation baselines; obsolete hashes are unknown history. @complexity O(n) reads. */
async function prefetchBaselines<P>({ bundle, deps }: { bundle: PublishContentBundle; deps: PlanImportDeps<P> }, _options = {}): Promise<Map<string, BaselineRecord | null>> {
  // A hash upgrade invalidates history, not current content. Reuse the no-baseline safety rules.
  const baselineByKey = new Map<string, BaselineRecord | null>();
  for (const entity of bundle.entities) {
    const baseline = await deps.getBaseline({ entityType: entity.entityType, entityId: entity.id });
    baselineByKey.set(entityKey({ entityType: entity.entityType, entityId: entity.id }), baseline?.hashVersion === CONTENT_HASH_VERSION ? baseline : null);
  }

  return baselineByKey;
}

/** Groups entities in bundle order for dependency-ordered classification. @complexity O(n) time/space. */
function groupBundleEntities({ bundle }: { bundle: PublishContentBundle }, _options = {}): Map<string, PackedEntity[]> {
  const entitiesByType = new Map<string, PackedEntity[]>();
  for (const entity of bundle.entities) {
    const list = entitiesByType.get(entity.entityType) ?? [];
    list.push(entity);
    entitiesByType.set(entity.entityType, list);
  }
  return entitiesByType;
}
