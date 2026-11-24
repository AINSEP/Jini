import { type Clock as ClockPort, type IdGenerator as IdGeneratorPort } from "@jini-ai/core/primitives";

import type { BackstopAuditRecord } from "../transfer/index.js";
import type { PublishContentBaselineRepoPort } from "./baseline-repo.js";
import type { PublishContentBundleRepoPort } from "../transfer/index.js";
import { entityKey } from "./plan-rows.js";
import type { PublishContentOutcomeRow, PublishContentReport } from "./plan-rows.js";
import type { PublishContentRunItemState, PublishContentRunRepoPort, PublishContentRunRecord } from "./run-repo.js";
import type { PublishContentSeedHashFn } from "./seed-hash.js";
import type { PackedEntity } from "../transfer/index.js";
import type { PublishContentDeps, PublishContentHandler } from "./type-registry.js";

export interface CreatePublishContentApplyPortInput<P> {
  readonly workspaceId: string;
  readonly bundleRepo: PublishContentBundleRepoPort;
  readonly baselineRepo: PublishContentBaselineRepoPort;
  readonly runRepo: PublishContentRunRepoPort;
  /** Must include `changeSets`/`authorize` populated — this factory is the one caller responsible
   *  for supplying them (`features/post/publish-content.ts`'s `apply()` throws loudly if they are
   *  missing when it is actually reached). Composition roots build this through
   *  {@link toPublishContentApplyDeps}, which makes the completeness requirement a compile-time one;
   *  the parameter itself stays the wider {@link PublishContentDeps} so focused apply-loop tests can
   *  still supply only the ports the type under test actually reads. */
  readonly publishContentDeps: PublishContentDeps<P>;
  readonly clock: ClockPort;
  readonly idGen: IdGeneratorPort;
  /** D1 — the SAME seed-version lookup the plan was built with (`seed-hash.ts`). The apply-time
   *  re-verification below must accept the seed as a virtual baseline exactly where the planner
   *  did, or every seed-matched `applied` row is silently downgraded to `conflict` at execute.
   *  Omitted means "no seed", the pre-D1 behaviour; both composition roots pass
   *  `RouteDeps.publishContentSeedHash`. */
  readonly getSeedHash?: PublishContentSeedHashFn;
}

/** The ids and principals that name one `applyReport` call: fixed before anything is written. */
export interface ApplyRunIdentity {
  readonly runId: string;
  readonly startedAt: string;
  readonly sourcePrincipalId: string;
  readonly principalId: string;
  readonly restorePointId: string;
}

/** The ONE owner of what an `applyReport` call mutates. Written only by the steps that say so:
 *  `prepareRunAudit` (`report`, `auditRecord`), `initializeRunItems`, `recordContentApplied`,
 *  `recordRowOutcome` (`activeItemKey`, `effectiveRowsByKey`, `itemByKey`), `recordRawRollback` and
 *  `recordFailedItem`. */
export interface RunProgress {
  report: PublishContentReport;
  readonly effectiveRowsByKey: Map<string, PublishContentOutcomeRow>;
  readonly itemByKey: Map<string, PublishContentRunItemState>;
  auditRecord: BackstopAuditRecord | undefined;
  activeItemKey: string | null;
}

/** One `applyReport` call: what is fixed for the call, plus its {@link RunProgress}. */
export interface ApplyRun<P> extends ApplyRunIdentity {
  readonly input: CreatePublishContentApplyPortInput<P>;
  readonly entities: readonly PackedEntity[];
  readonly entityByKey: ReadonlyMap<string, PackedEntity>;
  readonly handlerDeps: PublishContentDeps<P>;
  readonly handlerByType: ReadonlyMap<string, PublishContentHandler>;
  /** Only a raw-row/raw-file run is all-or-nothing; every other run writes row by row, so an abort
   *  leaves the rows before it saved. */
  readonly transactional: boolean;
  readonly progress: RunProgress;
}

export async function saveRunRecord<P>(
  { input, identity, fields }: {
    input: CreatePublishContentApplyPortInput<P>;
    identity: ApplyRunIdentity;
    fields: {
      phase: PublishContentRunRecord["phase"];
      changeSetIds: readonly string[];
      report: PublishContentReport;
      items: readonly PublishContentRunItemState[];
      finishedAt: string | null;
    };
  },
  _optional = {}
): Promise<void> {
  await input.runRepo.save({ record: {
    id: identity.runId,
    workspaceId: input.workspaceId,
    direction: "import",
    peerPrincipalId: identity.sourcePrincipalId,
    peerLabel: null,
    phase: fields.phase,
    restorePointId: identity.restorePointId,
    changeSetIdsJson: JSON.stringify(fields.changeSetIds),
    actorId: identity.principalId,
    startedAt: identity.startedAt,
    finishedAt: fields.finishedAt,
    reportJson: JSON.stringify(fields.report),
    itemsJson: JSON.stringify(fields.items),
  } });
}

export function runItemStates<P>({ run }: { run: ApplyRun<P> }, _optional = {}): PublishContentRunItemState[] {
  return run.progress.report.rows.map((row) => {
    const item = run.progress.itemByKey.get(entityKey({ entityType: row.entityType, entityId: row.entityId }));
    if (item === undefined) throw new Error(`Publish content run has no state for ${row.entityType} ${row.entityId}`);
    return item;
  });
}

export function currentChangeSetIds<P>({ run }: { run: ApplyRun<P> }, _optional = {}): string[] {
  return Array.from(
    new Set(runItemStates({ run }).flatMap((item) => (item.changeSetId === null ? [] : [item.changeSetId])))
  );
}

export function currentRetiredChangeSetIds<P>({ run }: { run: ApplyRun<P> }, _optional = {}): string[] {
  return runItemStates({ run }).flatMap((item) => (item.retiredChangeSetId === null ? [] : [item.retiredChangeSetId]));
}

export function currentReport<P>({ run }: { run: ApplyRun<P> }, _optional = {}): PublishContentReport {
  const { report, effectiveRowsByKey } = run.progress;
  return {
    ...report,
    rows: report.rows.map((row) => effectiveRowsByKey.get(entityKey({ entityType: row.entityType, entityId: row.entityId })) ?? row),
  };
}

export async function saveRunSnapshot<P>(
  { run, phase, finishedAt }: { run: ApplyRun<P>; phase: PublishContentRunRecord["phase"]; finishedAt: string | null },
  _optional = {}
): Promise<void> {
  await saveRunRecord({
    input: run.input,
    identity: run,
    fields: {
      phase,
      changeSetIds: currentChangeSetIds({ run }),
      report: currentReport({ run }),
      items: runItemStates({ run }),
      finishedAt,
    },
  });
}
