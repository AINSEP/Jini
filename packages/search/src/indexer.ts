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
import { providerUnknown, type ProviderRegistry, type ProviderResult } from '@jini-ai/core/provider-registry';
import { encodeSearchKey, type SearchDocument, type SearchProvider, type SearchProviderContext, type SearchTombstone, type SearchWriteResult, type SearchWriteStatus } from './contract.js';
import type { SearchIndexer } from './api.js';
import type { SearchDocumentSource, SearchIndexStatePort, SearchIndexStateRow, SearchIndexStatus, SearchSiteTargets, SearchSourceEvent, SearchSourceRecord, SearchTarget, SearchTargetPort } from './ports.js';

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

/** The lastError recorded when a target's provider is not registered or has no context. */
export const SEARCH_NOT_CONFIGURED = 'not_configured';

const RECONCILE_STATUSES: readonly SearchIndexStatus[] = ['pending', 'unknown', 'failed'];
const OUTCOME_STATUS: Readonly<Record<SearchWriteStatus, SearchIndexStatus>> = {
  applied: 'indexed',
  // The provider already holds an equal or newer revision: nothing is left to do for this key.
  stale: 'indexed',
  pending: 'pending',
  rejected: 'failed',
};

interface Resolved { readonly provider: SearchProvider; readonly ctx: SearchProviderContext }
interface Plan { readonly record: SearchSourceRecord; readonly attempts: number; readonly upsert: boolean }
interface Settle { readonly status: SearchIndexStatus; readonly taskId?: string; readonly lastError?: string }
interface WriteTally { readonly written: number; readonly indexed: number }
type Watermark = Awaited<ReturnType<SearchIndexStatePort['getWatermark']>>;

