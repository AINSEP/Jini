import { expect, test } from 'vitest';
import type { SearchDocumentKey } from '../../contract.js';
import type { SearchIndexStateRow, SearchTarget } from '../../ports.js';
import {
  createFakeHttpClient, createInMemorySearchState, createPredicateAccessPort, createStaticAccessPort, createUnavailableHttpClient,
} from '../fakes.js';

const request = { method: 'GET' as const, url: 'https://search.example/health', headers: {}, idleTimeoutMs: 100 };

test('fake http client records requests and passes the redirect policy to its handler', async () => {
  const seen: unknown[] = [];
  const client = createFakeHttpClient({ handle: input => { seen.push(input); return { status: 200, headers: {}, bodyText: 'ok' }; } });
  expect(await client.send({ request })).toEqual({ status: 200, headers: {}, bodyText: 'ok' });
  await client.send({ request }, { redirect: 'error' });
  expect(client.requests).toEqual([request, request]);
  expect(seen).toEqual([{ request }, { request, redirect: 'error' }]);
});

test('fake http client surfaces a handler rejection as a transport fault', async () => {
  const client = createFakeHttpClient({ handle: async () => { throw new Error('ETIMEDOUT'); } });
  await expect(client.send({ request })).rejects.toThrow('ETIMEDOUT');
  expect(client.requests).toHaveLength(1);
});

test('unavailable http client rejects every send', async () => {
  await expect(createUnavailableHttpClient().send({ request })).rejects.toThrow('network unavailable');
  await expect(createUnavailableHttpClient({}, { message: 'DNS down' }).send({ request })).rejects.toThrow('DNS down');
});

const target: SearchTarget = { siteId: 's1', providerId: 'builtin', generation: 1 };
const other: SearchTarget = { siteId: 's1', providerId: 'builtin', generation: 2 };
const key = (documentId: string): SearchDocumentKey => ({ siteId: 's1', workspaceId: 'w', collection: 'post', documentId });
const row = (documentId: string, extra: Partial<SearchIndexStateRow> = {}): SearchIndexStateRow =>
  ({ target, key: key(documentId), revision: 1, deleted: false, status: 'pending', attempts: 0, updatedAtMs: 0, ...extra });

test('index state: put is an upsert by (target, key); list, counts and deleteTarget are per target', async () => {
  const { indexState } = createInMemorySearchState();
  expect(await indexState.get({ target, key: key('a') })).toBeNull();
  await indexState.put({ row: row('a') });
  await indexState.put({ row: row('a', { status: 'indexed', revision: 2 }) });
  await indexState.put({ row: row('b', { status: 'failed' }) });
  await indexState.put({ row: row('c') });
  await indexState.put({ row: row('a', { target: other, status: 'unknown' }) });
  expect(await indexState.get({ target, key: key('a') })).toMatchObject({ revision: 2, status: 'indexed' });
  expect((await indexState.listByStatus({ target, statuses: ['pending', 'failed'], limit: 10 })).map(r => r.key.documentId)).toEqual(['b', 'c']);
  expect(await indexState.listByStatus({ target, statuses: ['pending', 'failed'], limit: 1 })).toHaveLength(1);
  expect(await indexState.counts({ target })).toEqual({ pending: 1, indexed: 1, unknown: 0, failed: 1 });
  expect(await indexState.counts({ target: other })).toEqual({ pending: 0, indexed: 0, unknown: 1, failed: 0 });
  await indexState.deleteTarget({ target });
  expect(await indexState.counts({ target })).toEqual({ pending: 0, indexed: 0, unknown: 0, failed: 0 });
  expect(await indexState.get({ target: other, key: key('a') })).not.toBeNull();
});

test('index state rows are stored as frozen copies', async () => {
  const { indexState } = createInMemorySearchState();
  const original = { ...row('a') };
  await indexState.put({ row: original });
  const stored = await indexState.get({ target, key: key('a') });
  expect(stored).toEqual(original);
  expect(stored).not.toBe(original);
  expect(Object.isFrozen(stored)).toBe(true);
});

test('watermarks are per (target, collection) and deleted with their target', async () => {
  const { indexState } = createInMemorySearchState();
  expect(await indexState.getWatermark({ target, collection: 'post' })).toBeNull();
  await indexState.putWatermark({ target, collection: 'post', cursor: 'c1', done: false });
  await indexState.putWatermark({ target, collection: 'page', done: true });
  await indexState.putWatermark({ target: other, collection: 'post', done: true });
  expect(await indexState.getWatermark({ target, collection: 'post' })).toEqual({ cursor: 'c1', done: false });
  expect(await indexState.getWatermark({ target, collection: 'page' })).toEqual({ done: true });
  await indexState.deleteTarget({ target });
  expect(await indexState.getWatermark({ target, collection: 'post' })).toBeNull();
  expect(await indexState.getWatermark({ target: other, collection: 'post' })).toEqual({ done: true });
});

