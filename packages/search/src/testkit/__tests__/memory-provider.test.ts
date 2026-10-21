import { expect, test } from 'vitest';
import type { SearchDocument, SearchDocumentKey, SearchProvider } from '../../contract.js';
import { createInMemorySearchProvider } from '../memory-provider.js';
import { memoryContext } from './helpers.js';

const ctx = memoryContext({ siteId: 's', indexName: 'idx' });
const key = (documentId: string): SearchDocumentKey => ({ siteId: 's', workspaceId: 'w', collection: 'post', documentId });
const doc = (documentId: string, extra: Partial<SearchDocument> = {}): SearchDocument => ({
  key: key(documentId), revision: 1, url: `/${documentId}`, title: `Title ${documentId}`, body: `Body of ${documentId}`, visibility: { kind: 'public' }, ...extra,
});

async function ready(provider: SearchProvider = createInMemorySearchProvider()): Promise<SearchProvider> {
  await provider.ensureIndex(ctx);
  return provider;
}

test('defaults: id, label, capabilities, no credentials, no awaitTask when synchronous', () => {
  const provider = createInMemorySearchProvider();
  expect([provider.id, provider.label, provider.credentialKeys]).toEqual(['memory', 'In-memory reference provider', []]);
  expect(provider.capabilities).toEqual({ acceptsRestricted: true, typoTolerance: false, locales: 'any', maxBatch: 100, asyncIndexing: false });
  expect(provider.awaitTask).toBeUndefined();
  expect(createInMemorySearchProvider({}, { id: 'other', label: 'Other' }).id).toBe('other');
});

test('ensureIndex is idempotent and keeps documents', async () => {
  const provider = await ready();
  await provider.upsert(ctx, { documents: [doc('a')] });
  expect(await provider.ensureIndex(ctx)).toEqual({ status: 'ok', value: undefined });
  const result = await provider.query(ctx, { query: { text: 'title' } });
  expect(result.status === 'ok' && result.value.hits.length).toBe(1);
});

test('writes and reads against a missing index are rejected not_found', async () => {
  const provider = createInMemorySearchProvider();
  const missing = { status: 'rejected', error: { code: 'not_found', message: "index 'idx' does not exist" } };
  expect(await provider.upsert(ctx, { documents: [doc('a')] })).toEqual(missing);
  expect(await provider.query(ctx, { query: { text: 'a' } })).toEqual(missing);
  expect(await provider.revisionOf(ctx, { keys: [key('a')] })).toEqual(missing);
});

test('a batch above maxBatch is rejected whole; a bad revision is rejected per key', async () => {
  const provider = await ready(createInMemorySearchProvider({}, { maxBatch: 1 }));
  expect(await provider.remove(ctx, { tombstones: [{ key: key('a'), revision: 1 }, { key: key('b'), revision: 1 }] }))
    .toEqual({ status: 'rejected', error: { code: 'invalid_request', message: 'at most 1 items per write' } });
  expect(await provider.upsert(ctx, { documents: [doc('a', { revision: -1 })] })).toEqual({
    status: 'ok', value: { outcomes: [{ key: key('a'), revision: -1, status: 'rejected', message: 'revision must be a non-negative safe integer' }] },
  });
});

test('a public-only provider rejects restricted documents per key', async () => {
  const provider = await ready(createInMemorySearchProvider({}, { acceptsRestricted: false }));
  const result = await provider.upsert(ctx, { documents: [doc('a', { visibility: { kind: 'restricted', audiences: ['m'] } }), doc('b')] });
  expect(result.status === 'ok' && result.value.outcomes.map(outcome => [outcome.status, outcome.message])).toEqual([
    ['rejected', 'this provider accepts public documents only'], ['applied', undefined],
  ]);
});

test('queries: AND terms, field filters (scalar and list), title-only matches, ordering by score then key', async () => {
  const provider = await ready();
  await provider.upsert(ctx, { documents: [
    doc('a', { title: 'Red apple', body: 'An apple a day; apple pie.', fields: { color: 'red', tags: ['fruit', 'sweet'], stock: 3, fresh: true } }),
    doc('b', { title: 'Green apple', body: 'Sour.', fields: { color: 'green', tags: ['fruit'] } }),
    doc('c', { title: 'Banana', body: 'Yellow.' }),
  ] });
  const hitsOf = async (query: Parameters<SearchProvider['query']>[1]['query']) => {
    const result = await provider.query(ctx, { query });
    if (result.status !== 'ok') throw new Error(result.error.message);
    return result.value.hits;
  };
  expect((await hitsOf({ text: 'APPLE' })).map(hit => hit.key.documentId)).toEqual(['a', 'b']);
  expect(await hitsOf({ text: 'apple banana' })).toEqual([]);
  expect((await hitsOf({ text: 'apple', filters: { color: 'green' } })).map(hit => hit.key.documentId)).toEqual(['b']);
  expect((await hitsOf({ text: 'apple', filters: { tags: 'sweet', stock: 3, fresh: true } })).map(hit => hit.key.documentId)).toEqual(['a']);
  const [green] = await hitsOf({ text: 'green' });
  expect([green?.snippet, green?.highlights]).toEqual(['Sour.', []]);
  const [red] = await hitsOf({ text: 'apple', filters: { color: 'red' } });
  expect(red?.highlights.map(({ start, end }) => red.snippet.slice(start, end))).toEqual(['apple', 'apple']);
});

