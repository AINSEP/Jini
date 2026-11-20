import { describe, expect, it } from 'vitest';
import { providerOk, providerUnknown } from '@jini-ai/core/provider-registry';
import { encodeSearchKey } from '../contract.js';
import { SEARCH_NOT_CONFIGURED } from '../indexer-write.js';
import { contextFor, key, makeProvider, record, SITE, WS } from './fakes/index.js';
import { ACTIVE, BUILDING, event, setup, row } from './indexer-fixtures.js';

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

  // Stryker L5 (2026-10-25): `upserted + removed` → `-` survived; every retry test had only one kind.
  it('counts an upsert retry and a tombstone retry together in settled', async () => {
    const { indexer, vendor, state, source } = setup();
    await state.put({ row: row({ documentId: 'up', status: 'failed', attempts: 1 }) });
    await state.put({ row: row({ documentId: 'gone', status: 'failed', attempts: 1 }) });
    source.records.set('up', record('up', 3));
    source.records.set('gone', record('gone', 3, { absent: true }));
    const result = await indexer.reconcile({ siteId: SITE, workspaceId: WS });
    expect(vendor.calls.map(c => c.method).sort()).toEqual(['remove', 'upsert']);
    expect(result).toEqual({ settled: 2, remaining: 0 });
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

