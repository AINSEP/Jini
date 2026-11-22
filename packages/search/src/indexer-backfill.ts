import { type SearchIndexer } from './api.js';
import { type SearchDocumentSource, type SearchIndexStatePort, type SearchTarget, type SearchTargetPort } from './ports.js';
import type { SearchIndexerRequired } from './indexer.js';
import { guarded, type createIndexerResolve, type createIndexerWriteToTarget } from './indexer-write.js';

type Watermark = Awaited<ReturnType<SearchIndexStatePort['getWatermark']>>;
/** Scan one source from its watermark, writing each page; the watermark moves after EVERY page. */
  
export function createIndexerScanSource({ state, scanPageSize }: { state: SearchIndexStatePort; scanPageSize: number }, dependencies: () => { writeToTarget: ReturnType<typeof createIndexerWriteToTarget> }) {
  return async (input: { source: SearchDocumentSource; target: SearchTarget; siteId: string; workspaceId: string; cursor: string | undefined; pages: number }) => {
    const { writeToTarget } = dependencies();
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
}

/**
   * Flip building→active once nothing is in flight. Partial `failed` rows do not block: they would
   * block forever, and reconcile keeps retrying them against the new active target. If every write
   * failed, keep the old generation serving queries until a retry succeeds. It is dropped only
   * after the atomic flip.
   */
  
export function createIndexerPromote({ targets, state }: { targets: SearchTargetPort; state: SearchIndexStatePort }, dependencies: () => { dropRetired: ReturnType<typeof createIndexerDropRetired> }) {
  return async (siteId: string, workspaceId: string, target: SearchTarget): Promise<boolean> => {
    const { dropRetired } = dependencies();
    const counts = await state.counts({ target });
    if (counts.pending + counts.unknown > 0) return false;
    if (counts.indexed === 0 && counts.failed > 0) return false;
    const flipped = await targets.promote({ siteId, expected: target });
    if (flipped === false) return false;
    await dropRetired(siteId, workspaceId);
    return true;
  };
}

/**
   * Drop every retired (replaced) generation of a site. The bookkeeping rows are deleted either
   * way, since a replaced target is never written or read again. The vendor index can be dropped
   * only while its provider is registered and configured (nothing else can reach it), and the
   * retired record is forgotten only once the drop is CONFIRMED (`ok`): a refusal, an indeterminate
   * outcome, a missing credential or an unregistered provider leaves it for the next reconcile,
   * instead of leaving the old content in the vendor index forever.
   */
  
export function createIndexerDropRetired({ targets, state }: { targets: SearchTargetPort; state: SearchIndexStatePort }, dependencies: () => { resolve: ReturnType<typeof createIndexerResolve> }) {
  return async (siteId: string, workspaceId: string): Promise<void> => {
    const { resolve } = dependencies();
    for (const retired of await targets.listRetired({ siteId })) {
      await state.deleteTarget({ target: retired });
      const resolved = await resolve(retired, workspaceId);
      const dropped = resolved ? await guarded(() => resolved.provider.dropIndex(resolved.ctx)) : null;
      if (dropped?.status === 'ok') await targets.forgetRetired({ target: retired });
    }
  };
}

export function createIndexerBackfillTarget({ sources }: { sources: SearchIndexerRequired['sources'] }, dependencies: () => { scanSource: ReturnType<typeof createIndexerScanSource> }) {
  return async (input: { siteId: string; workspaceId: string; target: SearchTarget; pageBudget: number; marks: readonly Watermark[] }): Promise<{ done: boolean; written: number }> => {
    const { scanSource } = dependencies();
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
}

export function createIndexerReadMarks({ sources, state }: { sources: SearchIndexerRequired['sources']; state: SearchIndexStatePort }) {
  return async (target: SearchTarget): Promise<Watermark[]> => {
    const marks: Watermark[] = [];
    for (const source of sources) marks.push(await state.getWatermark({ target, collection: source.collection }));
    return marks;
  };
}
export function createIndexerBackfill({ targets }: { targets: SearchTargetPort }, dependencies: () => { resolve: ReturnType<typeof createIndexerResolve>; promote: ReturnType<typeof createIndexerPromote>; backfillTarget: ReturnType<typeof createIndexerBackfillTarget>; readMarks: ReturnType<typeof createIndexerReadMarks> }): SearchIndexer['backfill'] {
  const operation: SearchIndexer['backfill'] = async ({ siteId, workspaceId }, { pageBudget = 10 } = {}) => {
    const { resolve, promote, backfillTarget, readMarks } = dependencies();
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
    };
  return operation;
}

export function createIndexerStartRebuild({ targets }: { targets: SearchTargetPort }): SearchIndexer['startRebuild'] {
  const operation: SearchIndexer['startRebuild'] = async ({ siteId, providerId }) => {
      const current = await targets.get({ siteId });
      const generation = Math.max(current.active?.generation ?? 0, current.building?.generation ?? 0) + 1;
      await targets.setBuilding({ target: { siteId, providerId, generation } });
      return targets.get({ siteId });
    };
  return operation;
}
