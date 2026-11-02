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
