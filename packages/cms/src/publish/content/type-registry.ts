import type { Clock as ClockPort } from "@jini-ai/core/primitives";
import type { AuthorizeFn, ChangeSetRepoPort, OutboxPort } from "@jini-ai/core/contracts/events";
import type { BackstopPorts } from "../transfer/backstop-ports.js";
import type { PackedEntity } from "../transfer/packed-entity.js";
/**
 * @file The publishable-type registry: the seam a resource-owning feature (`post`/`page` first;
 * later `media`, `forms`, taxonomy `term`s, …) contributes ITS OWN "how do I
 * pack/inspect/precheck/apply myself" implementation into, so the publish-content planner can stay
 * one generic pipeline over a growing set of resources instead of one bespoke branch per resource.
 *
 * ## The trap this file exists to avoid
 *
 * A host codebase tends to grow TWO registry shapes, and only one of them is safe here:
 *  - Append-only + read-once-at-startup (a tool registry, a routing phase registry). A filter or
 *    consumer that reads the list once, at module load or at boot, never sees anything registered
 *    afterward — two real bugs came from exactly this shape.
 *  - Register-by-key, replace-on-duplicate, listed FRESH at every consumption (a tool-contribution
 *    registry, a duplicate-resource registry). This registry is modeled directly on the latter —
 *    same ordered array, same `register`/`list`/`reset` trio, same "last registration wins,
 *    replacing by key rather than appending" semantics for accidental double-registration.
 *
 * `buildCatalog()` MUST read the registry fresh every run, never capture a prior catalog — a type
 * registered after that first read must still be picked up on the next run. The registry mechanics
 * test file (`__tests__/type-registry.test.ts`) pins this property.
 *
 * ## Why the publish-content module owns this file, not an assistant/tool module
 *
 * Unlike a tool-contribution registry (AI-tool surface, naturally owned by the assistant), this
 * registry has nothing to do with any assistant's tool catalog — it exists purely for the Publish
 * Content feature. It lives in its own module rather than inside `post` or any other single
 * resource's module, for the same reason a duplicate-resource registry lives in a shared location
 * rather than inside whichever resource happened to need it first: it is a cross-resource seam, not
 * one resource's private concern.
 *
 * ## Registration discipline (five rules)
 *
 * 1. Registration happens at a COMPOSITION ROOT only — an `install*` function that calls the bound
 *    registry's `register` for every known type, called once during boot. A feature (e.g. `post`)
 *    returns DATA (`contributePostPublish(): PublishContentContributor`) and imports only this
 *    module's TYPES; it never imports the registry instance itself. That split is load-bearing, not
 *    style: `post -> assistant` VALUE edges have previously closed real module cycles and had to be
 *    removed by injecting the dependency instead — a `post -> publish-content` value edge would
 *    reopen the identical risk. A host boundary test should enforce this for each resource feature.
 * 2. `buildCatalog()` reads contributors AT PUBLISH TIME, never at module load — see the trap above.
 * 3. Never "register on import". Nothing in this file, or in any feature's own
 *    `contribute<Type>Transport()` function, runs merely because that feature's module was imported.
 *    Every registration is an explicit call made by a composition root.
 * 4. Apply order is derived from each handler's own `dependsOn` at publish time (a topological sort),
 *    never hardcoded into the planner. Adding "media before post" is then a property of the media
 *    contributor's own `dependsOn`, not an edit to shared planning code.
 * 5. A type absent from the registry is absent from the bundle and from the report — silence is
 *    never "nothing changed" (the export route is built as an ALLOWLIST of registered types for
 *    exactly this reason).
 *
 * See `README.md` § Wiring for what the host binds.
 */
/**
 * A wide deps bag assembled from every registered type's OWN deps needs via type-only imports, so
 * this registry module itself never has to know what any particular resource needs to build its
 * handler.
 *
 * Generic over the host's port bag: the engine never reads a field of `ports`, it only hands the
 * bag to the handler each registered type builds. There is deliberately NO default — every host
 * names its own bag (the host binding instantiates these types once with it).
 */
