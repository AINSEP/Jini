/**
 * @file The ONE writer of every search index (lot S3).
 *
 * Event path: a host domain event only NAMES a document; the indexer re-`load`s it from its source
 * and writes the current truth (a document or a versioned tombstone) to every current target of the
 * site — the active one and, during a rebuild or provider switch, the building one. Background path:
 * `reconcile` settles indeterminate writes and retries failed ones (bounded), `backfill` scans every
 * source into the building target behind a resumable watermark and flips it active with a CAS.
 *
 * Bookkeeping lives in the host's {@link SearchIndexStatePort}; the indexer is its only writer.
 * Errors from host ports propagate so the caller's outbox/job retries; providers never throw by
 * contract, and a provider that throws anyway is treated as an indeterminate (`unknown`) outcome.
 */
import { type ProviderRegistry } from '@jini-ai/core/provider-registry';
import { type SearchProvider, type SearchProviderContext } from './contract.js';
import { type SearchIndexer } from './api.js';
import { type SearchDocumentSource, type SearchIndexStatePort, type SearchSourceEvent, type SearchTarget, type SearchTargetPort } from './ports.js';
import { createIndexerResolve, createIndexerPlanRow, createIndexerPutPlan, createIndexerFreshRecords, createIndexerSettleCall, createIndexerWriteChunks, createIndexerWriteToTarget, createIndexerCurrentTargets } from './indexer-write.js';
import { createIndexerSettleObserved, createIndexerSettledRow, createIndexerSettleTask, createIndexerCheckRevisions, createIndexerCheckChunk, createIndexerSettleInFlight, createIndexerRewriteRow, createIndexerReconcileTarget, createIndexerReconcile } from './indexer-reconcile.js';
import { createIndexerScanSource, createIndexerPromote, createIndexerDropRetired, createIndexerBackfillTarget, createIndexerReadMarks, createIndexerBackfill, createIndexerStartRebuild } from './indexer-backfill.js';

export interface SearchIndexerRequired {
  readonly sources: readonly SearchDocumentSource[];
  readonly registry: ProviderRegistry<SearchProvider>;
  readonly targets: SearchTargetPort;
  readonly state: SearchIndexStatePort;
  resolveSiteId(required: { readonly workspaceId: string }): Promise<string | null>;
  contextFor(required: { readonly target: SearchTarget; readonly workspaceId: string }): Promise<SearchProviderContext | null>;
  now(): number;
}

export interface SearchIndexerOptional {
  /** Write attempts per key and revision before `reconcile` stops retrying a `failed` row. */
  readonly maxAttempts?: number;
  /** Records requested per `scan` page during backfill. */
  readonly scanPageSize?: number;
}
/**
 * Build the single-writer indexer.
 * @param required - Sources, provider registry and the host's target/state/site/context ports.
 * @param optional.maxAttempts - Retry bound for `failed` rows (default 5).
 * @param optional.scanPageSize - Backfill page size (default 100).
 * @returns The {@link SearchIndexer} the composition root wires to its bus and background job.
 * @complexity handleEvent O(targets · state lookups); reconcile O(limit) per target; backfill
 *   O(pageBudget · scanPageSize).
 */
export function createSearchIndexer(required: SearchIndexerRequired, optional: SearchIndexerOptional = {}): SearchIndexer {
  const { sources, registry, targets, state, now } = required;
  const { maxAttempts = 5, scanPageSize = 100 } = optional;
  const resolve = createIndexerResolve({ required, registry });
  const planRow = createIndexerPlanRow({ now });
  const putPlan = createIndexerPutPlan({ state }, () => ({ planRow }));
  const settleObserved = createIndexerSettleObserved({ state });
  const freshRecords = createIndexerFreshRecords({ state });
  const settleCall = createIndexerSettleCall({ state }, () => ({ planRow }));
  const writeChunks = createIndexerWriteChunks(() => ({ settleCall }));
  const writeToTarget = createIndexerWriteToTarget(() => ({ resolve, putPlan, freshRecords, writeChunks }));
  const currentTargets = createIndexerCurrentTargets({ targets });
  const settledRow = createIndexerSettledRow({ now });
  const settleTask = createIndexerSettleTask(() => ({ settleObserved, settledRow }));
  const checkRevisions = createIndexerCheckRevisions(() => ({ checkChunk }));
  const checkChunk = createIndexerCheckChunk(() => ({ settleObserved, settledRow }));
  const settleInFlight = createIndexerSettleInFlight(() => ({ settleTask, checkRevisions }));
  const rewriteRow = createIndexerRewriteRow({ sources, now }, () => ({ settleObserved, writeToTarget, settledRow }));
  const reconcileTarget = createIndexerReconcileTarget({ state, maxAttempts }, () => ({ resolve, settleInFlight, rewriteRow }));
  const scanSource = createIndexerScanSource({ state, scanPageSize }, () => ({ writeToTarget }));
  const promote = createIndexerPromote({ targets, state }, () => ({ dropRetired }));
  const dropRetired = createIndexerDropRetired({ targets, state }, () => ({ resolve }));
  const backfillTarget = createIndexerBackfillTarget({ sources }, () => ({ scanSource }));
  const readMarks = createIndexerReadMarks({ sources, state });

  return {
    eventNames: [...new Set(sources.flatMap(source => source.events))],

    handleEvent: createIndexerHandleEvent({ required, sources }, () => ({ writeToTarget, currentTargets })),

    reconcile: createIndexerReconcile({ state }, () => ({ currentTargets, reconcileTarget, dropRetired })),

    backfill: createIndexerBackfill({ targets }, () => ({ resolve, promote, backfillTarget, readMarks })),

    startRebuild: createIndexerStartRebuild({ targets }),
  };
}

function createIndexerHandleEvent({ required, sources }: { required: SearchIndexerRequired; sources: SearchIndexerRequired['sources'] }, dependencies: () => { writeToTarget: ReturnType<typeof createIndexerWriteToTarget>; currentTargets: ReturnType<typeof createIndexerCurrentTargets> }): SearchIndexer['handleEvent'] {
  const operation: SearchIndexer['handleEvent'] = async ({ event }: { event: SearchSourceEvent }) => {
    const { writeToTarget, currentTargets } = dependencies();
      const named = sources.flatMap(source => {
        if (!source.events.includes(event.name)) return [];
        const documentId = source.documentIdOf({ event });
        return documentId === null ? [] : [{ source, documentId }];
      });
      if (named.length === 0) return;
      const siteId = await required.resolveSiteId({ workspaceId: event.workspaceId });
      if (siteId === null) return;
      // Active AND building: that plus the backfill's watermark scan is the catch-up guarantee —
      // a document changed mid-rebuild is either scanned later or written here, never missed.
      const list = await currentTargets(siteId);
      if (list.length === 0) return;
      const occurredAtMs = Date.parse(event.occurredAt);
      for (const { source, documentId } of named) {
        const record = await source.load({ siteId, workspaceId: event.workspaceId, documentId, occurredAtMs });
        for (const target of list) await writeToTarget({ target, workspaceId: event.workspaceId, records: [record], retry: false });
      }
    };
  return operation;
}

