import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { MutationActor } from "@jini-ai/core/contracts/events";
import { checkedMutationActor } from "../../core/mutation-actor.js";
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort } from "@jini-ai/core/primitives";
import { computeBlobStorageKey } from "../../media/blob-key.js";

import type { GatedMutationHooks } from "@jini-ai/core/gated-mutations";
import { loadActiveBundle } from "../transfer/bundle-staging.js";
import type { PublishContentBundleRepoPort } from "../transfer/bundle-staging.js";
import type { PublishContentBaselineRepoPort } from "./baseline-repo.js";
import { planImport } from "./planner.js";
import type { PublishContentSeedHashFn } from "./seed-hash.js";
import type { PlanImportDeps } from "./planner.js";
import type { PublishContentBundle, PublishContentReport } from "./plan-rows.js";
import type { PublishContentDeps } from "./type-registry.js";
import type { PackedEntity } from "../transfer/packed-entity.js";

/**
 * @file Task 7 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §1.5/§4 task 7.
 *
 * `buildPublishContentImportHooks` is publish-content's `GatedMutationHooks` factory for the
 * import ceremony (`domain: "publish_content.import"`) — the same shape as
 * `features/taxonomy/gated-hooks.ts`'s `buildMergeTermHooks` (a workspace-scoped ceremony; no
 * `scopeKind` override, unlike the two instance-scoped ceremonies in `features/database`/
 * `features/recovery`). A route builds fresh hooks per request (closing over that request's
 * `bundleId`), exactly like `buildMergeTermHooks` closes over `fromTermId`/`intoTermId`.
 *
 * ## Why `computePlan()` needs no special-casing for `PLAN_STALE`
 *
 * `computePlan()` re-derives `PublishContentReport` from LIVE state on every call — reloading the staged
 * bundle and calling `planImport()` fresh, which itself calls every registered handler's `inspect()`
 * live (never cached). `gateway.execute()` (CIC U-001-B3) already re-runs `hooks.computePlan()` and
 * hash-compares it against the confirmed token before ever reaching `executeMutation()` — so a
 * destination row that changes between `plan()` and `execute()` changes that row's outcome (e.g.
 * `unchanged` -> `conflict`), which changes `planHashOf({ details: report })`, which `execute()` rejects as
 * `PLAN_STALE` with ZERO code in this file dedicated to detecting it. This is exactly the property
 * plan §0 #7 and §5 risk #2 call out: the built gated-mutation gateway gives this for free where a
 * bespoke `?mode=dry-run` flow would not.
 *
 * ## The seam with Task 8 — read this before touching `executeMutation`
 *
 * `executeMutation()` does exactly two things: (1) captures a restore point via
 * `DbOpsPort.captureRestorePoint` and persists it through `restorePointsRepo`, BEFORE any write this
 * run might make (plan §4 task 7's own instruction); (2) hands the report `gateway.execute()`
 * verified against the confirmed token — passed in as `verified.details`, never re-derived here
 * (sol review 2026-09-20, High finding 1) — to
 * {@link PublishContentApplyPort.applyReport}. This file owns (1) and the wiring in (2); it does
 * NOT own what happens inside `applyReport` — that is Task 8's apply loop
 * (`features/publish-content/apply-loop.ts`: per-type ordering, `executeCommand` +
 * `expectedVersion`, baseline upserts). Both composition roots require and bind that real port.
 *
 * **Task 8 addendum (2026-09-18):** the ORIGINAL seam here was too narrow to actually apply
 * anything — `applyReport({report, principalId})` alone gives a real apply port no way to reload the
 * staged bundle's packed entities or its `sourcePrincipalId` (the baseline peer key, plan §5 risk
 * #9 — never the executing operator's id). `applyReport`'s input is widened below with `bundleId`/
 * `restorePointId`, both already free in this function's own closure/locals, so a real apply port
 * can call `loadActiveBundle` itself rather than `TransportReport` growing an apply-time-only field.
 * This is the one disclosed, necessary touch to this file Task 8 makes — see
 * `apply-loop.ts`'s own header for why threading raw entities through the report instead would have
 * leaked apply-time concerns into Task 5's planner.
 *
 * ## Restore-point cost-class refusal lives OUTSIDE this file
 *
 * "`costClass: 'unavailable'` refuses, with no override" is enforced by `execute-import.ts`'s
 * `executePublishContentImport()`, which the `/execute` ROUTE calls to wrap `gatewayExecute()` —
 * mirroring `@jini-ai/db/recovery/migrate-forward-execute`'s identical split (the check happens
 * before `gateway.execute()`'s own authorize/token/plan-hash checks even run, not buried inside this
 * file's `executeMutation()`, which only runs after every one of those has already passed).
 */