export interface PublishContentDeps<TPorts> {
  /** Only explicit selection packs raw items; ordinary exports always yield none. */
  readonly backstop?: BackstopPorts;
  /** Every publish-content operation is scoped to one workspace (the workspace-scoped admin mount
   *  path convention) — carried here rather than threaded as a per-call parameter, the same choice
   *  every other workspace-scoped deps bag makes. */
  readonly workspaceId: string;
  readonly clock: ClockPort;
  readonly idGen: { newId(): string };
  /** Optional — absent behaves exactly like a create-post `outbox` absent: no status-transition
   *  event fires. (The plugin before-save hook is not an engine dependency: it travels in the
   *  host's bag as `ports.hooks.beforeSave`.) */
  readonly outbox?: OutboxPort;
  /**
   * Added when `apply()` got a real implementation. Every `pack`/`inspect`/`precheck` caller (the
   * export route, the planner, gated hooks) never reads these, so they stay OPTIONAL rather than
   * widening every existing deps builder into supplying values it has no use for. Only a real
   * `PublishContentApplyPort` (the apply loop) supplies them, because only `apply()` (never
   * `pack`/`inspect`/`precheck`) needs to route a write through the command gateway. A handler whose
   * `apply()` is reached without these wired throws loudly rather than silently skipping the
   * gateway — see the post contributor's own guard.
   */
  readonly changeSets?: ChangeSetRepoPort;
  readonly authorize?: AuthorizeFn;
  /** Every registered type's own ports, keyed by `entityType`. A single host-owned bag replaced a
   *  dozen individually-optional flat fields. */
  readonly ports: Partial<TPorts>;
}


/**
 * The live row a slug-clash overwrite would retire, named so the confirm dialog can say what it is
 * about to move to Trash — `publish-overwrite-live-plan-2026-09-24.md` §4. Produced by
 * {@link PublishContentHandler.planRetire} (read-only) and threaded back into
 * {@link PublishContentHandler.retire} unchanged, and into the planner's own `retires` row field
 * (the planner) so `planHash` binds the exact holder and hash a re-plan must still match at apply
 * time (§5 S5's re-verification).
 *
 * Defined here rather than in the planner module: this interface (`PublishContentHandler`) is the type
 * that actually names it on `planRetire`/`retire`, and the planner module already imports its other types
 * from this module — a `RetireTarget` re-exported from the planner module instead would invert that.
 */
export interface RetireTarget {
  readonly entityType: string;
  readonly entityId: string;
  readonly entityLabel: string | null;
  readonly hash: string;
}

/**
 * `publish-repoint-menus-plan-2026-09-24.md` §2.1 — a live entity that links to another entity by
 * id, e.g. a menu item whose `entryRef.entryId` targets a page. Produced by
 * {@link PublishContentHandler.referencesTo}, read by the planner's post-pass (the planner) and
 * attached to the referenced row's {@link RetireTarget}-bearing outcome row as `referencedBy`, so an
 * operator sees what still points at a holder before choosing to overwrite it.
 */
export interface ReferenceHolder {
  readonly entityType: string;
  readonly entityId: string;
  readonly entityLabel: string | null;
  /** The id this holder links to — matches a {@link RetireTarget.entityId} the planner asked about. */
  readonly referencedId: string;
}

/**
 * §2.1 — one entity replaced during an apply run: the retired holder's id and the id the incoming
 * entity landed under. Collected by the apply loop (S5) from rows whose retire
 * both landed, and handed to {@link PublishContentHandler.repointReferences} so a live reference can
 * be rewritten from the old id to the new one.
 */
export interface EntityReplacement {
  readonly entityType: string;
  readonly oldId: string;
  readonly newId: string;
}

/**
 * §2.1 — the result of one handler's {@link PublishContentHandler.repointReferences} call.
 */
export interface RepointResult {
  readonly changeSetIds: readonly string[];
  readonly linksUpdated: number;
  /** Operator-facing lines, one per holder not updated (an authorization refusal, a concurrent edit,
   *  or any other reason a specific holder was skipped) — a repoint failure is always reported here,
   *  never silent and never thrown back to fail the surrounding run (§2.3). */
  readonly notUpdated: readonly string[];
}

/** Destination source/version reviewed by the operator, carried only by a verified report row. */
export interface MediaSourceReplacement {
  readonly version: number;
  readonly sourceSha256: string;
}

