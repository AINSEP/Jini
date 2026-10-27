import { describe, expect, it } from 'vitest';
import { createProviderRegistry, providerOk, providerRejected, providerUnknown } from '@jini-ai/core/provider-registry';
import { encodeSearchKey, SEARCH_CONTRACT, type SearchProvider, type SearchProviderContext, type SearchWriteResult } from '../contract.js';
import { createSearchIndexer, SEARCH_NOT_CONFIGURED, type SearchIndexerOptional } from '../indexer.js';
import type { SearchDocumentSource, SearchIndexStateRow, SearchSiteTargets, SearchSourceEvent, SearchTarget } from '../ports.js';
import { contextFor, key, makeProvider, makeSource, makeState, makeTargets, record, SITE, WS, type FakeProvider } from './fakes/index.js';

const ACTIVE: SearchTarget = { siteId: SITE, providerId: 'vendor', generation: 1 };
const BUILDING: SearchTarget = { siteId: SITE, providerId: 'builtin', generation: 2 };
const OCCURRED = '2026-10-21T10:00:00.000Z';

const event = (documentId: string, overrides: Partial<SearchSourceEvent> = {}): SearchSourceEvent => ({
  name: 'post.published', workspaceId: WS, occurredAt: OCCURRED, aggregateId: documentId, payload: { collection: 'post' }, ...overrides,
});

interface SetupOptions {
  providers?: FakeProvider[];
  targets?: Partial<SearchSiteTargets>;
  sources?: SearchDocumentSource[];
  noContextFor?: string[];
  optional?: SearchIndexerOptional;
}

function setup(options: SetupOptions = {}) {
  const vendor = makeProvider({ id: 'vendor' });
  const providers = options.providers ?? [vendor];
  const registry = createProviderRegistry<SearchProvider>({ contract: SEARCH_CONTRACT });
  for (const fake of providers) registry.register({ definition: { id: fake.provider.id, provider: fake.provider } });
  const state = makeState();
  const targets = makeTargets(options.targets ?? { active: ACTIVE });
  const source = makeSource('post');
  const sources = options.sources ?? [source];
  const clock = { now: 5000 };
  const contextCalls: SearchTarget[] = [];
  const siteLookups: string[] = [];
  const fresh = () => createSearchIndexer({
    sources, registry, targets, state,
    resolveSiteId: async ({ workspaceId }) => { siteLookups.push(workspaceId); return workspaceId === WS ? SITE : null; },
    contextFor: async (r): Promise<SearchProviderContext | null> => {
      contextCalls.push(r.target);
      return options.noContextFor?.includes(r.target.providerId) ? null : contextFor(r);
    },
    now: () => clock.now,
  }, options.optional);
  const indexer = fresh();
  return { indexer, fresh, vendor, state, targets, source, registry, clock, contextCalls, siteLookups, providers };
}

const row = (overrides: Partial<SearchIndexStateRow> & { documentId?: string } = {}): SearchIndexStateRow => {
  const { documentId = 'a', ...rest } = overrides;
  return { target: ACTIVE, key: key(documentId), revision: 3, deleted: false, status: 'indexed', attempts: 1, updatedAtMs: 1, ...rest };
};

const writeOk = (value: SearchWriteResult) => async () => providerOk({ value });

describe('createSearchIndexer — eventNames', () => {
  it('is the de-duplicated union of every source\'s events', () => {
    const { indexer } = setup({ sources: [makeSource('post'), makeSource('page'), { ...makeSource('page'), collection: 'page2' }] });
    expect(indexer.eventNames).toEqual(['post.published', 'post.unpublished', 'page.published', 'page.unpublished']);
  });
});

