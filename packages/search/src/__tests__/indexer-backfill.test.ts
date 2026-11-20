import { describe, expect, it } from 'vitest';
import { providerRejected, providerUnknown } from '@jini-ai/core/provider-registry';
import { key, makeProvider, makeSource, record, SITE, WS } from './fakes/index.js';
import { ACTIVE, BUILDING, event, setup, row } from './indexer-fixtures.js';

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

  it('skips an older backfill after a newer event wins between its state read and put', async () => {
    const { indexer, vendor, state, source } = setup();
    source.records.set('a', record('a', 1));
    let observed!: () => void;
    const read = new Promise<void>(resolve => { observed = resolve; });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const get = state.get.bind(state);
    let paused = false;
    state.get = async input => {
      const prior = await get(input);
      if (!paused) {
        paused = true;
        observed();
        await held;
      }
      return prior;
    };
    const backfill = indexer.backfill({ siteId: SITE, workspaceId: WS });
    await read;
    source.records.set('a', record('a', 2));
    await indexer.handleEvent({ event: event('a') });
    const newer = state.row(ACTIVE, key('a'));
    release();
    expect(await backfill).toEqual({ done: true, written: 0, promoted: false });
    expect(vendor.calls.map(call => call.method)).toEqual(['ensureIndex', 'upsert']);
    expect(vendor.calls[1]!.args).toEqual({ documents: [record('a', 2).document] });
    expect(state.row(ACTIVE, key('a'))).toEqual(newer);
    expect(newer).toMatchObject({ revision: 2, status: 'indexed' });
    expect(state.puts.map(row => row.revision)).toEqual([2, 2]);
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
