import assert from 'node:assert/strict';
import test from 'node:test';
import provider from '../providers/meilisearch.mjs';

test('query uses the injected transport and keeps the API key out of its result', async () => {
  const calls = [];
  const context = {
    workspaceId: 'ws', siteId: 'site', indexName: 'public-index', timeoutMs: 1000, now: () => 0,
    credentials: { host: 'https://search.example', apiKey: 'fixture-secret' },
    httpClient: { send: async ({ request }) => {
      calls.push(request);
      return { status: 200, headers: {}, bodyText: '{"hits":[]}' };
    } },
  };
  const result = await provider.query(context, { query: { text: 'hello' } });
  assert.deepEqual(result, { status: 'ok', value: { hits: [] } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://search.example/indexes/public-index/search');
  assert.equal(calls[0].headers.Authorization, 'Bearer fixture-secret');
  assert.equal(JSON.parse(calls[0].body).q, 'hello');
  assert.equal(provider.capabilities.acceptsRestricted, false);
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});

test('missing credentials refuse locally without touching the network', async () => {
  let calls = 0;
  const result = await provider.query({ credentials: {}, httpClient: { send: async () => { calls += 1; } } }, { query: { text: 'hello' } });
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.code, 'not_configured');
  assert.equal(calls, 0);
});

test('restricted documents never reach the search service', async () => {
  const calls = [];
  const context = {
    workspaceId: 'ws', siteId: 'site', indexName: 'public-index', timeoutMs: 1000, now: () => 0,
    credentials: { host: 'https://search.example', apiKey: 'fixture-secret' },
    httpClient: { send: async ({ request }) => { calls.push(request); throw new Error('unexpected network'); } },
  };
  const result = await provider.upsert(context, { documents: [{
    key: { workspaceId: 'ws', siteId: 'site', collection: 'posts', documentId: 'private' },
    revision: 1, url: '/members/private', title: 'Private', body: 'members only',
    visibility: { kind: 'restricted', audiences: ['members'] },
  }] });
  assert.equal(result.status, 'ok');
  assert.equal(result.value.outcomes[0].status, 'rejected');
  assert.equal(calls.length, 0);
});

const origin = 'https://search.example';
const index = '/indexes/public-index';
const queued = '/tasks?indexUids=public-index&statuses=enqueued,processing&limit=1';
const success = value => ({ status: 'ok', value });
const failure = (status, code, message, fields = {}) => ({ status, error: { code, message, ...fields } });
const json = (body, status = 200, headers = {}) => ({ status, headers, bodyText: JSON.stringify(body) });

function script(steps = [], options = {}) {
  const requests = [];
  const ctx = {
    workspaceId: 'ws', siteId: 'site', indexName: 'public-index', timeoutMs: 100,
    now: () => Date.parse('2030-01-01T00:00:00Z'),
    credentials: { host: origin + '///', apiKey: 'fixture-key' }, ...options,
    httpClient: { async send({ request }) {
      const step = steps[requests.length];
      requests.push(request);
      if (!step || request.method !== step[0] || request.url !== origin + step[1]) {
        throw new Error('unexpected request');
      }
      return typeof step[2] === 'function' ? step[2]() : step[2];
    } },
  };
  return { ctx, requests, expectRequests() {
    assert.deepEqual(requests.map(({ method, url, idleTimeoutMs, headers }) => ({ method, url, idleTimeoutMs, headers })),
      steps.map(([method, path]) => ({
        method, url: origin + path, idleTimeoutMs: ctx.timeoutMs,
        headers: { Authorization: 'Bearer fixture-key', ...(['POST', 'PATCH'].includes(method) ? { 'content-type': 'application/json' } : {}) },
      })));
  } };
}

const query = (ctx, input = {}) => provider.query(ctx, { query: { text: 'hello', ...input } });
const key = documentId => ({ siteId: 'site', workspaceId: 'ws', collection: 'posts', documentId });
const b64 = keyText => Buffer.from(keyText).toString('base64url');
const doc = (documentId, revision, other = {}) => ({
  key: key(documentId), revision, url: '/post', title: 'Post', body: 'public words', visibility: { kind: 'public' }, ...other,
});

for (const [name, answer, expected] of [
  ['noisy 401', json({ code: 'invalid_api_key', message: 'fixture-key private detail' }, 401),
    failure('rejected', 'unauthorized', 'Meilisearch answered HTTP 401 (invalid_api_key): the API key was not accepted')],
  ['403', json({}, 403), failure('rejected', 'forbidden', 'Meilisearch answered HTTP 403: the API key lacks a required permission')],
  ['404', json({ code: 'other_missing' }, 404), failure('rejected', 'not_found', 'Meilisearch answered HTTP 404 (other_missing)')],
  ['400 invalid request', json({ type: 'invalid_request' }, 400), failure('rejected', 'invalid_request', 'Meilisearch answered HTTP 400')],
  ['400 generic error', json({ code: 123 }, 400), failure('rejected', 'provider_error', 'Meilisearch answered HTTP 400')],
  ['503', json({ message: 'private upstream text' }, 503), failure('unknown', 'provider_unavailable', 'Meilisearch answered HTTP 503')],
  ['302', json({}, 302), failure('unknown', 'unexpected_response', 'Meilisearch answered HTTP 302')],
  ['200 invalid JSON', { status: 200, headers: {}, bodyText: '<html>' },
    failure('unknown', 'unexpected_response', 'Meilisearch answered HTTP 200 with a body that is not JSON')],
  ['429 seconds', json({}, 429, { 'rEtRy-AfTeR': ' 7 ' }), failure('rejected', 'rate_limited', 'Meilisearch answered HTTP 429', { retryAfterMs: 7000 })],
  ['429 date', json({}, 429, { 'Retry-After': 'Tue, 01 Jan 2030 00:00:09 GMT' }), failure('rejected', 'rate_limited', 'Meilisearch answered HTTP 429', { retryAfterMs: 9000 })],
  ['429 expired date', json({}, 429, { 'Retry-After': 'Mon, 31 Dec 2029 23:59:57 GMT' }), failure('rejected', 'rate_limited', 'Meilisearch answered HTTP 429', { retryAfterMs: 0 })],
  ['429 invalid date', json({}, 429, { 'Retry-After': 'later' }), failure('rejected', 'rate_limited', 'Meilisearch answered HTTP 429')],
  ['429 no header', json({}, 429), failure('rejected', 'rate_limited', 'Meilisearch answered HTTP 429')],
  ['abort', () => { throw new DOMException('fixture failure', 'AbortError'); }, failure('unknown', 'timeout', 'the Meilisearch request timed out')],
  ['timeout string', () => { throw 'timed out, noisy fixture'; }, failure('unknown', 'timeout', 'the Meilisearch request timed out')],
  ['network', () => Promise.reject(new Error('fixture-key connection closed')), failure('unknown', 'network', 'Meilisearch could not be reached')],
]) {
  test(`query classifies ${name} without reflecting provider free text`, async () => {
    const env = script([['POST', index + '/search', answer]]);
    assert.deepEqual(await query(env.ctx), expected);
    env.expectRequests();
  });
}

for (const [input, expected] of [
  [{ text: '   ' }, 'query text must not be empty'],
  [{ text: 6 }, 'query text must not be empty'],
  [{ limit: 0 }, 'limit must be an integer from 1 to 100'],
  [{ limit: 1.5 }, 'limit must be an integer from 1 to 100'],
  [{ limit: 101 }, 'limit must be an integer from 1 to 100'],
  [{ cursor: '1e2' }, 'cursor is not a cursor of this provider'],
  [{ cursor: '0000000000' }, 'cursor is not a cursor of this provider'],
]) {
  test(`query rejects ${JSON.stringify(input)} before the transport`, async () => {
    const env = script();
    assert.deepEqual(await query(env.ctx, input), failure('rejected', 'invalid_request', expected));
    env.expectRequests();
  });
}

test('query pins tenant filters, paging, type-tagged fields and offsets in the cleaned snippet', async () => {
  const first = { site_id: 'site', workspace_id: 'ws', collection: 'posts', document_id: 'one',
    revision: 9, url: '/one', title: 'One', body: 'not the crop',
    _formatted: { body: 'A <em>\u0001leaf</em>\u0002, then \u0001oak\u0002\n<.' }, _rankingScore: 0.72 };
  const env = script([['POST', index + '/search', json({ hits: [first, { ...first, document_id: 'extra' }], estimatedTotalHits: 1 })]]);
  const result = await query(env.ctx, { limit: 1, cursor: '9', collections: ['post"box', 'logs'], locale: 'fr', filters: { count: 3 } });
  assert.deepEqual(result, success({ hits: [{ key: key('one'), revision: 9, url: '/one', title: 'One',
    snippet: 'A leaf, then oak .', highlights: [{ start: 2, end: 6 }, { start: 13, end: 16 }], score: 0.72 }], nextCursor: '10' }));
  env.expectRequests();
  assert.deepEqual(JSON.parse(env.requests[0].body), {
    q: 'hello', filter: String.raw`deleted = false AND site_id = "site" AND workspace_id = "ws" AND collection IN ["post\"box", "logs"] AND locale = "fr" AND f_fields = "[\"count\",3]"`,
    limit: 2, offset: 9, attributesToRetrieve: ['site_id', 'workspace_id', 'collection', 'document_id', 'revision', 'url', 'title', 'body'],
    attributesToCrop: ['body'], cropLength: 30, attributesToHighlight: ['body'], highlightPreTag: '\u0001', highlightPostTag: '\u0002', showRankingScore: true,
  });
});

test('query distinguishes empty scope, missing index, malformed hits and a terminal page', async () => {
  const local = script();
  assert.deepEqual(await query(local.ctx, { collections: [] }), success({ hits: [] }));
  local.expectRequests();
  const hit = { site_id: 'site', workspace_id: 'ws', collection: 'posts', document_id: 'fallback', revision: 0, url: '/post', title: 'Title', body: '<p>body</p>' };
  const env = script([
    ['POST', index + '/search', json({ code: 'index_not_found' }, 404)],
    ['POST', index + '/search', json({ hits: [hit, { ...hit, revision: '0' }, hit] })],
    ['POST', index + '/search', json({ hits: [hit], estimatedTotalHits: 999 })],
  ]);
  assert.deepEqual(await query(env.ctx), success({ hits: [] }));
  assert.deepEqual(await query(env.ctx), failure('unknown', 'unexpected_response', 'Meilisearch returned hits in an unrecognised shape'));
  assert.deepEqual(await query(env.ctx), success({ hits: [{ key: key('fallback'), revision: 0, url: '/post', title: 'Title', snippet: 'body', highlights: [], score: 0 }] }));
  env.expectRequests();
});

test('upsert protects existing revisions and collapses multiple incoming revisions to one full replacement', async () => {
  const id = b64('site/ws/posts/a%2Fb');
  const blockedId = b64('site/ws/posts/stale');
  const env = script([
    ['GET', queued, json({ results: [{ uid: 21 }] })],
    ['GET', '/tasks/21', json({ status: 'failed', error: { code: 'invalid_document' } })],
    ['POST', index + '/documents/fetch', json({ results: [{ id: blockedId, revision: 9, deleted: true }] })],
    ['POST', index + '/documents?primaryKey=id', json({ taskUid: 22 }, 202)],
  ]);
  const documents = [doc('a/b', 3), doc('stale', 9), doc('a/b', 2), doc('a/b', 5, { locale: 'fr', fields: { tags: ['a', 'b'], count: 3 } })];
  assert.deepEqual(await provider.upsert(env.ctx, { documents }), success({ taskId: '22', outcomes: [
    { key: key('a/b'), revision: 3, status: 'pending' }, { key: key('stale'), revision: 9, status: 'stale' },
    { key: key('a/b'), revision: 2, status: 'stale' }, { key: key('a/b'), revision: 5, status: 'pending' },
  ] }));
  env.expectRequests();
  assert.deepEqual(JSON.parse(env.requests[2].body), {
    filter: `id IN ["${id}", "${blockedId}", "${id}", "${id}"]`, fields: ['id', 'revision', 'deleted'], limit: 4,
  });
  assert.deepEqual(JSON.parse(env.requests[3].body), [{
    id, site_id: 'site', workspace_id: 'ws', collection: 'posts', document_id: 'a/b', revision: 5, deleted: false,
    url: '/post', title: 'Post', body: 'public words', locale: 'fr', f_fields: ['["tags","a"]', '["tags","b"]', '["count",3]'],
  }]);
});

test('remove posts a content-free tombstone even when the index has no previous revision', async () => {
  const env = script([
    ['GET', queued, json({ results: [] })],
    ['POST', index + '/documents/fetch', json({ code: 'index_not_found' }, 404)],
    ['POST', index + '/documents?primaryKey=id', json({ taskUid: 30 }, 202)],
  ]);
  assert.deepEqual(await provider.remove(env.ctx, { tombstones: [{ ...doc('gone', 7, { fields: { private: 'old' } }) }] }),
    success({ outcomes: [{ key: key('gone'), revision: 7, status: 'pending' }], taskId: '30' }));
  assert.deepEqual(JSON.parse(env.requests[2].body), [{
    id: b64('site/ws/posts/gone'), site_id: 'site', workspace_id: 'ws', collection: 'posts', document_id: 'gone', revision: 7,
    deleted: true, locale: null, body: '', title: '', url: '', f_fields: [],
  }]);
  env.expectRequests();
});

test('write validates per-document and whole-batch limits without transport', async () => {
  const env = script();
  const tooLong = 'x'.repeat(500);
  const outcome = (documentId, revision, message) => ({ key: key(documentId), revision, status: 'rejected', message });
  assert.deepEqual(await provider.upsert(env.ctx, { documents: [doc('negative', -1), doc('fraction', 2.5), doc(tooLong, 0)] }), success({ outcomes: [
    outcome('negative', -1, 'revision must be a non-negative safe integer'), outcome('fraction', 2.5, 'revision must be a non-negative safe integer'),
    outcome(tooLong, 0, 'the document key is too long for a Meilisearch document id'),
  ] }));
  const invalid = doc('bad', -1);
  assert.deepEqual(await provider.upsert(env.ctx, { documents: Array(500).fill(invalid) }), success({
    outcomes: Array(500).fill(outcome('bad', -1, 'revision must be a non-negative safe integer')),
  }));
  assert.deepEqual(await provider.upsert(env.ctx, { documents: Array(501).fill(invalid) }),
    failure('rejected', 'invalid_request', 'Meilisearch accepts at most 500 documents per write'));
  env.expectRequests();
});

for (const [name, steps, expected] of [
  ['queue lookup failure', [['GET', queued, json({}, 503)]], failure('unknown', 'provider_unavailable', 'Meilisearch answered HTTP 503')],
  ['malformed task list', [['GET', queued, json({})]], failure('unknown', 'unexpected_response', 'Meilisearch listed tasks without a results array')],
  ['missing task uid', [['GET', queued, json({ results: [{ uid: 'not-a-number' }] })]], failure('unknown', 'unexpected_response', 'Meilisearch listed a task without a uid')],
  ['malformed revisions', [['GET', queued, json({ results: [] })], ['POST', index + '/documents/fetch', json({ results: [{ id: 'valid', revision: '8' }] })]],
    failure('unknown', 'unexpected_response', 'Meilisearch returned documents without an id and revision')],
  ['unacknowledged enqueue', [['GET', queued, json({ results: [] })], ['POST', index + '/documents/fetch', json({ results: [] })],
    ['POST', index + '/documents?primaryKey=id', json({}, 202)]], failure('unknown', 'unexpected_response', 'Meilisearch accepted the documents without a task uid')],
]) {
  test(`write reports ${name} rather than claiming it was queued`, async () => {
    const env = script(steps);
    assert.deepEqual(await provider.upsert(env.ctx, { documents: [doc('item', 7)] }), expected);
    env.expectRequests();
  });
}

test('revisionOf deduplicates fetch keys but preserves requested order, tombstones and missing keys', async () => {
  const id = b64('site/ws/posts/gone');
  const env = script([['POST', index + '/documents/fetch', json({ results: [{ id, deleted: true, revision: 7 }] })]]);
  assert.deepEqual(await provider.revisionOf(env.ctx, { keys: [key('gone'), key('absent'), key('gone')] }), success([
    { key: key('gone'), revision: 7, deleted: true }, { key: key('absent'), revision: null, deleted: false }, { key: key('gone'), revision: 7, deleted: true },
  ]));
  assert.deepEqual(JSON.parse(env.requests[0].body), {
    filter: `id IN ["${id}", "${b64('site/ws/posts/absent')}"]`, fields: ['id', 'revision', 'deleted'], limit: 2,
  });
  env.expectRequests();
});

test('ensureIndex applies settings for a preexisting index and waits for the settings task', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = script([
    ['POST', '/indexes', json({ code: 'index_already_exists' }, 409)],
    ['PATCH', index + '/settings', json({ taskUid: 44 }, 202)],
    ['GET', '/tasks/44', json({ status: 'enqueued' })],
    ['GET', '/tasks/44', json({ status: 'succeeded' })],
  ]);
  const result = provider.ensureIndex(env.ctx);
  // Flush the HTTP/poll microtasks before advancing the controlled sleep.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.requests.at(-1).url, origin + '/tasks/44');
  t.mock.timers.tick(25);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.requests.length, 4, 'the setting task is polled after the first backoff');
  assert.deepEqual(await result, success(undefined));
  env.expectRequests();
  assert.deepEqual(JSON.parse(env.requests[0].body), { uid: 'public-index', primaryKey: 'id' });
  assert.deepEqual(JSON.parse(env.requests[1].body), {
    filterableAttributes: ['id', 'site_id', 'workspace_id', 'collection', 'locale', 'deleted', 'f_fields'],
    searchableAttributes: ['title', 'body'],
  });
});

