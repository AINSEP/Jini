import { encodeSearchKey, type SearchProvider, type SearchRevisionState } from './contract.js';
import { type SearchIndexer } from './api.js';
import { type SearchIndexStatePort, type SearchIndexStateRow, type SearchIndexStatus, type SearchTarget } from './ports.js';
import { type SearchIndexerRequired } from './indexer.js';
import { type Resolved, type Settle, guarded, chunks, type createIndexerResolve, type createIndexerWriteToTarget, type createIndexerCurrentTargets } from './indexer-write.js';
import { type createIndexerDropRetired } from './indexer-backfill.js';

const RECONCILE_STATUSES: readonly SearchIndexStatus[] = ['pending', 'unknown', 'failed'];
/** Compare-and-swap a settled row against the identity the caller observed (see `settle`). */
  
export function createIndexerSettleObserved({ state }: { state: SearchIndexStatePort }) {
  return (row: SearchIndexStateRow, settled: SearchIndexStateRow) =>
    state.settle({ row: settled, expected: { revision: row.revision, taskId: row.taskId ?? null } });
}
export function createIndexerSettledRow({ now }: { now: SearchIndexerRequired['now'] }) {
  return (row: SearchIndexStateRow, settle: Settle): SearchIndexStateRow => ({
    target: row.target, key: row.key, revision: row.revision, deleted: row.deleted, attempts: row.attempts,
    status: settle.status, updatedAtMs: now(),
    ...(settle.lastError === undefined ? {} : { lastError: settle.lastError }),
  });
}

/**
   * Ask an async provider how an earlier `pending` write ended. 1 when it is now indexed. The settle
   * only lands while the row still holds this revision AND this task: an event that wrote a newer
   * revision while the task was awaited keeps its own pending task (and its retry) intact.
   */
  
export function createIndexerSettleTask(dependencies: () => { settleObserved: ReturnType<typeof createIndexerSettleObserved>; settledRow: ReturnType<typeof createIndexerSettledRow> }) {
  return async (row: SearchIndexStateRow, resolved: Resolved, { taskId, awaitTask }: { taskId: string; awaitTask: NonNullable<SearchProvider['awaitTask']> }): Promise<number> => {
    const { settleObserved, settledRow } = dependencies();
    const result = await guarded(() => awaitTask.call(resolved.provider, resolved.ctx, { taskId }));
    if (result.status !== 'ok' || result.value === 'pending') return 0;
    const succeeded = result.value === 'succeeded';
    const written = await settleObserved(row, settledRow(row, succeeded ? { status: 'indexed' } : { status: 'failed', lastError: 'task_failed' }));
    return succeeded && written ? 1 : 0;
  };
}

/**
   * Settle indeterminate rows by asking the provider what it holds. A row whose write landed is
   * marked indexed; anything else is returned for a re-load and re-write (never blindly marked
   * failed: an `unknown` outcome may well have happened).
   */
  
export function createIndexerCheckRevisions(dependencies: () => { checkChunk: ReturnType<typeof createIndexerCheckChunk> }) {
  return async (rows: readonly SearchIndexStateRow[], resolved: Resolved): Promise<{ settled: number; rewrite: SearchIndexStateRow[] }> => {
    const { checkChunk } = dependencies();
    let settled = 0;
    const rewrite: SearchIndexStateRow[] = [];
    for (const chunk of chunks(rows, Math.max(1, resolved.provider.capabilities.maxBatch))) {
      const checked = await checkChunk(chunk, resolved);
      settled += checked.settled;
      rewrite.push(...checked.rewrite);
    }
    return { settled, rewrite };
  };
}

/** One `revisionOf` call's worth of {@link checkRevisions}; an indeterminate answer leaves the rows as they are. */
  
export function createIndexerCheckChunk(dependencies: () => { settleObserved: ReturnType<typeof createIndexerSettleObserved>; settledRow: ReturnType<typeof createIndexerSettledRow> }) {
  return async (chunk: readonly SearchIndexStateRow[], resolved: Resolved): Promise<{ settled: number; rewrite: SearchIndexStateRow[] }> => {
    const { settleObserved, settledRow } = dependencies();
    const result = await guarded(() => resolved.provider.revisionOf(resolved.ctx, { keys: chunk.map(row => row.key) }));
    if (result.status !== 'ok') return { settled: 0, rewrite: [] };
    const held = new Map(result.value.map(entry => [encodeSearchKey({ key: entry.key }), entry]));
    let settled = 0;
    const rewrite: SearchIndexStateRow[] = [];
    for (const row of chunk) {
      if (!hasLanded(held.get(encodeSearchKey({ key: row.key })), row)) { rewrite.push(row); continue; }
      if (await settleObserved(row, settledRow(row, { status: 'indexed' }))) settled += 1;
    }
    return { settled, rewrite };
  };
}

