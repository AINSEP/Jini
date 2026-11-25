import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import { createHash } from "node:crypto";

import { downgradedRow, withRefusedItem, type ApplyRowResult, type PluginHookFailure } from "./apply-failure.js";
import {
  applyOrdinaryRow, applyRetiringRow, checkAgreement, checkExistence, refreshNonWritingRow,
  type ApplyRowContext, type ApplyRowStep,
} from "./apply-row.js";
import type { BackstopAuditRecord, BackstopInverse, PackedEntity } from "../transfer/index.js";
import { loadActiveBundle } from "../transfer/index.js";
import {
  currentChangeSetIds, currentReport, currentRetiredChangeSetIds, runItemStates, saveRunRecord, saveRunSnapshot,
  type ApplyRun, type ApplyRunIdentity, type CreatePublishContentApplyPortInput,
} from "./apply-run.js";
import type { BackstopService } from "./backstop-service.js";
import { contentHash } from "./content-hash.js";
import { PublishContentBundleNotFoundError } from "./gated-hooks.js";
import type { PublishContentApplyPort } from "./gated-hooks.js";
import { publishContentItemIdempotencyKey } from "./idempotency.js";
import { entityKey } from "./plan-rows.js";
import type { PublishContentOutcomeRow, PublishContentReport } from "./plan-rows.js";
import { NO_PUBLISH_CONTENT_SEED_HASH } from "./seed-hash.js";
import type { EntityReplacement, PublishContentHandler, PublishContentTypeRegistry } from "./type-registry.js";

/**
 * What the host binds into the apply loop. All three are REQUIRED and never defaulted, because the
 * engine owns none of them: it must not import the host's publishable-type registry, its
 * hand-send policy, or the plugin host.
 */
export interface ApplyReportHost<P> {
  /** The host-bound publishable-type registry's catalog builder, read fresh at apply time on every
   *  call (see `openRun`). */
  readonly catalog: { readonly build: PublishContentTypeRegistry<P>["buildCatalog"] };
  /** The host-bound hand-send metadata check (`createBackstopService(...).readBackstopMetadata`). */
  readonly readBackstopMetadata: BackstopService["readBackstopMetadata"];
  /** The plugin-host refusal class, as this loop needs it: `isPluginHookFailure` recognizes a plugin
   *  save hook's refusal and `attachRefusedItem` rebuilds it carrying the item it refused. */
  readonly pluginHooks: {
    readonly isPluginHookFailure: (error: unknown) => error is PluginHookFailure;
    readonly attachRefusedItem: (failure: PluginHookFailure, refusedItemRef: string) => Error;
  };
}

/**
 * R5 (`plan-publish-repoint-menus-2026-09-24.md` §2.3) — capitalizes a handler's own `entityType`
 * for the one generic, type-agnostic operator-facing prefix the repoint pass produces when a whole
 * `repointReferences()` call throws (as opposed to a per-holder line, which the handler itself
 * already phrases — see {@link createPublishContentApplyPort}'s repoint pass, below).
 * @complexity O(1).
 */
function capitalize({ value }: { value: string }, _optional = {}): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/**
 * Applies exactly one report row, mutating nothing — returns the row as it actually resolved (which
 * may differ from the plan's own prediction, see `apply-row.ts`'s header) plus the `changeSetId` a write
 * produced (or `null` for a row that wrote nothing), and `retiredChangeSetId` — the SEPARATE change
 * set a {@link PublishContentOutcomeRow.retires} row's retire half produced (`null` for every other
 * row, including a `retires` row that never reached the write, e.g. because it was downgraded to
 * `conflict` before either write was attempted). It stays apart from `changeSetId` rather than
 * collapsing into one list, so a caller counting "one change set per row" is never off by one for a
 * row that produced two.
 *
 * @complexity O(1) plus whatever `handler.inspect`/`handler.planRetire`/`handler.retire`/
 * `handler.apply`/`baselineRepo` I/O costs — no loop; {@link createPublishContentApplyPort} is what
 * iterates a report's rows.
 */
