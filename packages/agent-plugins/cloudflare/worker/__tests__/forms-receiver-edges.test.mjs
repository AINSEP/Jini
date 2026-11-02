import assert from 'node:assert/strict';
import test from 'node:test';
import { acknowledge, listPending, readFields, withinRate, withSentNotice } from '../forms-receiver.mjs';

// Answers the D1 binding or the asset server may give that real SQLite (forms-receiver.test.mjs) never
// does: rows without a column, a batch result with no `results`, a run result with no `meta`, and
// responses or requests with no Content-Type header at all.

function stubDb(answer) {
  const statement = { bind: () => statement, all: async () => answer, run: async () => answer };
  return { prepare: () => statement, batch: async () => [answer, { results: [] }] };
}

test('an asset answer with no Content-Type passes through unchanged, never rewritten', async () => {
  const original = new Response(new Uint8Array([1, 2]), { status: 200 });
  original.headers.delete('Content-Type');
  const env = { ASSETS: { fetch: async () => original } };
  class NeverUsed { constructor() { throw new Error('must not rewrite'); } }
  assert.equal(await withSentNotice({ request: new Request('https://site.example/x'), env, slug: 'w' }, { Rewriter: NeverUsed }), original);
});

test('a submission with no Content-Type header is refused as not a web form (415)', async () => {
  const request = new Request('https://site.example/forms/w/submit', { method: 'POST', body: new Uint8Array([1]) });
  assert.equal(request.headers.get('Content-Type'), null);
  assert.deepEqual(await readFields({ request }), { error: { status: 415, message: 'This form must be sent as a normal web form.' } });
});

test('a rate counter answer without rows counts as over the limit (fail closed)', async () => {
  assert.equal(await withinRate({ db: stubDb({}), key: 'k', nowMs: 0 }), false);
  assert.equal(await withinRate({ db: stubDb({ results: [] }), key: 'k', nowMs: 0 }), false);
  assert.equal(await withinRate({ db: stubDb({ results: [{ count: 5 }] }), key: 'k', nowMs: 0 }), true);
});

test('a pending row the binding returns without an ip column reads as ip null; no results reads as an empty page', async () => {
  const row = { seq: 3, id: 'r3', form_slug: 'w', answers_json: '{"a":"b"}', submitted_at: '2026-01-01T00:00:00.000Z' };
  const page = await listPending({ env: { TOVU_FORMS: stubDb({ results: [row] }) }, url: new URL('https://s.example/_tovu/forms/pending?after=1&limit=1') });
  assert.deepEqual(await page.json(), { items: [{ seq: 3, id: 'r3', formSlug: 'w', answers: { a: 'b' }, submittedAt: '2026-01-01T00:00:00.000Z', ip: null }], nextAfter: 3, hasMore: true });
  const empty = await listPending({ env: { TOVU_FORMS: stubDb({}) }, url: new URL('https://s.example/_tovu/forms/pending') });
  assert.deepEqual(await empty.json(), { items: [], nextAfter: 0, hasMore: false });
});

test('an acknowledge whose run result has no meta reports zero acknowledged', async () => {
  const request = new Request('https://s.example/_tovu/forms/ack', { method: 'POST', body: JSON.stringify({ ids: ['a'] }) });
  const response = await acknowledge({ request, env: { TOVU_FORMS: stubDb({}) } }, { now: () => 0 });
  assert.deepEqual(await response.json(), { acknowledged: 0 });
});
