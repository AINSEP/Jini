import { describe, expect, it } from 'vitest';
import { providerOk, providerRejected, providerUnknown } from '@jini-ai/core/provider-registry';
import { encodeSearchKey } from '../contract.js';
import { SEARCH_NOT_CONFIGURED } from '../indexer-write.js';
import { key, makeProvider, makeSource, record } from './fakes/index.js';
import { ACTIVE, BUILDING, OCCURRED, event, setup, row, writeOk } from './indexer-fixtures.js';

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

