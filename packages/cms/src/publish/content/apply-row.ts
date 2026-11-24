import { nowIso as clockNowIso, type Clock as ClockPort } from "@jini-ai/core/primitives";

import { applyRetiringRow as applyRetiringRowSequence } from "./apply-retire.js";
import { downgradedRow, downgradeOrRethrow, type ApplyRowResult } from "./apply-failure.js";
import type { PublishContentBaselineRepoPort } from "./baseline-repo.js";
import { CONTENT_HASH_VERSION } from "./content-hash.js";
import { publishContentItemIdempotencyKey } from "./idempotency.js";
import { entityKey, type PublishContentOutcomeRow } from "./plan-rows.js";
import type { PublishContentSeedHashFn } from "./seed-hash.js";
import type { PublishContentHandler } from "./type-registry.js";
import type { PackedEntity } from "../transfer/index.js";

/**
 * @file Task 8 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4 task 8 / §5 risks
 * #1–#3, #6, #7, #9.
 *
 * `createPublishContentApplyPort` builds the real {@link PublishContentApplyPort} — the
 * implementation of the seam declared by `gated-hooks.ts`, wired at both composition roots.
 *
 * ## The property this file exists to hold — read before changing the per-row loop
 *
 * A destination edit landing in the narrow window between `gated-hooks.ts`'s own fresh
 * `buildReport()` (called twice already — once by `gateway.execute()`'s `PLAN_STALE` re-check, once
 * again inside `executeMutation()` right before this port is called) and THIS function's own
 * per-row write must downgrade that ONE row to `conflict`, never overwrite it and never abort the
 * whole run. Three checks close that window, in order, per writing row: (1) `created` + a row now
 * existing at apply time -> `conflict` (a true "someone else created it first" race — `save()`'s
 * `INSERT … ON CONFLICT DO UPDATE` has NO version/existence guard of its own, so this loop's own
 * `inspect()` re-check is the only thing standing between an import and a silent overwrite of a
 * concurrently-created row); (2) `applied`/`forced` + the row now GONE -> `conflict`; (3) `applied`
 * specifically (never `forced` — an operator forcing past a conflict already accepted overriding
 * whatever is there) + the destination's hash no longer matching its recorded baseline -> `conflict`.
 * Beyond those, `handler.apply()` itself is called with a freshly re-read `expectedVersion`, so
 * `updatePost`'s own `saveIfVersion` (`UPDATE … WHERE version = ?`) is a second, authoritative guard
 * against the same class of race: a `PostConflictError`/`PostNotFoundError` thrown from inside
 * `handler.apply()` is caught here and ALSO downgrades to `conflict` rather than aborting the run.
 *
 * This loop's per-row failure handling was originally scoped to `post`'s own error hierarchy
 * (`PostConflictError` and its `PostVersionConflictError` subclass, `PostNotFoundError`) with a
 * disclosed note that "a future non-post type either reuses these classes or this catch needs
 * widening when that type lands". `media` was that type, and the catch was widened rather than
 * reusing post's classes from an unrelated feature: any type may now raise
 * `PublishContentApplyRowError` (`apply-errors.ts`) to downgrade ONE row instead of aborting the run,
 * and a new content type needs no edit here at all. See that file's header for why the base class
 * lives outside `type-registry.ts`. Post's two classes keep their special case, but the post handler
 * names them (`PublishContentHandler.isApplyConflict`), so this loop imports no content type.
 *
 * The two sides are phrased differently on purpose: a `PublishContentApplyRowError`'s message is the
 * row's `reason` VERBATIM (the type owns its own operator-facing wording), while post's legacy
 * errors — whose messages are terse and contextless — keep the "changed on the destination during
 * apply" prefix they have always had.
 *
 * ## Authorship — `principalId` passed to every `handler.apply()` call is ALWAYS the operator
 *
 * This loop never swaps `principalId` for the source entity's own author before calling
 * `handler.apply()` — that would also hand the source author's (frequently non-existent-on-this-
 * instance) id to `executeCommand`'s own `authorize()` check as `command.actor.id` inside the
 * handler, which is a live authorization bug, not a style choice. Task 15's "the importer must copy
 * the source's author, never the operator's" rule is instead satisfied entirely INSIDE
 * `features/post/publish-content.ts`'s own `apply()` — it reads `entity.state.createdByPrincipalId`
 * directly for the `created` case, decoupled from whatever `principalId` this loop passes. See that
 * function's own doc for the full explanation, including the plan's own draft wording this disclosed
 * deviation corrects.
 */