/** Run one provider call; a provider that throws despite the contract becomes an `unknown`. */
async function guarded<T>(call: () => Promise<ProviderResult<T>>): Promise<ProviderResult<T>> {
  try {
    return await call();
  } catch {
    return providerUnknown({ code: 'unexpected_response', message: 'search provider threw' });
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function targetList(targets: SearchSiteTargets): SearchTarget[] {
  return [targets.active, targets.building].filter((target): target is SearchTarget => target !== null);
}

/**
 * Upsert only a document the target's provider may hold. Vendors are public-only, so a restricted
 * document, a draft, a trashed or a not-yet-live record all become a REMOVAL there: a public→members
 * change must delete the document from the vendor, not update it in place.
 */
function shouldUpsert(record: SearchSourceRecord, provider: SearchProvider): boolean {
  const { document } = record;
  if (document === null) return false;
  return document.visibility.kind === 'public' || provider.capabilities.acceptsRestricted;
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

  const resolve = async (target: SearchTarget, workspaceId: string): Promise<Resolved | null> => {
    const provider = registry.get({ id: target.providerId })?.provider;
    if (!provider) return null;
    const ctx = await required.contextFor({ target, workspaceId });
    return ctx ? { provider, ctx } : null;
  };

  const planRow = (target: SearchTarget, plan: Plan, settle: Settle): SearchIndexStateRow => ({
    target, key: plan.record.key, revision: plan.record.revision, deleted: !plan.upsert,
    status: settle.status, attempts: plan.attempts, updatedAtMs: now(),
    ...(settle.taskId === undefined ? {} : { taskId: settle.taskId }),
    ...(settle.lastError === undefined ? {} : { lastError: settle.lastError }),
  });

  const putPlan = (target: SearchTarget, plan: Plan, settle: Settle) => state.put({ row: planRow(target, plan, settle) });

  /** Compare-and-swap a settled row against the identity the caller observed (see `settle`). */
  const settleObserved = (row: SearchIndexStateRow, settled: SearchIndexStateRow) =>
    state.settle({ row: settled, expected: { revision: row.revision, taskId: row.taskId ?? null } });

  /**
   * Records worth writing, each with its attempt number. An event/backfill write is skipped when
   * the row already holds an equal or newer revision (a delayed or duplicated event); a retry only
   * skips an OLDER revision, because retrying the same revision is the point of a retry.
   */
  const freshRecords = async (target: SearchTarget, records: readonly SearchSourceRecord[], retry: boolean) => {
    const fresh: { record: SearchSourceRecord; attempts: number }[] = [];
    for (const record of records) {
      const prior = await state.get({ target, key: record.key });
      const skip = prior !== null && (retry ? prior.revision > record.revision : prior.revision >= record.revision);
      if (skip) continue;
      const attempts = (prior !== null && prior.revision === record.revision ? prior.attempts : 0) + 1;
      fresh.push({ record, attempts });
    }
    return fresh;
  };

  /**
   * Map one write call's result onto its plans' rows; returns how many ended `indexed`. Each settle
   * is a compare-and-swap on the `pending` mark this write made (its revision, no task): a newer
   * revision written meanwhile owns the row and is never overwritten by this older completion.
   */
  const settleCall = async (target: SearchTarget, plans: readonly Plan[], result: ProviderResult<SearchWriteResult>): Promise<number> => {
    let indexed = 0;
    for (const plan of plans) {
      const settle = settleOf(plan, result);
      const written = await state.settle({ row: planRow(target, plan, settle), expected: { revision: plan.record.revision, taskId: null } });
      if (written && settle.status === 'indexed') indexed += 1;
    }
    return indexed;
  };

  const writeChunks = async <T>(input: { target: SearchTarget; plans: readonly Plan[]; maxBatch: number; payload: (plan: Plan) => T; call: (items: T[]) => Promise<ProviderResult<SearchWriteResult>> }): Promise<number> => {
    let indexed = 0;
    for (const chunk of chunks(input.plans, input.maxBatch)) {
      const result = await guarded(() => input.call(chunk.map(input.payload)));
      indexed += await settleCall(input.target, chunk, result);
    }
    return indexed;
  };

  /** Write records to ONE target: mark pending, call the provider in batches, settle each row. */
  const writeToTarget = async (input: { target: SearchTarget; workspaceId: string; records: readonly SearchSourceRecord[]; retry: boolean }): Promise<WriteTally> => {
    const { target } = input;
    const fresh = await freshRecords(target, input.records, input.retry);
    if (fresh.length === 0) return { written: 0, indexed: 0 };
    const resolved = await resolve(target, input.workspaceId);
    if (!resolved) {
      // No provider call is possible; the row records why so `status` can show it.
      for (const item of fresh) await putPlan(target, { ...item, upsert: item.record.document !== null }, { status: 'failed', lastError: SEARCH_NOT_CONFIGURED });
      return { written: fresh.length, indexed: 0 };
    }
    const { provider, ctx } = resolved;
    const plans: Plan[] = fresh.map(item => ({ ...item, upsert: shouldUpsert(item.record, provider) }));
    for (const plan of plans) await putPlan(target, plan, { status: 'pending' });
    const maxBatch = Math.max(1, provider.capabilities.maxBatch);
    const upserted = await writeChunks({
      target, maxBatch, plans: plans.filter(plan => plan.upsert),
      payload: plan => plan.record.document as SearchDocument,
      call: documents => provider.upsert(ctx, { documents }),
    });
    const removed = await writeChunks({
      target, maxBatch, plans: plans.filter(plan => !plan.upsert),
      payload: (plan): SearchTombstone => ({ key: plan.record.key, revision: plan.record.revision }),
      call: tombstones => provider.remove(ctx, { tombstones }),
    });
    return { written: plans.length, indexed: upserted + removed };
  };

  const currentTargets = async (siteId: string) => targetList(await targets.get({ siteId }));

  const settledRow = (row: SearchIndexStateRow, settle: Settle): SearchIndexStateRow => ({
    target: row.target, key: row.key, revision: row.revision, deleted: row.deleted, attempts: row.attempts,
    status: settle.status, updatedAtMs: now(),
    ...(settle.lastError === undefined ? {} : { lastError: settle.lastError }),
  });

  /**
   * Ask an async provider how an earlier `pending` write ended. 1 when it is now indexed. The settle
   * only lands while the row still holds this revision AND this task: an event that wrote a newer
   * revision while the task was awaited keeps its own pending task (and its retry) intact.
   */
  const settleTask = async (row: SearchIndexStateRow, taskId: string, resolved: Resolved, awaitTask: NonNullable<SearchProvider['awaitTask']>): Promise<number> => {
    const result = await guarded(() => awaitTask.call(resolved.provider, resolved.ctx, { taskId }));
    if (result.status !== 'ok' || result.value === 'pending') return 0;
    const succeeded = result.value === 'succeeded';
    const written = await settleObserved(row, settledRow(row, succeeded ? { status: 'indexed' } : { status: 'failed', lastError: 'task_failed' }));
    return succeeded && written ? 1 : 0;
  };

  /**
   * Settle indeterminate rows by asking the provider what it holds. A row whose write landed is
   * marked indexed; anything else is returned for a re-load and re-write (never blindly marked
   * failed: an `unknown` outcome may well have happened).
   */
  const checkRevisions = async (rows: readonly SearchIndexStateRow[], resolved: Resolved): Promise<{ settled: number; rewrite: SearchIndexStateRow[] }> => {
    let settled = 0;
    const rewrite: SearchIndexStateRow[] = [];
    for (const chunk of chunks(rows, Math.max(1, resolved.provider.capabilities.maxBatch))) {
      const result = await guarded(() => resolved.provider.revisionOf(resolved.ctx, { keys: chunk.map(row => row.key) }));
      if (result.status !== 'ok') continue;
      const held = new Map(result.value.map(entry => [encodeSearchKey({ key: entry.key }), entry]));
      for (const row of chunk) {
        const entry = held.get(encodeSearchKey({ key: row.key }));
        const landed = entry !== undefined && entry.revision !== null && entry.revision >= row.revision && entry.deleted === row.deleted;
        if (!landed) { rewrite.push(row); continue; }
        if (await settleObserved(row, settledRow(row, { status: 'indexed' }))) settled += 1;
      }
    }
    return { settled, rewrite };
  };

  /** `pending` rows with a task are awaited; `unknown` rows (and a `pending` row whose process died
   * between marking and the call, so it has no task) are checked with `revisionOf`. */
  const settleInFlight = async (rows: readonly SearchIndexStateRow[], resolved: Resolved): Promise<{ settled: number; rewrite: SearchIndexStateRow[] }> => {
    const { awaitTask } = resolved.provider;
    let settled = 0;
    const check: SearchIndexStateRow[] = [];
    for (const row of rows) {
      if (row.status === 'pending' && row.taskId !== undefined && awaitTask) settled += await settleTask(row, row.taskId, resolved, awaitTask);
      else check.push(row);
    }
    const checked = await checkRevisions(check, resolved);
    return { settled: settled + checked.settled, rewrite: checked.rewrite };
  };

  /** Re-load the row's document from its source and write the current truth again (a retry). */
  const rewriteRow = async (row: SearchIndexStateRow, workspaceId: string): Promise<number> => {
    const source = sources.find(candidate => candidate.collection === row.key.collection);
    if (!source) {
      await settleObserved(row, { ...settledRow(row, { status: 'failed', lastError: 'no_source' }), attempts: row.attempts + 1 });
      return 0;
    }
    const record = await source.load({ siteId: row.target.siteId, workspaceId: row.key.workspaceId, documentId: row.key.documentId, occurredAtMs: now() });
    return (await writeToTarget({ target: row.target, workspaceId, records: [record], retry: true })).indexed;
  };

  const reconcileTarget = async (target: SearchTarget, workspaceId: string, limit: number): Promise<number> => {
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

  /** Scan one source from its watermark, writing each page; the watermark moves after EVERY page. */
  const scanSource = async (input: { source: SearchDocumentSource; target: SearchTarget; siteId: string; workspaceId: string; cursor: string | undefined; pages: number }) => {
    const { source, target } = input;
    let { cursor, pages } = input;
    let written = 0;
    while (pages > 0) {
      const page = await source.scan({ siteId: input.siteId, workspaceId: input.workspaceId, limit: scanPageSize }, cursor === undefined ? {} : { cursor });
      pages -= 1;
      written += (await writeToTarget({ target, workspaceId: input.workspaceId, records: page.records, retry: false })).written;
      cursor = page.nextCursor;
      const done = cursor === undefined;
      // Persisted per page so a crash resumes here instead of rescanning the whole collection.
      await state.putWatermark({ target, collection: source.collection, done, ...(cursor === undefined ? {} : { cursor }) });
      if (done) return { done: true, written, pages };
    }
    return { done: false, written, pages };
  };

  /**
   * Flip building→active once nothing is in flight. `failed` rows do not block: they would block
   * forever, and reconcile keeps retrying them against the new active target. The old generation
   * served queries until this atomic flip, so it is dropped only after it.
   */
  const promote = async (siteId: string, workspaceId: string, target: SearchTarget): Promise<boolean> => {
    const counts = await state.counts({ target });
    if (counts.pending + counts.unknown > 0) return false;
    const flipped = await targets.promote({ siteId, expected: target });
    if (flipped === false) return false;
    await dropRetired(siteId, workspaceId);
    return true;
  };

  /**
   * Drop every retired (replaced) generation of a site. The bookkeeping rows are deleted either
   * way, since a replaced target is never written or read again. The vendor index can be dropped
   * only while its provider is registered and configured (nothing else can reach it), and the
   * retired record is forgotten only once the drop is CONFIRMED (`ok`): a refusal, an indeterminate
   * outcome, a missing credential or an unregistered provider leaves it for the next reconcile,
   * instead of leaving the old content in the vendor index forever.
   */
  const dropRetired = async (siteId: string, workspaceId: string): Promise<void> => {
    for (const retired of await targets.listRetired({ siteId })) {
      await state.deleteTarget({ target: retired });
      const resolved = await resolve(retired, workspaceId);
      const dropped = resolved ? await guarded(() => resolved.provider.dropIndex(resolved.ctx)) : null;
      if (dropped?.status === 'ok') await targets.forgetRetired({ target: retired });
    }
  };

  const backfillTarget = async (input: { siteId: string; workspaceId: string; target: SearchTarget; pageBudget: number; marks: readonly Watermark[] }): Promise<{ done: boolean; written: number }> => {
    let written = 0;
    let pages = input.pageBudget;
    for (const [index, source] of sources.entries()) {
      const mark = input.marks[index];
      if (mark?.done) continue;
      const scanned = await scanSource({ source, target: input.target, siteId: input.siteId, workspaceId: input.workspaceId, cursor: mark?.cursor, pages });
      written += scanned.written;
      pages = scanned.pages;
      if (!scanned.done) return { done: false, written };
    }
    return { done: true, written };
  };

  const readMarks = async (target: SearchTarget): Promise<Watermark[]> => {
    const marks: Watermark[] = [];
    for (const source of sources) marks.push(await state.getWatermark({ target, collection: source.collection }));
    return marks;
  };

  return {
    eventNames: [...new Set(sources.flatMap(source => source.events))],

    async handleEvent({ event }: { event: SearchSourceEvent }) {
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
    },

    async reconcile({ siteId, workspaceId }, { limit = 50 } = {}) {
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
    },

    async backfill({ siteId, workspaceId }, { pageBudget = 10 } = {}) {
      const current = await targets.get({ siteId });
      const target = current.building ?? current.active;
      if (target === null) return { done: true, written: 0, promoted: false };
      const resolved = await resolve(target, workspaceId);
      if (!resolved) return { done: false, written: 0, promoted: false };
      const marks = await readMarks(target);
      // A fresh target (no source started yet) gets its index created before the very first page.
      if (marks.every(mark => mark === null) && (await guarded(() => resolved.provider.ensureIndex(resolved.ctx))).status !== 'ok') {
        return { done: false, written: 0, promoted: false };
      }
      const { done, written } = await backfillTarget({ siteId, workspaceId, target, pageBudget, marks });
      // `target` is the building one whenever one exists; only a building target is ever promoted.
      const promoted = done && current.building !== null ? await promote(siteId, workspaceId, target) : false;
      return { done, written, promoted };
    },

    async startRebuild({ siteId, providerId }) {
      const current = await targets.get({ siteId });
      const generation = Math.max(current.active?.generation ?? 0, current.building?.generation ?? 0) + 1;
      await targets.setBuilding({ target: { siteId, providerId, generation } });
      return targets.get({ siteId });
    },
  };
}

/** One plan's row outcome from its write call's result. */
function settleOf(plan: Plan, result: ProviderResult<SearchWriteResult>): Settle {
  if (result.status === 'rejected') return { status: 'failed', lastError: result.error.message };
  // Indeterminate: the write may have happened. Reconcile asks the provider, never marks it failed.
  if (result.status === 'unknown') return { status: 'unknown', lastError: result.error.code };
  const encoded = encodeSearchKey({ key: plan.record.key });
  const outcome = result.value.outcomes.find(candidate => encodeSearchKey({ key: candidate.key }) === encoded);
  if (!outcome) return { status: 'unknown', lastError: 'missing_outcome' };
  const status = OUTCOME_STATUS[outcome.status];
  if (status === 'pending') return result.value.taskId === undefined ? { status } : { status, taskId: result.value.taskId };
  if (status === 'failed') return { status, lastError: outcome.message ?? 'rejected' };
  return { status };
}