/** Only this structured refusal can offer a same-identity source replacement. Strings stay hard blocks. */
export interface OverwritablePrecheckRefusal {
  readonly reason: string;
  readonly sourceReplacement: MediaSourceReplacement;
}

/**
 * One content type's contract for participating in Publish Content — plan §3's own interface,
 * carried here verbatim. See plan §4 task table for which of `pack`/`inspect`/`precheck`/`apply`
 * each later task actually exercises; Task 2 (this file plus `contributePostPublish`/
 * `contributePagePublish`) only has to satisfy this shape correctly, not wire it into a real HTTP
 * pipeline — that is Task 4 (export), Task 5 (planner), and Task 7/8 (apply loop through the gated
 * mutation gateway).
 */
export interface PublishContentHandler {
  /** A new manual send after an undo must not reuse the original send's command key. */
  readonly idempotencyScope?: "run";
  /** Stable wire discriminator. Appears in bundles and in baselines; never renamed — a rename would
   *  silently orphan every baseline row keyed on the old string, turning every future sync for that
   *  type into a false `created` (no matching baseline) rather than the update it should be. */
  readonly entityType: string;
  /** Exact serialized-state version this handler packs and applies. */
  readonly schemaVersion: number;
  /** The resource's OWN existing write permission (e.g. `"content.write"` for post/page), never a
   *  flat transport-wide permission — this is what makes "a principal allowed posts but not media
   *  must be refused media by construction" true, the identical reasoning
   *  `DuplicateResourceHandler.permission` already establishes for `content_duplicate`. */
  readonly permission: string;
  /** Every OTHER permission this type's writes (`apply`/`retire`/`repointReferences`) ask
   *  `authorize` for, e.g. a widget create asking `widgets.create` while {@link permission} is
   *  `widgets.update`. A publishing grant answers only {@link publishTypePermissions} for a type, so
   *  an undeclared one is denied there (RBAC is unaffected). the host's publish-trust apply-coverage test
   *  fails when a type asks for one it did not declare. */
  readonly alsoAuthorizes?: readonly string[];
  /** Types that must be applied BEFORE this one, by `entityType` (e.g. `post` depending on
   *  `["media", "term"]`) — the planner topologically sorts on this at publish time (rule 4 above),
   *  so adding a new type's ordering constraint never touches the planner itself. */
  readonly dependsOn: readonly string[];

  /** Export side: every transportable entity of this type, already canonicalized + hashed. An
   *  async generator (not an eagerly-built array) so a large collection can be streamed rather than
   *  held in memory whole — Task 4's export route streams its response body from this directly. */
  pack(): AsyncIterable<PackedEntity>;
  /** Import side: what the destination currently holds for `id`, or `null` when there is no such
   *  row — the planner's `created` vs `unchanged`/`applied`/`conflict` classification (plan §4's
   *  "seven outcomes" table) starts here. */
  inspect(required: { id: string }, optional?: Record<string, never>): Promise<{ version: number; hash: string } | null>;
  /** Import side: a PURE precondition check that never writes — slug availability, a
   *  format/shape violation, a required blob's absence. Returns a human-readable blocking reason, or
   *  `null` when there is no blocking condition. A structured source refusal can be overwritten
   *  only after review of its destination source/version. Must never be skipped in favor of "just try the
   *  write and catch the constraint violation" — plan §5 risk #4 is specifically that a caught
   *  constraint violation kills the whole surrounding chunk transaction (Task 8), not just the one
   *  offending entity. */
  precheck(required: { entity: PackedEntity }, optional?: Record<string, never>): Promise<string | OverwritablePrecheckRefusal | null>;
  /** Import side: applies ONE entity through the real domain write function, inside the caller's own
   *  `executeCommand` (plan §1.4) — never through the raw repo. Receives `expectedVersion` (`undefined`
   *  for a brand-new entity with no destination row yet) and MUST fail rather than overwrite when the
   *  destination has moved on from it; this is what Task 8's per-write optimistic-concurrency guard
   *  (plan §5 risk #3) depends on. */
  apply(input: {
    entity: PackedEntity;
    expectedVersion: number | undefined;
    principalId: string;
    /** Stable for this source principal + exact entity schema/hash version; safe to reuse on retry. */
    idempotencyKey: string;
    /** Trusted apply-loop context, never read from PackedEntity.state. */
    sourceReplacement?: MediaSourceReplacement;
  }, optional?: {}): Promise<{ changeSetId: string }>;