test('targets: building, compare-and-swap promote, clear', async () => {
  const { targets } = createInMemorySearchState({}, { active: [target] });
  expect(await targets.get({ siteId: 's1' })).toEqual({ active: target, building: null });
  expect(await targets.get({ siteId: 'nobody' })).toEqual({ active: null, building: null });
  expect(await targets.promote({ siteId: 's1', expected: other })).toBe(false);
  await targets.setBuilding({ target: other });
  expect(await targets.get({ siteId: 's1' })).toEqual({ active: target, building: other });
  const third = { ...other, generation: 3 };
  expect(await targets.promote({ siteId: 's1', expected: third })).toBe(false);
  expect(await targets.promote({ siteId: 's1', expected: { ...other } })).toEqual({ replaced: target });
  expect(await targets.get({ siteId: 's1' })).toEqual({ active: other, building: null });
  await targets.setBuilding({ target: third });
  await targets.clearBuilding({ siteId: 's1' });
  expect(await targets.get({ siteId: 's1' })).toEqual({ active: other, building: null });
  const fresh = createInMemorySearchState().targets;
  await fresh.setBuilding({ target });
  expect(await fresh.promote({ siteId: 's1', expected: target })).toEqual({ replaced: null });
});

test('a second promote of the same building loses (the pointer already moved)', async () => {
  const { targets } = createInMemorySearchState();
  await targets.setBuilding({ target });
  const [first, second] = await Promise.all([targets.promote({ siteId: 's1', expected: target }), targets.promote({ siteId: 's1', expected: target })]);
  expect([first, second]).toEqual([{ replaced: null }, false]);
});

test('access ports answer with encoded keys of the visible subset', async () => {
  const visible = createStaticAccessPort({ visible: [key('a')] });
  expect([...await visible.visibleKeys({ siteId: 's1', keys: [key('a'), key('b')], audiences: [] })]).toEqual(['s1/w/post/a']);
  const calls: unknown[] = [];
  const members = createPredicateAccessPort({ isVisible: input => { calls.push(input); return input.audiences.includes('members'); } });
  expect([...await members.visibleKeys({ siteId: 's1', keys: [key('a')], audiences: ['members'] })]).toEqual(['s1/w/post/a']);
  expect([...await members.visibleKeys({ siteId: 's1', keys: [key('a')], audiences: [] })]).toEqual([]);
  expect(calls[0]).toEqual({ siteId: 's1', key: key('a'), audiences: ['members'] });
});

test('index state: settle is a compare-and-swap on the observed revision and task', async () => {
  const { indexState } = createInMemorySearchState();
  expect(await indexState.settle({ row: row('a', { status: 'indexed' }), expected: { revision: 1, taskId: null } })).toBe(false);
  expect(await indexState.get({ target, key: key('a') })).toBeNull();
  await indexState.put({ row: row('a', { taskId: 't-1' }) });
  expect(await indexState.settle({ row: row('a', { status: 'indexed' }), expected: { revision: 1, taskId: null } })).toBe(false);
  expect(await indexState.settle({ row: row('a', { status: 'indexed' }), expected: { revision: 2, taskId: 't-1' } })).toBe(false);
  expect(await indexState.settle({ row: row('a', { status: 'indexed' }), expected: { revision: 1, taskId: 't-1' } })).toBe(true);
  expect(await indexState.get({ target, key: key('a') })).toMatchObject({ status: 'indexed' });
  expect(await indexState.settle({ row: row('a', { status: 'failed' }), expected: { revision: 1, taskId: null } })).toBe(true);
  expect((await indexState.get({ target, key: key('a') }))?.status).toBe('failed');
});

test('index state: listByStatus can exclude exhausted failures before the limit', async () => {
  const { indexState } = createInMemorySearchState();
  await indexState.put({ row: row('spent', { status: 'failed', attempts: 3 }) });
  await indexState.put({ row: row('retry', { status: 'failed', attempts: 2 }) });
  await indexState.put({ row: row('wait', { status: 'unknown', attempts: 7 }) });
  const ids = async (optional?: { failedBelowAttempts?: number }) =>
    (await indexState.listByStatus({ target, statuses: ['failed', 'unknown'], limit: 2 }, optional)).map(entry => entry.key.documentId);
  expect(await ids()).toEqual(['spent', 'retry']);
  expect(await ids({ failedBelowAttempts: 3 })).toEqual(['retry', 'wait']);
});