/** Narrow structural slice of `DbOpsPort` this file actually calls — declared locally rather than
 *  importing the whole `contracts/core/gated-mutations/ports.ts#DbOpsPort`, the same "keep the
 *  domain's own hooks file decoupled from the full port surface" precedent
 *  `features/database/gated-hooks.ts`'s own `MigrateForwardDbOpsPort` sets. */
export interface PublishContentDbOpsPort {
  captureRestorePoint(required: { scopeId: string }, optional?: {}): Promise<{ artifactRef: string; watermarkAtCapture: number }>;
}

/** Narrow structural slice of `@jini-ai/db/tools#RestorePointSavePort` this file
 *  actually calls — declared locally for the identical decoupling reason as
 *  {@link PublishContentDbOpsPort} (and the same reason `buildMigrateForwardHooks` declares its
 *  own `restorePointsRepo` field type inline rather than importing the whole port). */
export interface PublishContentRestorePointSavePort {
  save(row: {
    restorePointId: string;
    idempotencyKey: string;
    trigger: string;
    createdAt: string;
    createdBy: string;
    artifactRef?: string;
    watermarkAtCapture?: number | null;
  }, optional?: {}): Promise<void>;
}

/** Thrown when the `bundleId` a `plan`/`execute` request names has no active staged bundle — either
 *  it was never staged for this workspace, or {@link loadActiveBundle}'s TTL check (`bundle-staging.
 *  ts`) has already expired it. Both causes are deliberately collapsed into one error, mirroring that
 *  same file's own "an unrecognized bundle and an expired bundle are indistinguishable to a caller"
 *  reasoning for `token.ts`'s `TokenExpiredError`. */
export class PublishContentBundleNotFoundError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "PublishContentBundleNotFoundError";
  }
}

/**
 * Task 8's seam: applies an already-computed, already-authorized {@link PublishContentReport}. Never
 * called by anything in this file except `executeMutation()`, and never before the restore point is
 * captured (see this file's header).
 *
 * `bundleId`/`restorePointId` (2026-09-18, this file's "Task 8 addendum" above) let a real
 * implementation (`apply-loop.ts`) reload the staged bundle itself — the report alone does not carry
 * enough to apply anything (no packed entity state, no source principal id).
 */
export interface PublishContentApplyPort {
  applyReport(input: {
    report: PublishContentReport;
    principalId: string;
    /** The trusted actor every write of this run is attributed to; its `id` is `principalId`. */
    actor: MutationActor;
    bundleId: string;
    restorePointId: string;
    /**
     * The authorization function each registered type's `apply()` must run under, when the CALLER
     * knows better than the port's own bag.
     *
     * The port is a composition-root singleton and closes over the instance-wide `authorize`, which
     * is RBAC. That is right for a human and wrong for a publishing credential: `pub:<installation>`
     * is deliberately not a row in `principals`, so RBAC answers `principal_disabled` and the whole
     * execute fails. The import route therefore hands down the per-request attenuated function that
     * answers from the grant — see `publish-trust-auth.ts`'s `withPublishTrustContentAuthorize`.
     *
     * Absent means "use the port's own", so every existing caller is unchanged.
     */
    authorize?: PublishContentDeps<unknown>["authorize"];
    backstop?: PublishContentDeps<unknown>["backstop"];
  }, optional?: {}): Promise<{
    /** Actual outcomes after apply, including race-time conflict downgrades. */
    report?: PublishContentReport;
    runId: string;
    changeSetIds: readonly string[];
    /** publish-overwrite-live-plan §4 — the change sets that retired a live address holder, one per
     *  retire-forced row that landed. Kept apart from `changeSetIds` so that list stays one per row. */
    retiredChangeSetIds: readonly string[];
    /** R5 (`plan-publish-repoint-menus-2026-09-24.md` §2.3) — the change sets a live-reference
     *  repoint pass produced, one per holder actually rewritten (e.g. one menu). Kept apart from
     *  `changeSetIds` for the identical "one list per row-shaped concern" reason
     *  {@link retiredChangeSetIds} already is. */
    repointChangeSetIds: readonly string[];
    /** Total links repointed this run across every handler — `0` when there was nothing to repoint. */
    menuLinksUpdated: number;
    /** Operator-facing lines for a holder a repoint pass could not update (a denied grant, a
     *  concurrent edit, or a whole-handler failure) — never silent, and a repoint failure never
     *  fails the run (`type-registry.ts`'s `RepointResult.notUpdated`, `apply-loop.ts`'s own
     *  per-handler catch). */
    menuLinksNotUpdated: readonly string[];
    /** Post-publish safety check (2026-09-26) — operator-facing lines for published content that
     *  landed but will not show correctly here (`PublishContentHandler.verifyApplied`). Empty when
     *  every check passed; never fails the run. */
    verificationProblems: readonly string[];
  }>;
}