  /**
   * S4 (`publish-overwrite-live-plan-2026-09-24.md` §4/§5) — read-only, like {@link precheck}: reports
   * the live row a slug-clash overwrite would retire, or `null` when this entity has no such holder
   * (its own id already exists at the destination, the slug is free, or the slug cannot be moved —
   * e.g. the home page). Never writes. Only meaningful for a `blocked` `precheck()` result; the
   * planner (the planner) is what decides when to call it.
   */
  planRetire?(required: { entity: PackedEntity }, optional?: Record<string, never>): Promise<RetireTarget | null>;
  /**
   * S4 — the write side of an address-clash overwrite: moves `target` to Trash under a renamed slug
   * (never in place) so the incoming entity can take the address under its own id, through the same
   * `executeCommand` gateway {@link apply} uses. `undo()` is the compensating rollback for the SAME
   * failure window {@link CommandMutation.rollback} exists for (a change-set insert failing after this
   * write already landed) — the apply loop (S5) also calls it directly when the
   * CREATE that follows a retire fails, so the retire is never left stranded without its holder.
   */
  retire?(input: {
    target: RetireTarget;
    principalId: string;
    idempotencyKey: string;
  }, optional?: {}): Promise<{ changeSetId: string; undo(): Promise<void> }>;

  /**
   * `publish-repoint-menus-plan-2026-09-24.md` §2.1/§2.2 — read-only, like {@link planRetire}: every
   * live entity of THIS type that links to any of `ids` by id (e.g. a menu whose nested `entryRef`
   * targets one of them). Called by the planner (the planner) at most ONCE per handler per plan,
   * with every retire-target id collected across the whole report — never once per row. A handler
   * with no concept of "links to another entity by id" simply omits this method.
   */
  referencesTo?(required: { ids: readonly string[] }, optional?: Record<string, never>): Promise<readonly ReferenceHolder[]>;
  /**
   * §2.3 — the write side: for each of `replacements`, repoints every live link `oldId -> newId` in
   * entities of this type, skipping any holder named in `skipIds` (written this run, so its own
   * incoming content already stands — repointing it would fight the source's own intent). Called by
   * the apply loop (S5) once, AFTER every row has already landed — never inside a
   * row's own `apply()`/`retire()`. A repoint failure must never fail the surrounding run (the
   * content already landed); it is reported via {@link RepointResult.notUpdated} instead.
   */
  repointReferences?(input: {
    replacements: readonly EntityReplacement[];
    skipIds: ReadonlySet<string>;
    principalId: string;
    runId: string;
  }, optional?: {}): Promise<RepointResult>;
  /**
   * Post-publish safety check (2026-09-26): after every row has landed, confirms this type's
   * entities from the run are actually servable here — e.g. a media item's bytes are present and its
   * content type is recorded, so an embed renders the right element. `entities` are the run's
   * entities of this type whose row did not end `blocked`/`conflict` (those are reported already),
   * including `unchanged` ones, so a check can repair state an older build left behind. Returns
   * operator-facing lines, one per problem; empty when all is well. Called by the apply loop once,
   * after the repoint pass; a throw is caught and reported, never fails the run (the content landed).
   */
  verifyApplied?(input: { entities: readonly PackedEntity[] }, optional?: {}): Promise<readonly string[]>;

  /**
   * S-F4 (`publish-files-plan-2026-09-24.md` §4) — the hash `id` had when this destination was first
   * seeded, or `null` when it was not part of the seed. The planner (the planner) and the apply
   * loop's re-verification  consult it only when there is no recorded baseline AND
   * `PlanImportDeps.getSeedHash` did not answer — a destination still equal to its seed was never
   * edited there, so the first publish may replace it instead of sitting in `conflict`. For a type
   * whose seed is not a DB row (e.g. `theme-files`, seeded as `__original-themes__` folders), which
   * the generic seed-db lookup cannot see. Read-only; absent means "no seed to compare against".
   */
  seedHash?(required: { id: string }, optional?: Record<string, never>): Promise<string | null>;