/** `pending` rows with a task are awaited; `unknown` rows (and a `pending` row whose process died
   * between marking and the call, so it has no task) are checked with `revisionOf`. */
  
export function createIndexerSettleInFlight(dependencies: () => { settleTask: ReturnType<typeof createIndexerSettleTask>; checkRevisions: ReturnType<typeof createIndexerCheckRevisions> }) {
  return async (rows: readonly SearchIndexStateRow[], resolved: Resolved): Promise<{ settled: number; rewrite: SearchIndexStateRow[] }> => {
    const { settleTask, checkRevisions } = dependencies();
    const { awaitTask } = resolved.provider;
    let settled = 0;
    const check: SearchIndexStateRow[] = [];
    for (const row of rows) {
      if (row.status === 'pending' && row.taskId !== undefined && awaitTask) settled += await settleTask(row, resolved, { taskId: row.taskId, awaitTask });
      else check.push(row);
    }
    const checked = await checkRevisions(check, resolved);
    return { settled: settled + checked.settled, rewrite: checked.rewrite };
  };
}

/** Re-load the row's document from its source and write the current truth again (a retry). */
  
export function createIndexerRewriteRow({ sources, now }: { sources: SearchIndexerRequired['sources']; now: SearchIndexerRequired['now'] }, dependencies: () => { settleObserved: ReturnType<typeof createIndexerSettleObserved>; writeToTarget: ReturnType<typeof createIndexerWriteToTarget>; settledRow: ReturnType<typeof createIndexerSettledRow> }) {
  return async (row: SearchIndexStateRow, workspaceId: string): Promise<number> => {
    const { settleObserved, writeToTarget, settledRow } = dependencies();
    const source = sources.find(candidate => candidate.collection === row.key.collection);
    if (!source) {
      await settleObserved(row, { ...settledRow(row, { status: 'failed', lastError: 'no_source' }), attempts: row.attempts + 1 });
      return 0;
    }
    const record = await source.load({ siteId: row.target.siteId, workspaceId: row.key.workspaceId, documentId: row.key.documentId, occurredAtMs: now() });
    return (await writeToTarget({ target: row.target, workspaceId, records: [record], retry: true })).indexed;
  };
}

export function createIndexerReconcileTarget({ state, maxAttempts }: { state: SearchIndexStatePort; maxAttempts: number }, dependencies: () => { resolve: ReturnType<typeof createIndexerResolve>; settleInFlight: ReturnType<typeof createIndexerSettleInFlight>; rewriteRow: ReturnType<typeof createIndexerRewriteRow> }) {
  return async (target: SearchTarget, workspaceId: string, limit: number): Promise<number> => {
    const { resolve, settleInFlight, rewriteRow } = dependencies();
    // Exhausted failures are excluded before the limit, or the oldest of them would fill every sweep.
    const rows = await state.listByStatus({ target, statuses: RECONCILE_STATUSES, limit }, { failedBelowAttempts: maxAttempts });
    const retry = rows.filter(row => row.status === 'failed' && row.attempts < maxAttempts);
    const inFlight = rows.filter(row => row.status !== 'failed');
    const resolved = inFlight.length === 0 ? null : await resolve(target, workspaceId);
    // Without a provider nothing in flight can be checked; those rows wait for configuration.
    const inFlightResult = resolved ? await settleInFlight(inFlight, resolved) : { settled: 0, rewrite: [] };
    let settled = inFlightResult.settled;
    for (const row of [...inFlightResult.rewrite, ...retry]) settled += await rewriteRow(row, workspaceId);
    return settled;
  };
}
export function createIndexerReconcile({ state }: { state: SearchIndexStatePort }, dependencies: () => { currentTargets: ReturnType<typeof createIndexerCurrentTargets>; reconcileTarget: ReturnType<typeof createIndexerReconcileTarget>; dropRetired: ReturnType<typeof createIndexerDropRetired> }): SearchIndexer['reconcile'] {
  const operation: SearchIndexer['reconcile'] = async ({ siteId, workspaceId }, { limit = 50 } = {}) => {
    const { currentTargets, reconcileTarget, dropRetired } = dependencies();
      // Retries the index drop of every replaced generation not yet confirmed gone.
      await dropRetired(siteId, workspaceId);
      const list = await currentTargets(siteId);
      let settled = 0;
      for (const target of list) settled += await reconcileTarget(target, workspaceId, limit);
      let remaining = 0;
      for (const target of list) {
        const counts = await state.counts({ target });
        remaining += counts.pending + counts.unknown + counts.failed;
      }
      return { settled, remaining };
    };
  return operation;
}
/** Whether the provider holds this row's write: its revision or a newer one, with the same deletion state. */
function hasLanded(entry: SearchRevisionState | undefined, row: SearchIndexStateRow): boolean {
  return entry !== undefined && entry.revision !== null && entry.revision >= row.revision && entry.deleted === row.deleted;
}