/** The mutable, per-call working state {@link applyOneRow} needs — grouped into one object so that
 *  function's own signature stays a single required-input-object parameter (this codebase's own
 *  convention for exported/boundary functions) despite the number of fields involved.
 *  @complexity N/A — a plain data grouping, no behavior. */
export interface ApplyRowContext {
  readonly workspaceId: string;
  readonly runId: string;
  readonly sourcePrincipalId: string;
  readonly principalId: string;
  readonly entityByKey: ReadonlyMap<string, PackedEntity>;
  readonly handlerByType: ReadonlyMap<string, PublishContentHandler>;
  readonly baselineRepo: PublishContentBaselineRepoPort;
  readonly getSeedHash: PublishContentSeedHashFn;
  readonly clock: ClockPort;
  readonly recordContentApplied: (input: {
    itemKey: string;
    changeSetId: string;
    /** The retire half's own change set, for a `retires` row whose retire and create both landed. */
    retiredChangeSetId?: string;
  }, optional?: {}) => Promise<void>;
}

export type InspectedRow = NonNullable<Awaited<ReturnType<PublishContentHandler["inspect"]>>>;

/** What the per-row checks and writes of ONE report row read. `applyOneRow` builds it once, after it
 *  read `current` (the destination row as it is right now, `null` when absent), and every step below
 *  takes it as `{ step }`, so a value one step needs (a later lost-update observation, say) is a field
 *  here and not a new argument to each step. */
export interface ApplyRowStep {
  readonly row: PublishContentOutcomeRow;
  readonly ctx: ApplyRowContext;
  readonly key: string;
  readonly entity: PackedEntity;
  readonly handler: PublishContentHandler;
  readonly current: InspectedRow | null;
}

export function checkExistence({ step }: { step: ApplyRowStep }, _optional = {}): ApplyRowResult | null {
  const { row, current } = step;
  if (row.outcome === "created" && current !== null) {
    return downgradedRow({ row, outcome: "conflict", reason: `${row.entityType} '${row.entityId}' was created on the destination between plan and apply` });
  }
  if (row.outcome !== "created" && current === null) {
    return downgradedRow({ row, outcome: "conflict", reason: `${row.entityType} '${row.entityId}' was removed from the destination between plan and apply` });
  }
  return null;
}

export async function checkAgreement(
  { step, current }: { step: ApplyRowStep; current: InspectedRow },
  _optional = {}
): Promise<ApplyRowResult | null> {
  const { row, ctx, entity, handler } = step;
  // Never for `forced` — an operator forcing past a conflict already accepted overriding whatever
  // is there. Re-derives the SAME baseline `planEntity` (`planner.ts`) compared against, rather
  // than reusing any value carried on `row` (the report never carries one) — this IS the
  // apply-time re-verification this file's header calls "the single most important property".
  const baseline = await ctx.baselineRepo.findOne({
    workspaceId: ctx.workspaceId,
    peerPrincipalId: ctx.sourcePrincipalId,
    entityType: row.entityType,
    entityId: row.entityId,
  });
  // Missing or obsolete history falls back to the current seed, exactly as the planner does.
  // An old hash generation cannot authorize an overwrite or veto a current seed match.
  // S-F4: then the handler's own seed (`handler.seedHash`), exactly as `planEntity` falls back.
  const agreedHash = baseline?.hashVersion === CONTENT_HASH_VERSION
    ? baseline.hashAtLastSync
    : ((await ctx.getSeedHash({ entityType: row.entityType, entityId: row.entityId })) ??
      (await handler.seedHash?.({ id: entity.id })) ??
      null);
  if (agreedHash === null || current.hash !== agreedHash) {
    return downgradedRow({
      row,
      outcome: "conflict",
      reason: `${row.entityType} '${row.entityId}' was edited on the destination again after this run's own plan was built`,
    });
  }
  return null;
}