/**
 * Input of {@link buildPublishContentImportHooks}. Generic over the host's publish port bag `P`
 * (the same bag its type registry is instantiated with); the engine never reads a field of it.
 */
export interface BuildPublishContentImportHooksInput<P> {
  workspaceId: string;
  /** The staged bundle (`bundle-staging.ts`, Task 6) this ceremony plans/applies against. Fixed for
   *  the lifetime of one built hooks object — a route builds fresh hooks per request, exactly like
   *  `buildMergeTermHooks` closes over `fromTermId`/`intoTermId` per request. */
  bundleId: string;
  actorId: string;
  /** Trusted attribution from the host's execution channel for every write this import applies
   *  (P10-H2). Required: an import never records a write without its actor kind. `id` must equal `actorId`. */
  actor: MutationActor;
  clock: ClockPort;
  idGen: IdGeneratorPort;
  /** The already-built `PublishContentDeps` bag every registered contributor's `build()` closes
   *  over — same shape `export.ts`'s own `toPublishContentDeps` produces. */
  publishContentDeps: PublishContentDeps<P>;
  /** The host-bound publishable-type registry's catalog builder, straight through to
   *  {@link PlanImportDeps.catalog}. Required, never defaulted: the process-wide registry lives in
   *  the host, and `planImport()` calls it fresh on every plan. */
  catalog: PlanImportDeps<P>["catalog"];
  /**
   * The host's plan-hash function — the value an approval token is bound to. `computePlan()` returns
   * exactly `planHashOf({ details: report })` for the report it planned, and `gateway.execute()`
   * re-derives and compares it (`PLAN_STALE`). Required: the engine never hashes a plan itself, so a
   * host cannot end up with tokens bound to a hash it did not choose.
   */
  planHashOf: (required: { details: PublishContentReport }, optional?: {}) => string;
  /** The host's actor-class identity resolver (who the gateway records as acting), handed to the
   *  gateway unchanged as the hooks' own `resolveActorClassIdentity`. Required for the same reason. */
  resolveActorClassIdentity: GatedMutationHooks<PublishContentReport, PublishContentImportResult>["resolveActorClassIdentity"];
  bundleRepo: PublishContentBundleRepoPort;
  baselineRepo: PublishContentBaselineRepoPort;
  /** Only the read side is used ({@link BlobStorePort.exists}) — this ceremony never writes a blob
   *  itself (Task 6's `blobs/probe`/`blobs/:sha` routes own that). */
  blobStore: { exists(input: { storageKey: string }, optional?: {}): Promise<boolean> };
  dbOps: PublishContentDbOpsPort;
  restorePointsRepo: PublishContentRestorePointSavePort;
  applyPort: PublishContentApplyPort;
  /** D1 — the destination's seed-version lookup (`seed-hash.ts`), consulted by `planImport()` only
   *  for a row with no recorded baseline. Omitted means "no seed", the pre-D1 behaviour; the import
   *  route always passes `RouteDeps.publishContentSeedHash`, which both composition roots bind. */
  getSeedHash?: PublishContentSeedHashFn;
  /**
   * publish-overwrite-live-plan §4/S6 — entity keys (`planner.ts`'s `entityKey`) the operator ticked
   * "overwrite on live" for, straight through to {@link PlanImportDeps.forcedEntityKeys}. Absent
   * means "force nothing", the pre-S6 default — every existing caller (this file's own tests, every
   * route that never sends this field) is unchanged.
   *
   * A route builds fresh hooks per request, closing over THAT request's own set (`import.ts`'s
   * `buildHooks`) — never a value cached across `plan`/`confirm`/`execute`. That is what makes this
   * file's existing plan-staleness property (see this file's header) also police an operator's ticks
   * changing between plan/confirm and execute for free: `planStagedImport()` re-derives from whatever set
   * THIS call passed, so a different set at execute changes which rows are `forced`, which changes
   * `planHashOf({ details: report })`, which `gateway.execute()` step 4 rejects as `PLAN_STALE` before ever
   * reaching {@link PublishContentApplyPort.applyReport}. No code here is dedicated to detecting a
   * changed selection.
   */
  forcedEntityKeys?: ReadonlySet<string>;
}