describe('createSearchIndexer — handleEvent', () => {
  it('re-loads the named document (never the payload) and upserts a public document', async () => {
    const { indexer, vendor, state, source } = setup();
    source.records.set('a', record('a', 3));
    await indexer.handleEvent({ event: event('a', { payload: { collection: 'post', title: 'FORGED' } }) });
    expect(source.loads).toEqual([{ documentId: 'a', occurredAtMs: Date.parse(OCCURRED) }]);
    expect(vendor.calls.map(c => c.method)).toEqual(['upsert']);
    expect((vendor.calls[0]!.args as { documents: { title: string }[] }).documents[0]!.title).toBe('Title a');
    expect(state.row(ACTIVE, key('a'))).toEqual({ target: ACTIVE, key: key('a'), revision: 3, deleted: false, status: 'indexed', attempts: 1, updatedAtMs: 5000 });
  });

  it('marks the row pending before the provider call', async () => {
    const { indexer, state, source } = setup();
    source.records.set('a', record('a', 3));
    await indexer.handleEvent({ event: event('a') });
    expect(state.puts.map(p => p.status)).toEqual(['pending', 'indexed']);
  });

  it('ignores events no source subscribes to or names, without resolving the site', async () => {
    const { indexer, vendor, siteLookups } = setup();
    await indexer.handleEvent({ event: event('a', { name: 'form.submitted' }) });
    await indexer.handleEvent({ event: event('a', { payload: { collection: 'page' } }) });
    expect(siteLookups).toEqual([]);
    expect(vendor.calls).toEqual([]);
  });

  it('is a no-op for an unknown site or a site with no targets', async () => {
    const unknownSite = setup();
    await unknownSite.indexer.handleEvent({ event: event('a', { workspaceId: 'other' }) });
    expect(unknownSite.source.loads).toEqual([]);
    const noTargets = setup({ targets: {} });
    await noTargets.indexer.handleEvent({ event: event('a') });
    expect(noTargets.source.loads).toEqual([]);
  });

  it('skips a stale event whose revision the row already holds (equal or newer)', async () => {
    const { indexer, vendor, state, source } = setup();
    await state.put({ row: row({ revision: 5 }) });
    source.records.set('a', record('a', 5));
    await indexer.handleEvent({ event: event('a') });
    source.records.set('a', record('a', 4));
    await indexer.handleEvent({ event: event('a') });
    expect(vendor.calls).toEqual([]);
    expect(state.row(ACTIVE, key('a'))?.revision).toBe(5);
  });

  it('writes a restricted document to a public-only provider as a tombstone', async () => {
    const { indexer, vendor, state, source } = setup();
    source.records.set('a', record('a', 7, { restricted: true }));
    await indexer.handleEvent({ event: event('a') });
    expect(vendor.calls.map(c => c.method)).toEqual(['remove']);
    expect(vendor.calls[0]!.args).toEqual({ tombstones: [{ key: key('a'), revision: 7 }] });
    expect(state.row(ACTIVE, key('a'))).toMatchObject({ revision: 7, deleted: true, status: 'indexed' });
  });

  it('upserts a restricted document to a provider that accepts restricted content', async () => {
    const builtin = makeProvider({ id: 'builtin', acceptsRestricted: true });
    const { indexer, source } = setup({ providers: [builtin], targets: { active: { ...ACTIVE, providerId: 'builtin' } } });
    source.records.set('a', record('a', 7, { restricted: true }));
    await indexer.handleEvent({ event: event('a') });
    expect(builtin.calls.map(c => c.method)).toEqual(['upsert']);
  });

  it('removes a document from the vendor when it changes from public to members-only', async () => {
    const { indexer, vendor, source } = setup();
    source.records.set('a', record('a', 1));
    await indexer.handleEvent({ event: event('a') });
    expect(vendor.held.get(encodeSearchKey({ key: key('a') }))).toEqual({ revision: 1, deleted: false });
    source.records.set('a', record('a', 2, { restricted: true }));
    await indexer.handleEvent({ event: event('a', { name: 'post.unpublished' }) });
    expect(vendor.held.get(encodeSearchKey({ key: key('a') }))).toEqual({ revision: 2, deleted: true });
  });

  it('writes a versioned tombstone for a draft/trashed record, even for a never-indexed key', async () => {
    const { indexer, vendor, state } = setup();
    await indexer.handleEvent({ event: event('never') });
    expect(vendor.calls[0]!.args).toEqual({ tombstones: [{ key: key('never'), revision: 1 }] });
    expect(state.row(ACTIVE, key('never'))).toMatchObject({ deleted: true, status: 'indexed' });
  });

  it('writes to both the active and the building target during a rebuild', async () => {
    const builtin = makeProvider({ id: 'builtin', acceptsRestricted: true });
    const vendor = makeProvider({ id: 'vendor' });
    const { indexer, state, source } = setup({ providers: [vendor, builtin], targets: { active: ACTIVE, building: BUILDING } });
    source.records.set('a', record('a', 2));
    await indexer.handleEvent({ event: event('a') });
    expect(vendor.calls.map(c => c.method)).toEqual(['upsert']);
    expect(builtin.calls.map(c => c.method)).toEqual(['upsert']);
    expect(builtin.calls[0]!.ctx.indexName).toMatch(/^js_builtin_[0-9a-f]{40}_g2$/);
    expect(state.row(BUILDING, key('a'))?.status).toBe('indexed');
  });

  it('maps a call-level rejection to failed with the caller-safe message', async () => {
    const { indexer, vendor, state, source } = setup();
    source.records.set('a', record('a', 3));
    vendor.next('upsert', async () => providerRejected({ code: 'unauthorized', message: 'bad key' }));
    await indexer.handleEvent({ event: event('a') });
    expect(state.row(ACTIVE, key('a'))).toMatchObject({ status: 'failed', lastError: 'bad key', attempts: 1 });
  });

  it('maps a call-level unknown to unknown, never failed', async () => {
    const { indexer, vendor, state, source } = setup();
    source.records.set('a', record('a', 3));
    vendor.next('upsert', async () => providerUnknown({ code: 'timeout', message: 'slow' }));
    await indexer.handleEvent({ event: event('a') });
    expect(state.row(ACTIVE, key('a'))).toMatchObject({ status: 'unknown', lastError: 'timeout' });
  });

  it('treats a provider that throws as an unknown outcome', async () => {
    const { indexer, vendor, state, source } = setup();
    source.records.set('a', record('a', 3));
    vendor.next('upsert', async () => { throw new Error('boom'); });
    await indexer.handleEvent({ event: event('a') });
    expect(state.row(ACTIVE, key('a'))).toMatchObject({ status: 'unknown', lastError: 'unexpected_response' });
  });

  it('maps per-key outcomes: rejected (with and without message), pending (with and without task), stale, missing', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const { indexer, vendor, state, source } = setup();
    for (const id of ids) source.records.set(id, record(id, 2));
    const outcome = (id: string, status: 'rejected' | 'pending' | 'stale', message?: string) => ({ key: key(id), revision: 2, status, ...(message ? { message } : {}) });
    vendor.next('upsert', writeOk({ outcomes: [outcome('a', 'rejected', 'too large')] }));
    vendor.next('upsert', writeOk({ outcomes: [outcome('b', 'rejected')] }));
    vendor.next('upsert', writeOk({ outcomes: [outcome('c', 'pending')], taskId: 't1' }));
    vendor.next('upsert', writeOk({ outcomes: [outcome('d', 'pending')] }));
    vendor.next('upsert', writeOk({ outcomes: [outcome('e', 'stale')] }));
    vendor.next('upsert', writeOk({ outcomes: [] }));
    for (const id of ids) await indexer.handleEvent({ event: event(id) });
    const status = (id: string) => state.row(ACTIVE, key(id));
    expect(status('a')).toMatchObject({ status: 'failed', lastError: 'too large' });
    expect(status('b')).toMatchObject({ status: 'failed', lastError: 'rejected' });
    expect(status('c')).toMatchObject({ status: 'pending', taskId: 't1' });
    expect(status('d')?.status).toBe('pending');
    expect(status('d')).not.toHaveProperty('taskId');
    expect(status('e')).toMatchObject({ status: 'indexed', revision: 2 });
    expect(status('f')).toMatchObject({ status: 'unknown', lastError: 'missing_outcome' });
  });

  it('an older write completing after a newer revision was written leaves the newer row (CAS settle)', async () => {
    const { indexer, vendor, state, source } = setup();
    source.records.set('a', record('a', 1));
    vendor.next('upsert', async () => {
      // Revision 2 is written and settled while revision 1's call is still in flight.
      source.records.set('a', record('a', 2));
      await indexer.handleEvent({ event: event('a') });
      return providerOk({ value: { outcomes: [{ key: key('a'), revision: 1, status: 'applied' as const }] } });
    });
    await indexer.handleEvent({ event: event('a') });
    expect(state.row(ACTIVE, key('a'))).toMatchObject({ revision: 2, status: 'indexed' });
  });

  it('records not_configured without a provider call when the provider is unregistered or has no context', async () => {
    const unregistered = setup({ targets: { active: { ...ACTIVE, providerId: 'gone' } } });
    unregistered.source.records.set('a', record('a', 3));
    await unregistered.indexer.handleEvent({ event: event('a') });
    expect(unregistered.vendor.calls).toEqual([]);
    expect(unregistered.state.row({ ...ACTIVE, providerId: 'gone' }, key('a'))).toMatchObject({ status: 'failed', lastError: SEARCH_NOT_CONFIGURED, deleted: false });

    const noContext = setup({ noContextFor: ['vendor'] });
    await noContext.indexer.handleEvent({ event: event('draft') });
    expect(noContext.vendor.calls).toEqual([]);
    expect(noContext.state.row(ACTIVE, key('draft'))).toMatchObject({ status: 'failed', lastError: SEARCH_NOT_CONFIGURED, deleted: true });
  });

  it('propagates host port errors so the outbox retries', async () => {
    const { indexer, state, source } = setup();
    source.records.set('a', record('a', 3));
    state.get = async () => { throw new Error('db down'); };
    await expect(indexer.handleEvent({ event: event('a') })).rejects.toThrow('db down');
  });
});