  /**
   * `publish-files-plan-2026-09-24.md` §2/§6 — export side, read-only: every WHOLE unit this handler
   * found on disk but could not pack (a file-tree policy refusal — an extension the tree's kind
   * does not allow, a planted secret, an oversize cap), so an operator can see WHY it is missing from
   * the publish table instead of it silently not appearing at all (this feature's own real bug: a
   * theme with a video file, or one with a stray `.DS_Store` before that was fixed to be ignored
   * instead of denied, vanished from the table with no explanation). `pack()`'s own `AsyncIterable`
   * has no channel for this (see the theme contributor's own header) — this is the separate
   * seam a caller building an export envelope (the export-bundle builder) reads instead. A handler backed by
   * nothing that can be whole-unit-refused (most content types) simply omits this method.
   */
  listSkipped?(): Promise<readonly SkippedPackEntity[]>;

  /**
   * Plan G3 — export side, pure: the other publishable entities this packed one uses (a page's
   * images and embedded widgets, a widget's form or menu, an entry's collection, a term's taxonomy).
   * A scoped publish carries them along (the export-bundle builder's `includeReferencedEntities`), following
   * the carried ones' own references in turn. Unlike `dependsOn`, a reference implies no apply order
   * and the destination need not validate it. A type that uses nothing omits this method.
   */
  references?(required: { entity: PackedEntity }, optional?: Record<string, never>): readonly PublishContentReference[];

  /**
   * True for one of this type's OWN errors that means "this row changed on the destination during
   * apply": the apply loop downgrades the row to `conflict` (reason prefixed "changed on the
   * destination during apply") instead of aborting the run. Only for errors that predate
   * `PublishContentApplyRowError` (`post`/`page`'s `PostConflictError`/`PostNotFoundError`); a new
   * type raises that class instead and omits this. Lets the generic loop stay free of any one
   * type's error classes.
   */
  isApplyConflict?(error: unknown): error is Error;
}

/** One entity a {@link PublishContentHandler.references} names: its type, and a key it answers to —
 *  its packed `id`, or its `state.slug` (a page's html may embed a widget or an image by slug). */
export interface PublishContentReference {
  readonly entityType: string;
  readonly key: string;
}

/**
 * One whole unit a {@link PublishContentHandler.listSkipped} found but refused to pack — the shape an
 * export envelope surfaces to an operator as a non-selectable, reason-carrying row, matching
 * the planner's `PublishContentOutcomeRow` (`outcome: "blocked"`) closely enough that
 * the planner and the report-label module can turn one into the other with no lossy mapping.
 */
export interface SkippedPackEntity {
  readonly entityType: string;
  readonly id: string;
  /** What a human calls this unit, or `null` when it has nothing more readable than `id` — same
   *  fallback contract as the planner's `entityDisplayLabel`. */
  readonly label: string | null;
  /** Human-readable reason, already prefixed with the unit's own title (matching every other
   *  `SkippedThemeTree.reason` this feature already produces) — never re-derived or re-worded by a
   *  caller. */
  readonly reason: string;
}

/**
 * One resource's registry entry: which content type it answers to, its declared `dependsOn`
 * ordering, and how to build its real, deps-bound {@link PublishContentHandler} once the
 * composition root's real {@link PublishContentDeps} bag exists.
 *
 * `build` is deferred (not a bound handler) for the identical reason `ToolContributor.build` and
 * `DuplicateResourceHandlerContributor.build` are: registration (this registry) happens once at
 * boot, before any real deps bag exists; something later (Task 4's export route, Task 5's planner)
 * resolves every registered contributor into a real handler by calling `build(deps)` against the
 * deps it actually has for that request.
 *
 * `dependsOn` is carried on the CONTRIBUTOR (not only on the built {@link PublishContentHandler})
 * so the planner can compute apply order (rule 4 above) without having to `build()` every
 * contributor first just to read a static ordering fact.
 */
export interface PublishContentContributor<TPorts> {
  /** Full-table/root coverage prevents raw imports from bypassing typed validation. */
  readonly coversTables?: readonly string[];
  readonly coversRoots?: readonly string[];
  readonly entityType: string;
  readonly dependsOn: readonly string[];
  readonly build: (deps: PublishContentDeps<TPorts>, optional?: {}) => PublishContentHandler;
}