async function applyOneRow({ row, ctx }: { row: PublishContentOutcomeRow; ctx: ApplyRowContext }, _optional = {}): Promise<ApplyRowResult> {
  const key = entityKey({ entityType: row.entityType, entityId: row.entityId });

  if (!row.writes) {
    return refreshNonWritingRow({ row, ctx });
  }
  const entity = ctx.entityByKey.get(key);
  const handler = ctx.handlerByType.get(row.entityType);
  if (!entity || !handler) {
    // Internal inconsistency (the bundle/registry moved between planning and apply in a way that
    // should not be reachable through normal use) — downgrade, do not crash the whole run over it.
    return downgradedRow({
      row,
      outcome: "blocked",
      reason: `internal inconsistency: no packed entity/handler for ${row.entityType} '${row.entityId}' at apply time`,
    });
  }

  const current = await handler.inspect({ id: entity.id });
  const step: ApplyRowStep = { row, ctx, key, entity, handler, current };

  if (row.retires) {
    return applyRetiringRow({ step: { ...step, row: { ...row, retires: row.retires } } });
  }
  const raced = checkExistence({ step });
  if (raced) return raced;
  if (row.outcome === "applied" && current) {
    const conflict = await checkAgreement({ step, current });
    if (conflict) return conflict;
  }
  return applyOrdinaryRow({ step });
}

type ApplyReportInput = Parameters<PublishContentApplyPort["applyReport"]>[0];
type ApplyReportResult = Awaited<ReturnType<PublishContentApplyPort["applyReport"]>>;

/** Loads the staged bundle this run applies, or says it is gone. */
async function loadStagedBundle<P>(
  { input, bundleId, startedAt }: { input: CreatePublishContentApplyPortInput<P>; bundleId: string; startedAt: string },
  _optional = {}
) {
  const staged = await loadActiveBundle({
    repo: input.bundleRepo,
    workspaceId: input.workspaceId,
    id: bundleId,
    now: startedAt,
  });
  if (!staged) {
    throw new PublishContentBundleNotFoundError({ message: `publish-content: bundle '${bundleId}' was not found, or has expired, for workspace '${input.workspaceId}'` });
  }
  return staged;
}

/** Reachable per `gated-hooks.ts`'s own doc: a plan confirmed while ALREADY refused stays
 *  refused at execute time too (same hash both times), so `PLAN_STALE` never intercepts it —
 *  `executeMutation()` still calls this port. Nothing to apply; record it and stop. */
async function abandonRefusedRun<P>(
  { input, identity, report }: { input: CreatePublishContentApplyPortInput<P>; identity: ApplyRunIdentity; report: PublishContentReport },
  _optional = {}
): Promise<ApplyReportResult> {
  await saveRunRecord({
    input,
    identity,
    fields: { phase: "abandoned", changeSetIds: [], report, items: [], finishedAt: clockNowIso({ clock: input.clock }) },
  });
  return {
    runId: identity.runId,
    changeSetIds: [],
    retiredChangeSetIds: [],
    repointChangeSetIds: [],
    menuLinksUpdated: 0,
    menuLinksNotUpdated: [],
    verificationProblems: [],
  };
}

/** Send by hand: records the pending audit row (with each item's hash before the run) and puts the
 *  backstop metadata on the report. Only a run whose bundle carries that metadata has one. */
async function prepareRunAudit<P>({ run }: { run: ApplyRun<P> }, _optional = {}): Promise<void> {
  const { progress, handlerDeps, handlerByType, input, runId, startedAt, entities } = run;
  const metadata = readBackstopMetadata({ entities });
  const backstopAudit = handlerDeps.backstop?.audit;
  if (!metadata) return;
  if (!backstopAudit || !(await backstopAudit.ready())) throw new Error("Send by hand needs its audit storage installed before it can send anything.");
  progress.report = { ...progress.report, backstop: metadata };
  progress.auditRecord = {
    id: runId, workspaceId: input.workspaceId, direction: "destination", actorId: metadata.sourceActor,
    destination: metadata.destinationHost, reason: metadata.reason, at: startedAt, gapLabels: metadata.gapLabels,
    items: await Promise.all(entities.map(async (e) => ({
      entityType: e.entityType, id: e.id,
      beforeHash: (await handlerByType.get(e.entityType)?.inspect({ id: e.id }))?.hash ?? null, afterHash: e.contentHash
    }))),
    result: "pending", runId, details: {}, inverses: []
  };
  await backstopAudit.save({ record: progress.auditRecord });
}

