/**
 * @file Security pins for how `lib/http.mjs` turns the host's token-accessor refusals into safe
 * errors, including the host's per-connection budget refusal (Jini api-connections code
 * `rate-limited` with `retryAfterMs`). The budget refusal must surface as the plugin's `quota-delay`
 * with the host's `retryAfterMs`, follow only the existing inline backoff rules, and never read as an
 * uncertain write: nothing was sent to Google. The refusal here is a fake of that contract shape; a
 * host pins its own refusal class against this plugin in its overlay tests. No request leaves the
 * process: the fetch below is in-memory and counts calls.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGoogleClient } from '../lib/http.mjs';
import { MAX_INLINE_WAIT_MS } from '../lib/request-policy.mjs';

/** The host budget refusal's contract shape: code, retryable, the wait, and nothing applied. */
const budgetRefusal = ({ retryAfterMs }) => Object.assign(new Error('budget reached'), { code: 'rate-limited', retryable: true, retryAfterMs, outcome: 'not-applied' });

const REQUEST = { connectionRef: 'conn-1', url: 'https://sheets.googleapis.com/v4/spreadsheets/sheet-1/values/A1:append', method: 'POST', body: { values: [['x']] }, kind: 'write' };

/** A client whose token reads answer from `reads` in order; `fetched` counts what reached the network seam. */
function clientWith(reads) {
  const state = { fetched: 0, slept: [] };
  const client = createGoogleClient({
    http: { fetch: async () => { state.fetched += 1; return new Response('{"updates":{}}', { status: 200 }); } },
    connections: { getAccessToken: async () => { const next = reads.shift(); if (next instanceof Error) throw next; return next; } },
  }, { sleep: async (ms) => { state.slept.push(ms); }, random: () => 0 });
  return { client, state };
}

test('host budget refusal: a write becomes quota-delay with the host retryAfterMs and outcome not-applied, never uncertain-outcome; nothing is sent', async () => {
  const refusal = budgetRefusal({ retryAfterMs: 60_000 });
  const { client, state } = clientWith([refusal]);
  await assert.rejects(client.request(REQUEST), (error) => {
    assert.deepEqual(error.toJSON(), {
      code: 'quota-delay', message: 'Google asked this site to slow down. Nothing was lost; retry after the delay.',
      retryable: true, outcome: 'not-applied', nextAction: 'retry-later', retryAfterMs: 60_000,
    });
    assert.equal(error.cause, refusal);
    return true;
  });
  assert.equal(state.fetched, 0);
  assert.deepEqual(state.slept, [], 'a wait above the inline ceiling is returned to the caller, not slept');
});

test('host budget refusal: a short wait is retried once by the existing backoff rule (Retry-After honoured), then the write is sent', async () => {
  const { client, state } = clientWith([budgetRefusal({ retryAfterMs: 2_000 }), 'access-token']);
  assert.deepEqual(await client.request(REQUEST), { updates: {} });
  assert.deepEqual(state.slept, [2_000]);
  assert.equal(state.fetched, 1);
});

test('host budget refusal: retries stop at the existing attempt limit and the last refusal is returned', async () => {
  const refusal = () => budgetRefusal({ retryAfterMs: MAX_INLINE_WAIT_MS });
  const { client, state } = clientWith([refusal(), refusal(), refusal(), 'unused']);
  await assert.rejects(client.request(REQUEST), { code: 'quota-delay', retryAfterMs: MAX_INLINE_WAIT_MS, outcome: 'not-applied' });
  assert.deepEqual(state.slept, [MAX_INLINE_WAIT_MS, MAX_INLINE_WAIT_MS]);
  assert.equal(state.fetched, 0);
});

test('host budget refusal: an unusable retryAfterMs is dropped rather than copied into the error', async () => {
  const forged = () => Object.assign(new Error('budget'), { code: 'rate-limited', retryAfterMs: Number.NaN });
  const { client } = clientWith([forged(), forged(), forged()]);
  await assert.rejects(client.request({ ...REQUEST, kind: 'read', method: 'GET', body: undefined }), (error) => error.code === 'quota-delay' && !('retryAfterMs' in error.toJSON()));
});

test('pin: the existing host refusals keep their safe codes and are not retried', async () => {
  for (const [hostCode, code] of [['reconnect-required', 'reconnect-required'], ['not-connected', 'not-connected'], ['connection-not-found', 'not-connected'], ['revocation-pending', 'not-connected'], ['account-changed', 'account-changed']]) {
    const { client, state } = clientWith([Object.assign(new Error('host refusal'), { code: hostCode }), 'unused']);
    await assert.rejects(client.request(REQUEST), { name: 'GoogleWorkspaceError', code, outcome: 'not-applied' }, hostCode);
    assert.deepEqual({ fetched: state.fetched, slept: state.slept }, { fetched: 0, slept: [] }, hostCode);
  }
});

test('pin: any other host error passes through unchanged', async () => {
  const other = Object.assign(new Error('host failure'), { code: 'something-else' });
  const { client } = clientWith([other]);
  await assert.rejects(client.request(REQUEST), (error) => error === other);
});