test('dropIndex tolerates absence at DELETE or in the resulting task, but not another task failure', async () => {
  const env = script([
    ['DELETE', index, json({ code: 'index_not_found' }, 404)],
    ['DELETE', index, json({ taskUid: 9 }, 202)],
    ['GET', '/tasks/9', json({ status: 'failed', error: { code: 'index_not_found' } })],
    ['DELETE', index, json({ taskUid: 10 }, 202)],
    ['GET', '/tasks/10', json({ status: 'canceled' })],
  ]);
  assert.deepEqual(await provider.dropIndex(env.ctx), success(undefined));
  assert.deepEqual(await provider.dropIndex(env.ctx), success(undefined));
  assert.deepEqual(await provider.dropIndex(env.ctx), failure('rejected', 'provider_error', 'Meilisearch task 10 failed'));
  env.expectRequests();
});

test('awaitTask encodes IDs and distinguishes pending, unknown state and failed lookup', async () => {
  const env = script([
    ['GET', '/tasks/id%2F1', json({ status: 'processing' })],
    ['GET', '/tasks/2', json({ status: 'unrecognized' })],
    ['GET', '/tasks/3', json({ code: 'task_not_found' }, 404)],
  ]);
  assert.deepEqual(await provider.awaitTask(env.ctx, { taskId: 'id/1' }), success('pending'));
  assert.deepEqual(await provider.awaitTask(env.ctx, { taskId: '2' }), failure('unknown', 'unexpected_response', 'Meilisearch task 2 has an unrecognised status'));
  assert.deepEqual(await provider.awaitTask(env.ctx, { taskId: '3' }), failure('rejected', 'not_found', 'Meilisearch answered HTTP 404 (task_not_found)'));
  env.expectRequests();
});