function initializeRunItems<P>({ run }: { run: ApplyRun<P> }, _optional = {}): void {
  const { progress, entityByKey, input, sourcePrincipalId, startedAt } = run;
  for (const row of progress.report.rows) {
    const key = entityKey({ entityType: row.entityType, entityId: row.entityId });
    const entity = entityByKey.get(key);
    const missingIdentity = `${input.workspaceId}:${sourcePrincipalId}:${key}`;
    const idempotencyKey = entity
      ? publishContentItemIdempotencyKey({ workspaceId: input.workspaceId, sourcePrincipalId, entity, sourceReplacement: row.sourceReplacement })
      : `publish-content:v1:missing:${createHash("sha256").update(missingIdentity).digest("hex")}`;
    progress.itemByKey.set(key, {
      entityType: row.entityType,
      entityId: row.entityId,
      idempotencyKey,
      phase: "pending",
      outcome: row.outcome,
      writes: row.writes,
      reason: row.reason,
      changeSetId: null,
      retiredChangeSetId: null,
      errorSummary: null,
      updatedAt: startedAt,
    });
  }
}

/** Opens the run: reads the registry fresh, prepares the audit, and persists the run and every
 *  pending item before the first content write. */
async function openRun<P>(
  { input, identity, staged, report, authorize, backstop }: {
    input: CreatePublishContentApplyPortInput<P>;
    identity: ApplyRunIdentity;
    staged: { entitiesJson: string };
    report: PublishContentReport;
    authorize: ApplyReportInput["authorize"];
    backstop: ApplyReportInput["backstop"];
  },
  _optional = {}
): Promise<ApplyRun<P>> {
  const entities = JSON.parse(staged.entitiesJson) as readonly PackedEntity[];
  const entityByKey = new Map(entities.map((entity) => [entityKey({ entityType: entity.entityType, entityId: entity.id }), entity] as const));
  // Registry read fresh, at apply time, every call — same rule `planner.ts`'s own header pins
  // for planning; a handler built once and cached across calls would go stale the moment a
  // contributor re-registers (e.g. a hot-reloaded dev process).
  // The caller's authorize wins when it supplies one: this port is built once per process and
  // closes over RBAC, which is the wrong authority for a publishing credential. See
  // `PublishContentApplyPort.applyReport`'s own doc.
  const handlerDeps = {
    ...input.publishContentDeps,
    ...(authorize === undefined ? {} : { authorize }), ...(backstop === undefined ? {} : { backstop })
  };
  const { handlerByType } = buildPublishContentCatalog(handlerDeps);
  const run: ApplyRun<P> = {
    ...identity,
    input,
    entities,
    entityByKey,
    handlerDeps,
    handlerByType,
    transactional: entities.some((entity) => entity.entityType === "raw-row" || entity.entityType === "raw-file"),
    progress: { report, effectiveRowsByKey: new Map(), itemByKey: new Map(), auditRecord: undefined, activeItemKey: null },
  };
  await prepareRunAudit({ run });
  for (const row of run.progress.report.rows) {
    run.progress.effectiveRowsByKey.set(entityKey({ entityType: row.entityType, entityId: row.entityId }), row);
  }
  initializeRunItems({ run });
  // Persist the run and every pending item before the first content write.
  await saveRunSnapshot({ run, phase: "applying", finishedAt: null });
  return run;
}

/** The per-row context `applyOneRow` reads, with the one write-back it needs: recording the change
 *  set a row landed, durably, before anything else about that row can fail. */