/**
 * SPEC publish-content — the `publish_content` import ceremony's `GatedMutationHooks`. See this
 * file's header for the `PLAN_STALE`-for-free property and the Task 8 seam.
 *
 * @complexity O(n) in the staged bundle's entity count, via `planImport()` — dominated by
 * `planImport`'s own cost (its file header documents this precisely), not by anything in this file.
 * @overallScore 100
 */
/** What a confirmed import reports back: the restore point taken before the first write, and what the
 *  apply run did. */
export interface PublishContentImportResult {
  restorePointId: string;
  /** Actual outcomes after apply, including race-time conflict downgrades. */
  report?: PublishContentReport;
  runId: string;
  changeSetIds: readonly string[];
  retiredChangeSetIds: readonly string[];
  repointChangeSetIds: readonly string[];
  menuLinksUpdated: number;
  menuLinksNotUpdated: readonly string[];
  verificationProblems: readonly string[];
}

export function buildPublishContentImportHooks<P>(
  input: BuildPublishContentImportHooksInput<P>, _optional = {}
): GatedMutationHooks<PublishContentReport, PublishContentImportResult> {
  return {
    domain: "publish_content.import",
    readPermission: "publish_content.read",
    mutatePermission: "publish_content.apply",
    scopeId: input.workspaceId,
    computePlan: async () => {
      const report = await planStagedImport({ input });
      return { planHash: input.planHashOf({ details: report }), details: report };
    },
    executeMutation: async (verified) => executeConfirmedImport({ input, report: verified.details }),
    resolveActorClassIdentity: input.resolveActorClassIdentity,
  };
}

/** Plan step: derives the report for the staged bundle from LIVE destination state. Every call
 *  reads again; nothing is cached between the plan a person confirms and a later call.
 *  @complexity One bundle read, then `planImport`'s cost over the bundle's entities. */
async function planStagedImport<P>({ input }: { input: BuildPublishContentImportHooksInput<P> }, _optional = {}): Promise<PublishContentReport> {
  const now = clockNowIso({ clock: input.clock });
  const staged = await loadActiveBundle({ repo: input.bundleRepo, workspaceId: input.workspaceId, id: input.bundleId, now });
  if (!staged) {
    throw new PublishContentBundleNotFoundError({ message: `publish-content: bundle '${input.bundleId}' was not found, or has expired, for workspace '${input.workspaceId}'` });
  }

  const bundle: PublishContentBundle = {
    artifactFormatVersion: staged.artifactFormatVersion,
    hashVersion: staged.hashVersion,
    // Never persisted on a staged bundle row (`bundle-staging.ts`'s own disclosed schema
    // deviation) — display-only, and `planImport` treats it as optional. Not a loss of anything
    // this planner compares on. Left absent rather than `sourceLabel: undefined` (this package
    // builds with `exactOptionalPropertyTypes`); `planImport` never reads it, so the two are identical.
    entities: JSON.parse(staged.entitiesJson) as readonly PackedEntity[],
  };

  const getBaseline: PlanImportDeps<P>["getBaseline"] = async ({ entityType, entityId }) => {
    const record = await input.baselineRepo.findOne({
      workspaceId: input.workspaceId,
      // Plan §1.6 / §5 risk #9: the peer key is the bundle's OWN authenticated source principal
      // (the peer who pushed/staged it), never the confirming/executing admin's principal id —
      // see this file's header and `baseline-repo.ts`'s own doc.
      peerPrincipalId: staged.sourcePrincipalId,
      entityType,
      entityId,
    });
    return record ? { hashAtLastSync: record.hashAtLastSync, hashVersion: record.hashVersion } : null;
  };

  const hasBlob = async ({ sha256 }: { sha256: string }, _optional = {}): Promise<boolean> =>
    input.blobStore.exists({ storageKey: computeBlobStorageKey({ workspaceId: input.workspaceId, sha256 }) });

  return planImport({
                      bundle,
                      deps: {
      publishContentDeps: input.publishContentDeps,
      catalog: input.catalog,
      getBaseline,
      hasBlob,
      ...(input.getSeedHash === undefined ? {} : { getSeedHash: input.getSeedHash }),
      ...(input.forcedEntityKeys === undefined ? {} : { forcedEntityKeys: input.forcedEntityKeys }),
    }
                    });
}