/** A programmer-authored registry configuration that cannot produce a safe apply order. */
export class PublishContentCatalogConfigurationError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "PublishContentCatalogConfigurationError";
  }
}

export interface PublishContentCatalog {
  readonly handlers: readonly PublishContentHandler[];
  readonly handlerByType: ReadonlyMap<string, PublishContentHandler>;
  readonly applyOrder: readonly string[];
}

type CatalogEdge = Pick<PublishContentContributor<unknown>, "entityType" | "dependsOn">;

/** Validates declared edges before any handler is built, counting each dependency once. */
function catalogDependencies(
  { snapshot, originalOrder }: { snapshot: readonly CatalogEdge[]; originalOrder: readonly string[] },
  _options: Record<string, never> = {}
) {
  const known = new Set(originalOrder);
  // Seeded with every registered type, so a lookup by a registered type (each contributor's own
  // `entityType`, every dependent, every `originalOrder` entry) always finds a count; the
  // checked reads below enforce that invariant instead of using a fallback that could never be taken.
  const inDegree = new Map<string, number>(originalOrder.map((entityType) => [entityType, 0]));
  const dependents = new Map<string, string[]>();

  for (const contributor of snapshot) {
    for (const dependency of new Set(contributor.dependsOn)) {
      if (!known.has(dependency)) {
        throw new PublishContentCatalogConfigurationError({ message: `publish-content type '${contributor.entityType}' depends on unregistered type '${dependency}'` });
      }
      const count = inDegree.get(contributor.entityType);
      if (count === undefined) throw new PublishContentCatalogConfigurationError({ message: `publish-content type '${contributor.entityType}' has no dependency count` });
      inDegree.set(contributor.entityType, count + 1);
      const waiting = dependents.get(dependency) ?? [];
      waiting.push(contributor.entityType);
      dependents.set(dependency, waiting);
    }
  }

  return { inDegree, dependents };
}

/**
 * Derives the apply order from the snapshot's declared edges (Kahn's algorithm over registration
 * order, so ready types keep their registration order).
 *
 * Ordering declarations are configuration, not best-effort hints. A dependency on an
 * unregistered type or a dependency cycle makes every possible fallback order unsafe, so this
 * rejects before any handler is built or any publish-content read/write begins.
 */
function catalogApplyOrder({ snapshot }: { snapshot: readonly CatalogEdge[] }, _optional = {}): string[] {
  const originalOrder = snapshot.map((contributor) => contributor.entityType);
  const { inDegree, dependents } = catalogDependencies({ snapshot, originalOrder });

  const applyOrder: string[] = [];
  const remaining = new Set(originalOrder);
  while (remaining.size > 0) {
    const next = originalOrder.find(
      (entityType) => remaining.has(entityType) && inDegree.get(entityType) === 0
    );
    if (!next) {
      const cycleMembers = originalOrder.filter((entityType) => remaining.has(entityType));
      throw new PublishContentCatalogConfigurationError({ message: `publish-content dependency cycle among registered types: ${cycleMembers.join(", ")}` });
    }
    applyOrder.push(next);
    remaining.delete(next);
    for (const dependent of dependents.get(next) ?? []) {
      const count = inDegree.get(dependent);
      if (count === undefined) throw new PublishContentCatalogConfigurationError({ message: `publish-content type '${dependent}' has no dependency count` });
      inDegree.set(dependent, count - 1);
    }
  }
  return applyOrder;
}

/** What {@link stampPublishType} adds to every `authorize` call a handler makes. */
export interface PublishTypeStamp {
  /** The publish type whose handler is writing — set by the registry, never by domain code. */
  readonly publishType?: string;
}

/**
 * Each handler's `authorize` names ITS publish type on every call, whatever domain service makes it.
 *
 * A domain write asks `authorize` with its own entity type (`form_definition`, `presentation`,
 * `setting-value`, or none), which need not match the publish-type name. A publishing grant is
 * keyed by publish type, so it reads this stamp instead (the host's publish-trust content
 * authorizer). The stamp spreads LAST, so a caller cannot set it. RBAC ignores the extra field.
 *
 * @complexity O(1) — one object spread per call.
 */