export async function applyOrdinaryRow({ step }: { step: ApplyRowStep }, _optional = {}): Promise<ApplyRowResult> {
  const { row, ctx, key, entity, handler, current } = step;
  try {
    const { changeSetId } = await handler.apply({
      entity,
      // This row is the server-verified report, not bundle flags or writes:true.
      ...(row.outcome === "forced" && row.canOverwrite && row.sourceReplacement
        ? { sourceReplacement: row.sourceReplacement } : {}),
      expectedVersion: current?.version, // `created` -> undefined (current is null); applied/forced -> fresh version just read above.
      principalId: ctx.principalId, // always the operator — see this file's header.
      idempotencyKey: publishContentItemIdempotencyKey({
        workspaceId: ctx.workspaceId,
        sourcePrincipalId: ctx.sourcePrincipalId,
        entity, sourceReplacement: row.sourceReplacement,
      }) + (handler.idempotencyScope === "run" ? `:${ctx.runId}` : ""),
    });
    // Persist the change-set id BEFORE the baseline write. If that next write fails, status lookup
    // still proves exactly which content mutation landed and a retry can use the same command key.
    await ctx.recordContentApplied({ itemKey: key, changeSetId });
    await refreshBaseline({ row, entity, ctx });
    return { row, changeSetId, retiredChangeSetId: null };
  } catch (error) {
    return downgradeOrRethrow({ error, row, handler });
  }
}

/** Replacement sanitizing may normalize source metadata; remember what actually landed.
 * One indexed inspect per replaced row, with no additional reads on ordinary imports. */
export async function refreshBaseline({ row, entity, ctx }: { row: PublishContentOutcomeRow; entity: PackedEntity; ctx: ApplyRowContext }, _optional = {}): Promise<void> {
  const destination = row.sourceReplacement ? await ctx.handlerByType.get(row.entityType)?.inspect({ id: row.entityId }) : null;
  return ctx.baselineRepo.upsert({ record: {
    workspaceId: ctx.workspaceId,
    peerPrincipalId: ctx.sourcePrincipalId,
    entityType: row.entityType,
    entityId: row.entityId,
    hashAtLastSync: destination?.hash ?? entity.contentHash,
    hashVersion: entity.hashVersion,
    syncedAt: clockNowIso({ clock: ctx.clock }),
    runId: ctx.runId,
  } });
}

export async function refreshNonWritingRow({ row, ctx }: { row: PublishContentOutcomeRow; ctx: ApplyRowContext }, _optional = {}): Promise<ApplyRowResult> {
  const key = entityKey({ entityType: row.entityType, entityId: row.entityId });
  // `conflict`/`blocked` pass through untouched — no baseline write (plan §4 task 8: baselines are
  // upserted for created/unchanged/applied/forced ONLY). `unchanged` is the one non-writing outcome
  // that still refreshes the baseline: the destination already matches the source, so there is
  // nothing to apply, but recording that agreement is exactly what lets FUTURE runs tell "still
  // agrees" apart from "diverged since we last looked".
  if (row.outcome === "unchanged") {
    const entity = ctx.entityByKey.get(key);
    if (entity) {
      await refreshBaseline({ row, entity, ctx });
    }
  }
  return { row, changeSetId: null, retiredChangeSetId: null };
}

type RetiringRow = PublishContentOutcomeRow & { retires: NonNullable<PublishContentOutcomeRow["retires"]> };

export type RetiringRowStep = ApplyRowStep & { readonly row: RetiringRow };

/** Host binding of the retire/create/rollback sequence owned by `@jini-ai/cms`: the downgrade
 *  wording, baseline refresh and item idempotency key stay here. */
export function applyRetiringRow({ step }: { step: RetiringRowStep }, _optional = {}): Promise<ApplyRowResult> {
  return applyRetiringRowSequence<RetiringRow, PackedEntity, PublishContentHandler, ApplyRowContext, ApplyRowResult>({
    step,
    collaborators: {
      downgradedRow,
      downgradeOrRethrow,
      itemIdempotencyKey: ({ ctx, entity }) => publishContentItemIdempotencyKey({
        workspaceId: ctx.workspaceId,
        sourcePrincipalId: ctx.sourcePrincipalId,
        entity,
      }),
      refreshBaseline,
      appliedResult: ({ row, changeSetId, retiredChangeSetId }) => ({ row, changeSetId, retiredChangeSetId }),
      rollbackFailureMessage: ({ row, createCause, undoCause }) =>
        `${row.entityType} '${row.entityId}' was not created (${createCause}), and putting the retired ` +
        `${row.retires.entityType} '${row.retires.entityId}' back failed too (${undoCause}) — restore it from Trash`,
    },
  });
}