describe('createSearchIndexer — reconcile', () => {
  it('settles pending tasks: succeeded → indexed (task cleared), failed → failed, pending/unknown answers stay', async () => {
    const vendor = makeProvider({ id: 'vendor', asyncIndexing: true, withAwaitTask: true });
    const { indexer, state } = setup({ providers: [vendor] });
    for (const [id, taskId] of [['a', 't-ok'], ['b', 't-bad'], ['c', 't-wait'], ['d', 't-err']] as const) {
      await state.put({ row: row({ documentId: id, status: 'pending', taskId }) });
    }
    vendor.next('awaitTask', async () => providerOk({ value: 'succeeded' as const }));
    vendor.next('awaitTask', async () => providerOk({ value: 'failed' as const }));
    vendor.next('awaitTask', async () => providerOk({ value: 'pending' as const }));
    vendor.next('awaitTask', async () => providerUnknown({ code: 'network', message: 'down' }));
    const result = await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(state.row(ACTIVE, key('a'))).toEqual({ ...row({ documentId: 'a' }), status: 'indexed', updatedAtMs: 5000 });
    expect(state.row(ACTIVE, key('b'))).toMatchObject({ status: 'failed', lastError: 'task_failed' });
    expect(state.row(ACTIVE, key('c'))?.status).toBe('pending');
    expect(state.row(ACTIVE, key('d'))?.status).toBe('pending');
    expect(vendor.calls.filter(c => c.method === 'awaitTask').map(c => c.args)).toEqual([{ taskId: 't-ok' }, { taskId: 't-bad' }, { taskId: 't-wait' }, { taskId: 't-err' }]);
    // b failed (attempts 1 < 5) is only retried on a later pass; this pass listed it as pending.
    expect(result).toEqual({ settled: 1, remaining: 3 });
  });

  it('an older task completing while a newer revision is pending never overwrites the newer row (CAS settle)', async () => {
    const vendor = makeProvider({ id: 'vendor', asyncIndexing: true, withAwaitTask: true });
    const { indexer, state, source } = setup({ providers: [vendor] });
    await state.put({ row: row({ status: 'pending', taskId: 't-1', revision: 1 }) });
    source.records.set('a', record('a', 2));
    vendor.next('upsert', async () => providerOk({ value: { outcomes: [{ key: key('a'), revision: 2, status: 'pending' as const }], taskId: 't-2' } }));
    // Revision 2's event lands while reconcile is still awaiting revision 1's task.
    vendor.next('awaitTask', async () => {
      await indexer.handleEvent({ event: event('a') });
      return providerOk({ value: 'succeeded' as const });
    });
    const result = await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(state.row(ACTIVE, key('a'))).toMatchObject({ revision: 2, status: 'pending', taskId: 't-2' });
    expect(result).toEqual({ settled: 0, remaining: 1 });
  });

  it('an older failed task does not mark a newer revision failed, and a stale revisionOf check settles nothing', async () => {
    const vendor = makeProvider({ id: 'vendor', asyncIndexing: true, withAwaitTask: true });
    const { indexer, state, source } = setup({ providers: [vendor] });
    await state.put({ row: row({ documentId: 'a', status: 'pending', taskId: 't-1', revision: 1 }) });
    await state.put({ row: row({ documentId: 'b', status: 'unknown', revision: 1 }) });
    vendor.held.set(encodeSearchKey({ key: key('b') }), { revision: 1, deleted: false });
    source.records.set('a', record('a', 2));
    source.records.set('b', record('b', 2));
    vendor.next('awaitTask', async () => {
      await indexer.handleEvent({ event: event('a') });
      return providerOk({ value: 'failed' as const });
    });
    const revisionOf = vendor.provider.revisionOf.bind(vendor.provider);
    vendor.next('revisionOf', async (args) => {
      await indexer.handleEvent({ event: event('b') });
      return revisionOf(contextFor({ target: ACTIVE, workspaceId: WS }), args as { keys: [] });
    });
    const result = await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(state.row(ACTIVE, key('a'))).toMatchObject({ revision: 2, status: 'indexed' });
    expect(state.row(ACTIVE, key('a'))?.lastError).toBeUndefined();
    expect(state.row(ACTIVE, key('b'))).toMatchObject({ revision: 2, status: 'indexed' });
    expect(result.settled).toBe(0);
  });

  it('checks unknown rows (and pending rows without a task) with revisionOf', async () => {
    const { indexer, vendor, state, source } = setup();
    vendor.held.set(encodeSearchKey({ key: key('landed') }), { revision: 3, deleted: false });
    vendor.held.set(encodeSearchKey({ key: key('mismatch') }), { revision: 3, deleted: true });
    await state.put({ row: row({ documentId: 'landed', status: 'unknown' }) });
    await state.put({ row: row({ documentId: 'mismatch', status: 'unknown' }) });
    await state.put({ row: row({ documentId: 'absent', status: 'pending' }) });
    source.records.set('mismatch', record('mismatch', 3));
    source.records.set('absent', record('absent', 3));
    const result = await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(state.row(ACTIVE, key('landed'))).toMatchObject({ status: 'indexed', attempts: 1 });
    // Not what the row says: re-loaded and re-written (a retry of the same revision).
    expect(source.loads.map(l => l.documentId)).toEqual(['mismatch', 'absent']);
    expect(source.loads[0]!.occurredAtMs).toBe(5000);
    expect(state.row(ACTIVE, key('mismatch'))).toMatchObject({ status: 'indexed', deleted: false, attempts: 2 });
    expect(state.row(ACTIVE, key('absent'))).toMatchObject({ status: 'indexed', attempts: 2 });
    expect(result).toEqual({ settled: 3, remaining: 0 });
  });

  it('uses revisionOf for a pending task row when the provider cannot await tasks, chunked by maxBatch', async () => {
    const vendor = makeProvider({ id: 'vendor', maxBatch: 1 });
    const { indexer, state } = setup({ providers: [vendor] });
    vendor.held.set(encodeSearchKey({ key: key('a') }), { revision: 4, deleted: false });
    vendor.held.set(encodeSearchKey({ key: key('b') }), { revision: 3, deleted: false });
    await state.put({ row: row({ documentId: 'a', status: 'pending', taskId: 't' }) });
    await state.put({ row: row({ documentId: 'b', status: 'unknown' }) });
    const result = await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(vendor.calls.filter(c => c.method === 'revisionOf')).toHaveLength(2);
    expect(result.settled).toBe(2);
  });

  it('leaves unknown rows untouched when revisionOf is indeterminate', async () => {
    const { indexer, vendor, state, source } = setup();
    await state.put({ row: row({ status: 'unknown' }) });
    vendor.next('revisionOf', async () => providerUnknown({ code: 'network', message: 'down' }));
    const result = await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(state.row(ACTIVE, key('a'))?.status).toBe('unknown');
    expect(source.loads).toEqual([]);
    expect(result).toEqual({ settled: 0, remaining: 1 });
  });

  it('retries failed rows below maxAttempts and leaves exhausted ones', async () => {
    const { indexer, vendor, state, source } = setup({ optional: { maxAttempts: 2 } });
    await state.put({ row: row({ documentId: 'retry', status: 'failed', attempts: 1 }) });
    await state.put({ row: row({ documentId: 'spent', status: 'failed', attempts: 2 }) });
    source.records.set('retry', record('retry', 3));
    const result = await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(source.loads.map(l => l.documentId)).toEqual(['retry']);
    expect(vendor.calls.map(c => c.method)).toEqual(['upsert']);
    expect(state.row(ACTIVE, key('retry'))).toMatchObject({ status: 'indexed', attempts: 2 });
    expect(state.row(ACTIVE, key('spent'))?.status).toBe('failed');
    expect(result).toEqual({ settled: 1, remaining: 1 });
  });

  it('writes a newer source revision on retry with a fresh attempt count, and skips an older one', async () => {
    const { indexer, state, source } = setup();
    await state.put({ row: row({ documentId: 'newer', status: 'failed', attempts: 3 }) });
    await state.put({ row: row({ documentId: 'older', status: 'failed', attempts: 3 }) });
    source.records.set('newer', record('newer', 4));
    source.records.set('older', record('older', 2));
    await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(state.row(ACTIVE, key('newer'))).toMatchObject({ revision: 4, attempts: 1, status: 'indexed' });
    expect(state.row(ACTIVE, key('older'))).toMatchObject({ revision: 3, status: 'failed' });
  });

  it('without a registered provider: in-flight rows wait, failed rows record not_configured again', async () => {
    const { indexer, state, source, contextCalls } = setup({ targets: { active: { ...ACTIVE, providerId: 'gone' } } });
    const gone = { ...ACTIVE, providerId: 'gone' };
    await state.put({ row: row({ target: gone, documentId: 'u', status: 'unknown' }) });
    await state.put({ row: row({ target: gone, documentId: 'f', status: 'failed', attempts: 1 }) });
    source.records.set('f', record('f', 3));
    await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(state.row(gone, key('u'))?.status).toBe('unknown');
    expect(state.row(gone, key('f'))).toMatchObject({ status: 'failed', lastError: SEARCH_NOT_CONFIGURED, attempts: 2 });
    expect(contextCalls).toEqual([]);
  });

  it('marks a row whose collection has no source as failed no_source', async () => {
    const { indexer, state } = setup();
    await state.put({ row: { ...row({ status: 'failed' }), key: key('x', 'retired') } });
    await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(state.row(ACTIVE, key('x', 'retired'))).toMatchObject({ status: 'failed', lastError: 'no_source', attempts: 2 });
  });

  it('exhausted failures never starve the actionable rows queued behind them', async () => {
    const { indexer, vendor, state, source } = setup({ optional: { maxAttempts: 2 } });
    for (const id of ['spent1', 'spent2', 'spent3']) await state.put({ row: row({ documentId: id, status: 'failed', attempts: 2 }) });
    await state.put({ row: row({ documentId: 'landed', status: 'unknown' }) });
    await state.put({ row: row({ documentId: 'retry', status: 'failed', attempts: 1 }) });
    vendor.held.set(encodeSearchKey({ key: key('landed') }), { revision: 3, deleted: false });
    source.records.set('retry', record('retry', 3));
    const result = await indexer.reconcile({ siteId: SITE, workspaceId: WS }, { limit: 2 });
    expect(state.row(ACTIVE, key('landed'))?.status).toBe('indexed');
    expect(state.row(ACTIVE, key('retry'))).toMatchObject({ status: 'indexed', attempts: 2 });
    expect(source.loads.map(l => l.documentId)).toEqual(['retry']);
    expect(result).toEqual({ settled: 2, remaining: 3 });
  });

  it('bounds each target by limit and resolves no provider when there is nothing in flight', async () => {
    const { indexer, state, contextCalls, source } = setup({ targets: { active: ACTIVE, building: BUILDING } });
    for (const id of ['a', 'b', 'c']) {
      await state.put({ row: row({ documentId: id, status: 'failed', attempts: 9 }) });
    }
    const listed: number[] = [];
    const list = state.listByStatus.bind(state);
    state.listByStatus = async (r) => { listed.push(r.limit); return list(r); };
    const result = await indexer.reconcile({ siteId: SITE, workspaceId: WS }, { limit: 2 });
    expect(listed).toEqual([2, 2]);
    expect(contextCalls).toEqual([]);
    expect(source.loads).toEqual([]);
    expect(result).toEqual({ settled: 0, remaining: 3 });
    await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(listed).toEqual([2, 2, 50, 50]);
  });
});