function applyRowContext<P>({ run }: { run: ApplyRun<P> }, _optional = {}): ApplyRowContext {
  const { input, progress } = run;
  return {
    workspaceId: input.workspaceId,
    runId: run.runId,
    sourcePrincipalId: run.sourcePrincipalId,
    principalId: run.principalId,
    entityByKey: run.entityByKey,
    handlerByType: run.handlerByType,
    baselineRepo: input.baselineRepo,
    getSeedHash: input.getSeedHash ?? NO_PUBLISH_CONTENT_SEED_HASH,
    clock: input.clock,
    recordContentApplied: async ({ itemKey, changeSetId, retiredChangeSetId }) => {
      const item = progress.itemByKey.get(itemKey);
      if (!item) return;
      progress.itemByKey.set(itemKey, {
        ...item,
        phase: "content_applied",
        changeSetId,
        ...(retiredChangeSetId === undefined ? {} : { retiredChangeSetId }),
        updatedAt: clockNowIso({ clock: input.clock }),
      });
      await saveRunSnapshot({ run, phase: "applying", finishedAt: null });
    },
  };
}

interface RepointOutcome {
  repointChangeSetIds: string[];
  menuLinksUpdated: number;
  menuLinksNotUpdated: string[];
}

/** The retired-holder -> new-id pairs of every overwrite row whose retire actually landed.
 *  `retiredChangeSetId === null` covers both "never reached the retire" and "the create that
 *  followed it failed and was undone" (§2.3 step 1) — either way, nothing was actually
 *  replaced, so there is nothing here for a repoint pass to act on. */
function landedReplacements<P>({ run }: { run: ApplyRun<P> }, _optional = {}): EntityReplacement[] {
  const replacements: EntityReplacement[] = [];
  for (const row of run.progress.report.rows) {
    if (!row.retires) continue;
    const item = run.progress.itemByKey.get(entityKey({ entityType: row.entityType, entityId: row.entityId }));
    if (item && item.retiredChangeSetId !== null) {
      replacements.push({ entityType: row.retires.entityType, oldId: row.retires.entityId, newId: row.entityId });
    }
  }
  return replacements;
}

async function repointHandlers<P>(
  { run, replacements, skipIds }: { run: ApplyRun<P>; replacements: EntityReplacement[]; skipIds: Set<string> },
  _optional = {}
): Promise<RepointOutcome> {
  let repointChangeSetIds: string[] = [];
  let menuLinksUpdated = 0;
  const menuLinksNotUpdated: string[] = [];
  for (const handler of run.handlerByType.values()) {
    if (!handler.repointReferences) continue;
    try {
      const repointed = await handler.repointReferences({ replacements, skipIds, principalId: run.principalId, runId: run.runId });
      repointChangeSetIds = repointChangeSetIds.concat(repointed.changeSetIds);
      menuLinksUpdated += repointed.linksUpdated;
      menuLinksNotUpdated.push(...repointed.notUpdated);
    } catch (error) {
      // The content this run published already landed — a repoint failure is reported, never
      // thrown back to fail the run (§2.3 step 4). A handler's own per-holder failures (a
      // denied grant, a concurrent edit) are already caught inside that handler and returned
      // via `notUpdated` above; reaching this catch means the WHOLE call failed (e.g. a
      // required port was never wired for this composition root).
      const message = error instanceof Error ? error.message : String(error);
      menuLinksNotUpdated.push(`${capitalize({ value: handler.entityType })} links were not updated: ${message}`);
    }
  }
  return { repointChangeSetIds, menuLinksUpdated, menuLinksNotUpdated };
}