test('snippets are a window around the first match', async () => {
  const provider = await ready();
  const body = `${'lorem '.repeat(30)}needle ${'ipsum '.repeat(40)}`;
  await provider.upsert(ctx, { documents: [doc('long', { body })] });
  const result = await provider.query(ctx, { query: { text: 'needle' } });
  const hit = result.status === 'ok' ? result.value.hits[0] : undefined;
  expect(hit?.snippet).toBe(body.slice(140, 300));
  expect(hit?.highlights).toEqual([{ start: 40, end: 46 }]);
});

test('invalid query text, limit and cursor are rejected invalid_request', async () => {
  const provider = await ready();
  for (const [query, message] of [
    [{ text: '?!' }, 'query text must not be empty'],
    [{ text: 'a', limit: 0 }, 'limit must be an integer from 1 to 100'],
    [{ text: 'a', limit: 101 }, 'limit must be an integer from 1 to 100'],
    [{ text: 'a', limit: 1.5 }, 'limit must be an integer from 1 to 100'],
    [{ text: 'a', cursor: 'x' }, 'cursor is not a cursor of this provider'],
  ] as const) {
    expect(await provider.query(ctx, { query })).toEqual({ status: 'rejected', error: { code: 'invalid_request', message } });
  }
});

test('typo tolerance: one insertion, deletion or substitution on words of five or more letters', async () => {
  const provider = await ready(createInMemorySearchProvider({}, { typoTolerance: true }));
  await provider.upsert(ctx, { documents: [doc('a', { title: 'Elephant', body: 'Cat.' })] });
  const found = async (text: string) => {
    const result = await provider.query(ctx, { query: { text } });
    return result.status === 'ok' && result.value.hits.length === 1;
  };
  expect(await Promise.all(['elephnt', 'elephantt', 'elephent', 'elephant'].map(found))).toEqual([true, true, true, true]);
  expect(await Promise.all(['elphnt', 'eleph', 'cats', 'xlephanx'].map(found))).toEqual([false, false, false, false]);
});

test('async mode: pending until awaitTask, in write order; unknown and repeated task ids', async () => {
  const provider = await ready(createInMemorySearchProvider({}, { asyncIndexing: true }));
  const first = await provider.upsert(ctx, { documents: [doc('a')] });
  const second = await provider.upsert(ctx, { documents: [doc('a', { revision: 2, title: 'Second' })] });
  expect(first).toEqual({ status: 'ok', value: { outcomes: [{ key: key('a'), revision: 1, status: 'pending' }], taskId: 'task_1' } });
  expect((await provider.revisionOf(ctx, { keys: [key('a')] }))).toEqual({ status: 'ok', value: [{ key: key('a'), revision: null, deleted: false }] });
  expect(second.status === 'ok' && second.value.taskId).toBe('task_2');
  expect(await provider.awaitTask?.(ctx, { taskId: 'task_2' })).toEqual({ status: 'ok', value: 'succeeded' });
  expect(await provider.awaitTask?.(ctx, { taskId: 'task_1' })).toEqual({ status: 'ok', value: 'succeeded' });
  expect(await provider.revisionOf(ctx, { keys: [key('a')] })).toEqual({ status: 'ok', value: [{ key: key('a'), revision: 2, deleted: false }] });
  expect(await provider.awaitTask?.(ctx, { taskId: 'task_9' })).toEqual({ status: 'rejected', error: { code: 'not_found', message: "task 'task_9' is not known" } });
  expect(await provider.upsert(ctx, { documents: [doc('a')] })).toEqual({ status: 'ok', value: { outcomes: [{ key: key('a'), revision: 1, status: 'stale' }] } });
});

test('async mode: a duplicate queued write is ignored at apply time; a dropped index swallows its task', async () => {
  const provider = await ready(createInMemorySearchProvider({}, { asyncIndexing: true }));
  await provider.upsert(ctx, { documents: [doc('a', { title: 'One' })] });
  await provider.upsert(ctx, { documents: [doc('a', { title: 'Two' })] });
  await provider.awaitTask?.(ctx, { taskId: 'task_2' });
  const result = await provider.query(ctx, { query: { text: 'body' } });
  expect(result.status === 'ok' && result.value.hits.map(hit => hit.title)).toEqual(['One']);
  await provider.upsert(ctx, { documents: [doc('b')] });
  await provider.dropIndex(ctx);
  expect(await provider.awaitTask?.(ctx, { taskId: 'task_3' })).toEqual({ status: 'ok', value: 'succeeded' });
  expect(await provider.query(ctx, { query: { text: 'title' } })).toMatchObject({ status: 'rejected' });
});

test('an unavailable context answers unknown for every method', async () => {
  const provider = createInMemorySearchProvider({}, { asyncIndexing: true, available: () => false });
  const unknown = { status: 'unknown', error: { code: 'provider_unavailable', message: 'the in-memory provider is unavailable for this context' } };
  expect(await provider.ensureIndex(ctx)).toEqual(unknown);
  expect(await provider.dropIndex(ctx)).toEqual(unknown);
  expect(await provider.upsert(ctx, { documents: [doc('a')] })).toEqual(unknown);
  expect(await provider.query(ctx, { query: { text: 'a' } })).toEqual(unknown);
  expect(await provider.awaitTask?.(ctx, { taskId: 'task_1' })).toEqual(unknown);
});