function stampPublishType<TPorts>({ deps, publishType }: { deps: PublishContentDeps<TPorts>; publishType: string }, _optional = {}): PublishContentDeps<TPorts> {
  const { authorize } = deps;
  if (!authorize) return deps;
  const stamped: AuthorizeFn = (params) => authorize({ ...params, publishType } as Parameters<AuthorizeFn>[0]);
  return { ...deps, authorize: stamped };
}

/** Every permission a publishing grant may answer for `handler`'s writes: its own
 *  {@link PublishContentHandler.permission} plus {@link PublishContentHandler.alsoAuthorizes}. */
export function publishTypePermissions({ handler }: { handler: PublishContentHandler }, _optional = {}): readonly string[] {
  return [handler.permission, ...(handler.alsoAuthorizes ?? [])];
}

/** One registry instance, bound by the host to its own port bag. */
export interface PublishContentTypeRegistry<TPorts> {
  /**
   * Registers one content type's contribution, called once by a composition root during the
   * ordinary boot sequence (this file's header, rule 1).
   *
   * Re-registering the same `entityType` REPLACES the earlier entry rather than appending —
   * idempotent per registry instance, safe for a test process that legitimately re-registers.
   * Registration order is otherwise preserved so a replacement does not silently reorder the
   * registry.
   */
  register(required: { contributor: PublishContentContributor<TPorts> }, optional?: {}): void;
  /** Every contributor registered so far, in registration order. Reads the CURRENT state on every
   *  call (rule 2 / the trap this whole file exists to avoid) — never memoized, never snapshotted. */
  list(): readonly PublishContentContributor<TPorts>[];
  /** Test-only reset. A test that builds a registry from a clean slate must call this before
   *  registering just the contributors it wants present — otherwise contributors registered by an
   *  earlier test in the same process persist on a host's long-lived instance. */
  reset(): void;
  /** Builds the per-operation handler catalog from the registry's CURRENT snapshot; rejects an
   *  unsafe ordering before any handler is built (see {@link catalogApplyOrder}). */
  buildCatalog(deps: PublishContentDeps<TPorts>, optional?: {}): PublishContentCatalog;
  /**
   * Publish type -> {@link publishTypePermissions} for every registered type, read fresh (rule 2).
   * What a host's publish-trust content authorizer answers a publishing grant from.
   *
   * Keyed by PUBLISH TYPE, which is unique per contributor — never by permission, which is not.
   * `post`, `page` and `media` all declare `content.write`, so a permission-keyed map collapsed to a
   * single `content.write -> media` entry and a post-only grant was denied its own writes.
   *
   * @complexity O(types) handler builds, each cheap (no I/O).
   */
  permissionsByType(deps: PublishContentDeps<TPorts>, optional?: {}): ReadonlyMap<string, readonly string[]>;
}

/**
 * Creates one register-by-key, fresh-read registry. Generic over the host's port bag with no
 * default: the host creates exactly one instance at module scope in its binding and hands that
 * instance's functions to its composition roots.
 */
export function createPublishContentTypeRegistry<TPorts>(_optional: Record<string, never> = {}): PublishContentTypeRegistry<TPorts> {
  let contributors: PublishContentContributor<TPorts>[] = [];
  return {
    register({ contributor }) {
      const existing = contributors.findIndex((candidate) => candidate.entityType === contributor.entityType);
      if (existing >= 0) {
        contributors[existing] = contributor;
        return;
      }
      contributors.push(contributor);
    },
    list: () => contributors,
    reset() {
      contributors = [];
    },
    buildCatalog(deps) {
      const snapshot = [...contributors];
      const applyOrder = catalogApplyOrder({ snapshot });
      const handlers = snapshot.map((contributor) => contributor.build(stampPublishType({ deps, publishType: contributor.entityType })));
      return {
        handlers,
        handlerByType: new Map(handlers.map((handler) => [handler.entityType, handler] as const)),
        applyOrder,
      };
    },
    permissionsByType: (deps) =>
      new Map(contributors.map((contributor) => [contributor.entityType, publishTypePermissions({ handler: contributor.build(deps) })] as const)),
  };
}