// R5 (`plan-publish-repoint-menus-2026-09-24.md` §2.3), extended by R6 (2026-09-24 follow-up)
// — repoints every live reference that still points at an address-clash overwrite's retired
// holder. Reads `itemByKey` as it stands AT THE MOMENT IT IS CALLED, so it is safe to call
// after every row has landed (the normal path) OR from inside the loop's own `catch`, mid-run,
// over whatever happened to land before an abort — either way it stays type-agnostic, calling
// every registered handler that implements the optional `repointReferences` hook, generically,
// and never importing navigation or any other reference-holding feature by name.
//
// R6's own property: an overwrite row whose retire+create BOTH landed (`item.retiredChangeSetId`
// set — the same signal the success path already gated on) must still be repointed even when a
// LATER accounting-only failure (e.g. this row's own baseline write, or an unrelated row's own
// write) aborts the whole run — otherwise a live menu is left pointing at a holder this run
// already moved to Trash. A row that never reached a landed retire (never got there, or the
// create half failed and was undone) contributes nothing, aborted run or not.
async function runRepointPass<P>({ run }: { run: ApplyRun<P> }, _optional = {}): Promise<RepointOutcome> {
  const replacements = landedReplacements({ run });
  // Every id written THIS run, across every type — a holder in this set already carries the
  // source's own intent (its own row wrote), so repointing it would fight that intent (§2.5).
  const skipIds = new Set<string>(
    runItemStates({ run })
      .filter((item) => item.changeSetId !== null)
      .map((item) => item.entityId)
  );
  if (replacements.length === 0) return { repointChangeSetIds: [], menuLinksUpdated: 0, menuLinksNotUpdated: [] };
  return repointHandlers({ run, replacements, skipIds });
}

// Post-publish safety check (2026-09-26) — after every row landed, each handler that can
// confirms its entities are servable here (`PublishContentHandler.verifyApplied`). Rows that
// ended `blocked`/`conflict` are left out: they carry their own reason already. A failing check
// is reported, never thrown: the content already landed.
async function runVerifyPass<P>({ run }: { run: ApplyRun<P> }, _optional = {}): Promise<string[]> {
  const problems: string[] = [];
  for (const handler of run.handlerByType.values()) {
    if (!handler.verifyApplied) continue;
    const entities = run.progress.report.rows.flatMap((row) => {
      if (row.entityType !== handler.entityType) return [];
      const key = entityKey({ entityType: row.entityType, entityId: row.entityId });
      const outcome = run.progress.effectiveRowsByKey.get(key)?.outcome ?? row.outcome;
      const entity = run.entityByKey.get(key);
      return entity && outcome !== "blocked" && outcome !== "conflict" ? [entity] : [];
    });
    if (entities.length > 0) {
      problems.push(...(await verifyPublishedEntities({ handler, entities })));
    }
  }
  return problems;
}

/** Records what one row resolved to, durably, before the next row starts. */
async function recordRowOutcome<P>(
  { run, key, result }: { run: ApplyRun<P>; key: string; result: ApplyRowResult },
  _optional = {}
): Promise<void> {
  const { progress } = run;
  progress.effectiveRowsByKey.set(key, result.row);
  const item = progress.itemByKey.get(key);
  if (item) {
    progress.itemByKey.set(key, {
      ...item,
      phase: "completed",
      outcome: result.row.outcome,
      writes: result.row.writes,
      reason: result.row.reason,
      changeSetId: result.changeSetId ?? item.changeSetId,
      retiredChangeSetId: result.retiredChangeSetId ?? item.retiredChangeSetId,
      errorSummary: null,
      updatedAt: clockNowIso({ clock: run.input.clock }),
    });
  }
  await saveRunSnapshot({ run, phase: "applying", finishedAt: null });
}

async function applyRows<P>({ run, ctx }: { run: ApplyRun<P>; ctx: ApplyRowContext }, _optional = {}): Promise<void> {
  const { progress, handlerDeps } = run;
  for (const row of progress.report.rows) {
    progress.activeItemKey = entityKey({ entityType: row.entityType, entityId: row.entityId });
    const result = await applyOneRow({ row, ctx });
    await recordRowOutcome({ run, key: progress.activeItemKey, result });
    progress.activeItemKey = null;
  }
  const { auditRecord } = progress;
  if (auditRecord) {
    const backstopAudit = handlerDeps.backstop?.audit;
    if (!backstopAudit) throw new Error("Send by hand has no audit storage");
    await backstopAudit.save({
      record: {
        ...auditRecord, result: "success",
        inverses: handlerDeps.backstop?.inverses ?? [], details: { report: currentReport({ run }) },
        items: backstopAuditItems({ items: auditRecord.items, inverses: handlerDeps.backstop?.inverses })
      }
    });
  }
}