describe('createSearchIndexer — backfill', () => {
  const seed = (source: ReturnType<typeof makeSource>, count: number) => {
    for (let i = 0; i < count; i += 1) source.records.set(`d${i}`, record(`d${i}`, 1));
  };

  it('does nothing without targets', async () => {
    const { indexer } = setup({ targets: {} });
    expect(await indexer.backfill({ siteId: SITE, workspaceId: WS })).toEqual({ done: true, written: 0, promoted: false });
  });

  it('fills the active target when nothing is building, without promoting', async () => {
    const { indexer, vendor, source, targets } = setup();
    seed(source, 3);
    expect(await indexer.backfill({ siteId: SITE, workspaceId: WS })).toEqual({ done: true, written: 3, promoted: false });
    expect(vendor.calls.map(c => c.method)).toEqual(['ensureIndex', 'upsert']);
    expect(targets.current).toEqual({ active: ACTIVE, building: null });
  });

  it('is not done when the provider is not configured or ensureIndex fails', async () => {
    const unconfigured = setup({ noContextFor: ['vendor'] });
    seed(unconfigured.source, 1);
    expect(await unconfigured.indexer.backfill({ siteId: SITE, workspaceId: WS })).toEqual({ done: false, written: 0, promoted: false });
    expect(unconfigured.source.scans).toEqual([]);

    const broken = setup();
    seed(broken.source, 1);
    broken.vendor.next('ensureIndex', async () => providerRejected({ code: 'forbidden', message: 'no' }));
    expect(await broken.indexer.backfill({ siteId: SITE, workspaceId: WS })).toEqual({ done: false, written: 0, promoted: false });
    expect(broken.source.scans).toEqual([]);
  });

  it('resumes from the stored watermark after an interrupted run and promotes the building target', async () => {
    const builtin = makeProvider({ id: 'builtin', acceptsRestricted: true });
    const { indexer, fresh, source, state, targets } = setup({ providers: [makeProvider({ id: 'vendor' }), builtin], targets: { active: ACTIVE, building: BUILDING }, optional: { scanPageSize: 2 } });
    seed(source, 5);
    expect(await indexer.backfill({ siteId: SITE, workspaceId: WS }, { pageBudget: 1 })).toEqual({ done: false, written: 2, promoted: false });
    expect(state.marks.get(`${SITE}|builtin|2#post`)).toEqual({ cursor: 'd1', done: false });
    // A fresh indexer = a restarted process; only the stored watermark carries over.
    expect(await fresh().backfill({ siteId: SITE, workspaceId: WS }, { pageBudget: 1 })).toEqual({ done: false, written: 2, promoted: false });
    expect(await fresh().backfill({ siteId: SITE, workspaceId: WS }, { pageBudget: 1 })).toEqual({ done: true, written: 1, promoted: true });
    expect(source.scans).toEqual([undefined, 'd1', 'd3']);
    expect(builtin.calls.filter(c => c.method === 'ensureIndex')).toHaveLength(1);
    expect(targets.current).toEqual({ active: BUILDING, building: null });
  });

  it('skips completed sources, tombstones null records and moves the watermark per page', async () => {
    const posts = makeSource('post', [record('p', 1)]);
    const pages = makeSource('page', [record('g', 2, { collection: 'page', absent: true })]);
    const { indexer, vendor, state } = setup({ sources: [posts, pages] });
    await state.putWatermark({ target: ACTIVE, collection: 'post', done: true });
    expect(await indexer.backfill({ siteId: SITE, workspaceId: WS })).toEqual({ done: true, written: 1, promoted: false });
    expect(posts.scans).toEqual([]);
    expect(vendor.calls.map(c => c.method)).toEqual(['remove']);
    expect(state.marks.get(`${SITE}|vendor|1#page`)).toEqual({ done: true });
  });

  it('chunks writes by the provider\'s maxBatch', async () => {
    const vendor = makeProvider({ id: 'vendor', maxBatch: 2 });
    const { indexer, source } = setup({ providers: [vendor] });
    seed(source, 5);
    await indexer.backfill({ siteId: SITE, workspaceId: WS });
    expect(vendor.calls.filter(c => c.method === 'upsert').map(c => (c.args as { documents: unknown[] }).documents.length)).toEqual([2, 2, 1]);
  });

  it('does not promote while writes are pending or unknown', async () => {
    const builtin = makeProvider({ id: 'builtin' });
    const { indexer, source, targets } = setup({ providers: [makeProvider({ id: 'vendor' }), builtin], targets: { active: ACTIVE, building: BUILDING } });
    seed(source, 1);
    builtin.next('upsert', async () => providerUnknown({ code: 'timeout', message: 'slow' }));
    expect(await indexer.backfill({ siteId: SITE, workspaceId: WS })).toEqual({ done: true, written: 1, promoted: false });
    expect(targets.current.building).toEqual(BUILDING);
  });

  it('C5: keeps the live index when every write in a rebuild fails', async () => {
    const vendor = makeProvider({ id: 'vendor' });
    const builtin = makeProvider({ id: 'builtin' });
    const { indexer, source, state, targets } = setup({ providers: [vendor, builtin] });
    source.records.set('a', record('a', 1));
    await indexer.handleEvent({ event: event('a') });
    expect(state.row(ACTIVE, key('a'))?.status).toBe('indexed');

    await indexer.startRebuild({ siteId: SITE, workspaceId: WS, providerId: 'builtin' });
    builtin.next('upsert', async () => providerRejected({ code: 'unauthorized', message: 'bad key' }));
    const result = await indexer.backfill({ siteId: SITE, workspaceId: WS });

    expect(await state.counts({ target: BUILDING })).toEqual({ pending: 0, indexed: 0, unknown: 0, failed: 1 });
    expect(result).toEqual({ done: true, written: 1, promoted: false });
    expect(await targets.get({ siteId: SITE })).toEqual({ active: ACTIVE, building: BUILDING });
    expect(state.row(ACTIVE, key('a'))?.status).toBe('indexed');
    expect(state.deleted).toEqual([]);
    expect(vendor.calls.filter(c => c.method === 'dropIndex')).toEqual([]);
  });

  it('reports promoted:false when the CAS loses (someone else moved the pointer)', async () => {
    const builtin = makeProvider({ id: 'builtin' });
    const vendor = makeProvider({ id: 'vendor' });
    const { indexer, targets, state } = setup({ providers: [vendor, builtin], targets: { active: ACTIVE, building: BUILDING } });
    targets.losePromote = true;
    expect(await indexer.backfill({ siteId: SITE, workspaceId: WS })).toEqual({ done: true, written: 0, promoted: false });
    expect(vendor.calls.map(c => c.method)).toEqual([]);
    expect(state.deleted).toEqual([]);
  });

  it('drops the old generation only after the promote', async () => {
    const builtin = makeProvider({ id: 'builtin' });
    const vendor = makeProvider({ id: 'vendor' });
    const { indexer, state } = setup({ providers: [vendor, builtin], targets: { active: ACTIVE, building: BUILDING } });
    await state.put({ row: row({ documentId: 'old' }) });
    expect(await indexer.backfill({ siteId: SITE, workspaceId: WS })).toEqual({ done: true, written: 0, promoted: true });
    expect(vendor.calls.map(c => c.method)).toEqual(['dropIndex']);
    expect(vendor.calls[0]!.ctx.indexName).toMatch(/^js_vendor_[0-9a-f]{40}_g1$/);
    expect(state.deleted).toEqual([ACTIVE]);
    expect(state.row(ACTIVE, key('old'))).toBeUndefined();
  });

  it('keeps a replaced generation retired until its drop is confirmed, retrying on every reconcile', async () => {
    const builtin = makeProvider({ id: 'builtin' });
    const vendor = makeProvider({ id: 'vendor' });
    const { indexer, targets, state } = setup({ providers: [vendor, builtin], targets: { active: ACTIVE, building: BUILDING } });
    vendor.next('dropIndex', async () => providerRejected({ code: 'forbidden', message: 'key lacks indexes.delete' }));
    expect((await indexer.backfill({ siteId: SITE, workspaceId: WS })).promoted).toBe(true);
    expect(targets.retired).toEqual([ACTIVE]);
    vendor.next('dropIndex', async () => providerUnknown({ code: 'timeout', message: 'slow' }));
    await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(targets.retired).toEqual([ACTIVE]);
    vendor.next('dropIndex', async () => { throw new Error('provider bug'); });
    await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(targets.retired).toEqual([ACTIVE]);
    await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(vendor.calls.filter(c => c.method === 'dropIndex')).toHaveLength(4);
    expect(targets.retired).toEqual([]);
    expect(state.deleted).toEqual([ACTIVE, ACTIVE, ACTIVE, ACTIVE]);
    await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(vendor.calls.filter(c => c.method === 'dropIndex')).toHaveLength(4);
  });

  it('retries the drop once a missing credential or provider is configured again', async () => {
    const builtin = makeProvider({ id: 'builtin' });
    const vendor = makeProvider({ id: 'vendor' });
    const missing = ['vendor'];
    const { fresh, targets, registry } = setup({ providers: [builtin], targets: { active: ACTIVE, building: BUILDING }, noContextFor: missing });
    expect((await fresh().backfill({ siteId: SITE, workspaceId: WS })).promoted).toBe(true);
    expect(targets.retired).toEqual([ACTIVE]);
    registry.register({ definition: { id: 'vendor', provider: vendor.provider } });
    await fresh().reconcile({ siteId: SITE, workspaceId: WS });
    expect(targets.retired, 'registered but its credential is still missing').toEqual([ACTIVE]);
    missing.length = 0;
    await fresh().reconcile({ siteId: SITE, workspaceId: WS });
    expect(vendor.calls.map(c => c.method)).toEqual(['dropIndex']);
    expect(targets.retired).toEqual([]);
  });

  it('deletes the replaced bookkeeping even when its provider is no longer registered, and skips a missing replaced target', async () => {
    const gone = { ...ACTIVE, providerId: 'gone' };
    const unregistered = setup({ providers: [makeProvider({ id: 'builtin' })], targets: { active: gone, building: BUILDING } });
    expect((await unregistered.indexer.backfill({ siteId: SITE, workspaceId: WS })).promoted).toBe(true);
    expect(unregistered.state.deleted).toEqual([gone]);

    const first = setup({ providers: [makeProvider({ id: 'builtin' })], targets: { building: BUILDING } });
    expect((await first.indexer.backfill({ siteId: SITE, workspaceId: WS })).promoted).toBe(true);
    expect(first.state.deleted).toEqual([]);
  });
});

describe('createSearchIndexer — startRebuild', () => {
  it('starts the next generation after both the active and building ones', async () => {
    const none = setup({ targets: {} });
    expect((await none.indexer.startRebuild({ siteId: SITE, workspaceId: WS, providerId: 'vendor' })).building).toEqual({ siteId: SITE, providerId: 'vendor', generation: 1 });
    const active = setup({ targets: { active: { ...ACTIVE, generation: 3 } } });
    expect((await active.indexer.startRebuild({ siteId: SITE, workspaceId: WS, providerId: 'builtin' })).building?.generation).toBe(4);
    const both = setup({ targets: { active: ACTIVE, building: { ...BUILDING, generation: 5 } } });
    const result = await both.indexer.startRebuild({ siteId: SITE, workspaceId: WS, providerId: 'vendor' });
    expect(result).toEqual({ active: ACTIVE, building: { siteId: SITE, providerId: 'vendor', generation: 6 } });
  });
});