/** Restore-point step: snapshots the workspace and records the snapshot, attributed to the acting
 *  person, before the run writes anything. @complexity One workspace snapshot plus one row write. */
async function captureImportRestorePoint<P>({ input }: { input: BuildPublishContentImportHooksInput<P> }, _optional = {}): Promise<string> {
  // Restore point captured BEFORE any write this run might make (plan §4 task 7's own
  // instruction), mirroring `buildMigrateForwardHooks`'s identical ordering. The
  // `costClass: 'unavailable'` refusal itself lives in `execute-import.ts`, called by the
  // route BEFORE `gateway.execute()` ever reaches this function — see this file's header.
  const captured = await input.dbOps.captureRestorePoint({ scopeId: input.workspaceId });
  const restorePointId = input.idGen.newId();
  const now = clockNowIso({ clock: input.clock });
  await input.restorePointsRepo.save({
    restorePointId,
    idempotencyKey: restorePointId,
    trigger: "publish-content-import",
    createdAt: now,
    createdBy: input.actorId,
    artifactRef: captured.artifactRef,
    watermarkAtCapture: captured.watermarkAtCapture,
  });
  return restorePointId;
}

/** Execute step: applies exactly the report the gateway hash-matched against the confirmed token.
 *  @param report - The verified report, never a fresh derivation (see the comment in the body).
 *  @complexity One restore point, then the apply run's cost over the report's rows. */
async function executeConfirmedImport<P>({ input, report: confirmedReport }: { input: BuildPublishContentImportHooksInput<P>; report: PublishContentReport }, _optional = {}): Promise<PublishContentImportResult> {
  const restorePointId = await captureImportRestorePoint({ input });

  // The report `gateway.execute()` step 4 just re-derived and hash-matched against the
  // confirmed token — NOT a fresh `planStagedImport()` call.
  //
  // This used to re-derive, on the claim that `gateway.execute()` having hash-compared
  // "moments ago" made a second derivation "guaranteed consistent". That claim was false
  // (sol review 2026-09-20, High finding 1). `planStagedImport()` reads live state on every call
  // (this file's header) and the two derivations are separated by the token redemption plus
  // this function's own restore-point capture, which is a whole-workspace snapshot —
  // `execute-import.ts` classes its cost `cheap | expensive | unavailable`, so a slow one is a
  // supported state, not a pathology. That same file (line 14) records that this ceremony
  // deliberately takes no cross-domain operation lock. Nothing held the destination still, so a
  // row the operator confirmed as `conflict` (no write) could re-derive as `applied` (a write)
  // and be applied unseen: the operator authorises one write set and gets another.
  const report = confirmedReport;
  const {
    report: appliedReport,
    runId,
    changeSetIds,
    retiredChangeSetIds,
    repointChangeSetIds,
    menuLinksUpdated,
    menuLinksNotUpdated,
    verificationProblems,
  } = await input.applyPort.applyReport({
    report,
    principalId: input.actorId,
    actor: checkedMutationActor({ principalId: input.actorId, actor: input.actor }) as MutationActor,
    bundleId: input.bundleId,
    restorePointId,
    // This hooks bag's OWN authorize, which the route may have attenuated for a publishing
    // credential. Threaded rather than left to the port because the port is built once per
    // process and this decision is per request.
    ...(input.publishContentDeps.authorize === undefined ? {} : { authorize: input.publishContentDeps.authorize }),
    ...(input.publishContentDeps.backstop === undefined ? {} : { backstop: input.publishContentDeps.backstop }),
  });
  return {
    ...(appliedReport ? { report: appliedReport } : {}),
    restorePointId,
    runId,
    changeSetIds,
    retiredChangeSetIds,
    repointChangeSetIds,
    menuLinksUpdated,
    menuLinksNotUpdated,
    verificationProblems,
  };
}