test('a still-pending earlier task at the deadline blocks all revision reads and new writes', async () => {
  let tick = 10;
  const env = script([
    ['GET', queued, json({ results: [{ uid: 32 }] })],
    ['GET', '/tasks/32', () => { tick = 110; return json({ status: 'processing' }); }],
  ], { now: () => tick });
  assert.deepEqual(await provider.upsert(env.ctx, { documents: [doc('wait', 6)] }),
    failure('unknown', 'timeout', 'Meilisearch task 32 was still pending after 100 ms'));
  env.expectRequests();
});

test('overlapping writes wait for the earlier vendor task before making the next stale decision', async () => {
  let release;
  const enqueue = new Promise(resolve => { release = resolve; });
  let markEnqueue;
  const reachedEnqueue = new Promise(resolve => { markEnqueue = resolve; });
  const id = b64('site/ws/posts/shared');
  const env = script([
    ['GET', queued, json({ results: [] })],
    ['POST', index + '/documents/fetch', json({ results: [] })],
    ['POST', index + '/documents?primaryKey=id', () => { markEnqueue(); return enqueue; }],
    ['GET', queued, json({ results: [{ uid: 44 }] })],
    ['GET', '/tasks/44', json({ status: 'succeeded' })],
    ['POST', index + '/documents/fetch', json({ results: [{ id, revision: 11 }] })],
  ]);
  const start = provider.upsert(env.ctx, { documents: [doc('shared', 11)] });
  await Promise.race([reachedEnqueue, start.then(() => { throw new Error('first write finished before reaching its enqueue'); })]);
  const late = provider.upsert(env.ctx, { documents: [doc('shared', 10)] });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.requests.length, 3, 'the second write is parked before reading the queue');
  } finally { release(json({ taskUid: 44 }, 202)); }
  assert.deepEqual(await start, success({ outcomes: [{ key: key('shared'), revision: 11, status: 'pending' }], taskId: '44' }));
  assert.deepEqual(await late, success({ outcomes: [{ key: key('shared'), revision: 10, status: 'stale' }] }));
  env.expectRequests();
});