async function rollbackRawRun<P>(
  { run, error, rollbackErrors }: { run: ApplyRun<P>; error: unknown; rollbackErrors: string[] },
  _optional = {}
): Promise<void> {
  for (const rollback of [...(run.handlerDeps.backstop?.fileRollbacks ?? [])].reverse()) {
    try { await rollback(); } catch (failure) { rollbackErrors.push(failure instanceof Error ? failure.message : "A file could not be rolled back."); }
  }
  recordRawRollback({ run, error, rollbackErrors });
}

function recordRawRollback<P>(
  { run, error, rollbackErrors }: { run: ApplyRun<P>; error: unknown; rollbackErrors: string[] },
  _optional = {}
): void {
  const { progress } = run;
  // All raw writes, change sets and baselines rolled back together. Do not report the
  // tentative per-item snapshots as writes that landed.
  const reason = [error instanceof Error ? error.message : "This send was rolled back.", ...rollbackErrors].join(" ");
  for (const row of progress.report.rows) {
    const key = entityKey({ entityType: row.entityType, entityId: row.entityId });
    const item = progress.itemByKey.get(key);
    if (!item) continue;
    const mayRemain = row.entityType === "raw-file" && item.changeSetId !== null && rollbackErrors.length > 0;
    progress.effectiveRowsByKey.set(key, { ...row, outcome: "blocked", writes: mayRemain, reason });
    progress.itemByKey.set(key, {
      ...item, phase: "failed", outcome: "blocked", writes: mayRemain,
      changeSetId: null, retiredChangeSetId: null, errorSummary: reason, reason
    });
  }
}

function recordFailedItem<P>({ run, error }: { run: ApplyRun<P>; error: unknown }, _optional = {}): void {
  const { progress } = run;
  // A non-conflict error aborted the run partway through — the run row must still record
  // exactly which change sets landed before the failure (plan §5 risk #7's own words), never
  // silently drop that trail just because the whole run did not complete.
  if (!progress.activeItemKey) return;
  const item = progress.itemByKey.get(progress.activeItemKey);
  if (item) {
    progress.itemByKey.set(progress.activeItemKey, {
      ...item,
      // Preserve `content_applied`: that is the recovery signal for a baseline/status write
      // failing after the domain command and its change set already landed.
      phase: item.phase === "content_applied" ? "content_applied" : "failed",
      errorSummary: error instanceof Error ? error.message : "unknown apply failure",
      updatedAt: clockNowIso({ clock: run.input.clock }),
    });
  }
}

/** The audit row of a run that aborted: what failed, and (when a file could not be put back) the
 *  file inverses an operator still needs. */
async function saveFailureAudit<P>(
  { run, error, rollbackErrors }: { run: ApplyRun<P>; error: unknown; rollbackErrors: string[] },
  _optional = {}
): Promise<void> {
  const { auditRecord } = run.progress;
  if (!auditRecord) return;
  const backstopAudit = run.handlerDeps.backstop?.audit;
  if (!backstopAudit) throw new Error("Send by hand has no audit storage");
  await backstopAudit.save({
    record: {
      ...auditRecord, result: "failure",
      inverses: rollbackErrors.length > 0 ? (run.handlerDeps.backstop?.inverses ?? []).filter((i) => i.kind === "raw-file") : [],
      details: { error: error instanceof Error ? error.message : "This send was rolled back.", rollbackErrors }
    }
  });
}

async function failRun<P>({ run, error }: { run: ApplyRun<P>; error: unknown }, _optional = {}): Promise<never> {
  const { progress, transactional } = run;
  const rollbackErrors: string[] = [];
  if (transactional) await rollbackRawRun({ run, error, rollbackErrors });
  recordFailedItem({ run, error });
  // R6 — whatever landed before this abort (an overwrite row's retire+create both done) still
  // gets repointed; see `runRepointPass`'s own doc above for why this is safe to call here too.
  await runRepointPass({ run });
  await saveRunSnapshot({ run, phase: "failed", finishedAt: clockNowIso({ clock: run.input.clock }) });
  await saveFailureAudit({ run, error, rollbackErrors });
  throw transactional ? error : withRefusedItem({
    error,
    itemKey: progress.activeItemKey,
    isPluginHookFailure: (candidate): candidate is PluginHookFailedError => candidate instanceof PluginHookFailedError,
    attachRefusedItem: (failure, refusedItemRef) => new PluginHookFailedError(failure.pluginId, failure.message, { cause: failure, refusedItemRef }),
  });
}

async function executeRows<P>({ run, ctx }: { run: ApplyRun<P>; ctx: ApplyRowContext }, _optional = {}): Promise<void> {
  const { handlerDeps } = run;
  try {
    if (run.transactional) {
      if (!handlerDeps.backstop?.rows) throw new Error("The raw-row transaction port is not wired.");
      await handlerDeps.backstop.rows.transaction({ work: () => applyRows({ run, ctx }) });
    } else await applyRows({ run, ctx });
  } catch (error) {
    await failRun({ run, error });
  }
}

/** Reports what the run did: the repoint and verification passes, the final snapshot, and the
 *  actual outcomes. */
async function closeRun<P>({ run }: { run: ApplyRun<P> }, _optional = {}): Promise<ApplyReportResult> {
  const { repointChangeSetIds, menuLinksUpdated, menuLinksNotUpdated } = await runRepointPass({ run });
  const verificationProblems = await runVerifyPass({ run });

  await saveRunSnapshot({ run, phase: "applied", finishedAt: clockNowIso({ clock: run.input.clock }) });
  return {
    report: currentReport({ run }),
    runId: run.runId,
    changeSetIds: currentChangeSetIds({ run }),
    retiredChangeSetIds: currentRetiredChangeSetIds({ run }),
    repointChangeSetIds,
    menuLinksUpdated,
    menuLinksNotUpdated,
    verificationProblems,
  };
}

/** Applies a report: loads its bundle, opens the run row, writes row by row (or in one transaction for
 *  a send by hand), and closes the run with the repoint and verification passes. */
export async function applyPublishContentReport<P>(
  { input, report, principalId, bundleId, restorePointId, authorize, backstop }: { input: CreatePublishContentApplyPortInput<P> } & ApplyReportInput,
  _optional = {}
): Promise<ApplyReportResult> {
  const startedAt = clockNowIso({ clock: input.clock });
  const staged = await loadStagedBundle({ input, bundleId, startedAt });
  const identity: ApplyRunIdentity = { runId: input.idGen.newId(), startedAt, sourcePrincipalId: staged.sourcePrincipalId, principalId, restorePointId };
  if (report.refused) return abandonRefusedRun({ input, identity, report });

  const run = await openRun({ input, identity, staged, report, authorize, backstop });
  await executeRows({ run, ctx: applyRowContext({ run }) });
  return closeRun({ run });
}

/** Match each audited item to the inverse captured by its gateway mutation. */
function backstopAuditItems(
  { items, inverses }: { items: BackstopAuditRecord["items"]; inverses: readonly BackstopInverse[] | undefined },
  _optional = {},
): BackstopAuditRecord["items"] {
  return items.map((item) => {
    const inverse = inverses?.find((candidate) => candidate.entity.id === item.id && candidate.entity.entityType === item.entityType);
    if (!inverse) return item;
    let beforeHash: string | null = null;
    if (inverse.kind === "raw-row") {
      if (inverse.before !== null) beforeHash = contentHash({ entityType: "raw-row", state: inverse.before as unknown as Record<string, unknown> });
    } else {
      if (inverse.before.sha256 !== null) beforeHash = contentHash({ entityType: "raw-file", state: {
        path: item.id, sha256: inverse.before.sha256, size: inverse.before.size, mode: inverse.before.mode,
      } });
    }
    return { ...item, beforeHash };
  });
}

/** Verification reports a problem after committed writes; it never aborts the published run. */
async function verifyPublishedEntities(
  { handler, entities }: { handler: PublishContentHandler; entities: readonly PackedEntity[] },
  _optional = {},
): Promise<readonly string[]> {
  try {
    if (!handler.verifyApplied) throw new Error("Publish content handler has no verification operation");
    return await handler.verifyApplied({ entities });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [`${capitalize({ value: handler.entityType })} could not be checked after publishing: ${message}`];
  }
}
