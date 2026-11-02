/**
 * @file Unit pins for the shared Google client (`lib/http.mjs`), the request policy, and the small
 * helpers every Sheets tool, panel action and form delivery builds on: answers Google can give that
 * the HTTP-level suites cannot produce through the JSON-only fake (an empty 2xx body, an HTML error
 * page, a lost connection), the retry schedule with injected sleep and jitter, Retry-After as an
 * HTTP date, and the defensive answers of the account, file and batch helpers.
 *
 * Transports here are in-process stubs typed against the client's `http.fetch` port; nothing opens
 * a socket, so nothing can reach Google or any third party.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTokenRefresher } from '@jini-ai/oauth';

import { createHooks } from '../lib/auth.mjs';
import { readAccount } from '../lib/drive-files.mjs';
import { createGoogleClient } from '../lib/http.mjs';
import { verifySpreadsheetAccess } from '../lib/picker-selection.mjs';
import { assertProductEnabled } from '../lib/product-state.mjs';
import { GoogleWorkspaceError, classifyFailure, parseRetryAfter } from '../lib/request-policy.mjs';
import { checkRequests } from '../lib/sheets-admin-request-kinds.mjs';
import { outputFits } from '../lib/sheets-client.mjs';

const URL_UNDER_TEST = 'https://sheets.googleapis.com/v4/spreadsheets/sheet-one-0001';
// Minted at runtime; not secret-shaped.
const TOKEN = `fake-access-${'u'.repeat(24)}`;

/**
 * A client over a scripted transport. `answers` are consumed in order; each is
 * `{ status, text, headers }` or `{ throws: Error }`.
 * @param {{ answers: ({ status: number, text?: string, headers?: Record<string, string> } | { throws: Error })[] }} required
 * @param {{ random?: () => number, withoutSleep?: true }} [optional]
 */
function scripted(required, optional = {}) {
  const fetches = [];
  const sleeps = [];
  const http = {
    /** @type {(target: { url: string }, init?: RequestInit) => Promise<Response>} */
    async fetch(target, init) {
      fetches.push({ url: target.url, init });
      const answer = required.answers[Math.min(fetches.length - 1, required.answers.length - 1)];
      if ('throws' in answer) throw answer.throws;
      return new Response(answer.text ?? '', { status: answer.status, headers: answer.headers ?? {} });
    },
  };
  const connections = { getAccessToken: async () => TOKEN };
  const client = createGoogleClient({ http, connections }, {
    ...(optional.withoutSleep ? {} : { sleep: async (ms) => { sleeps.push(ms); } }),
    ...(optional.random ? { random: optional.random } : {}),
  });
  return { client, fetches, sleeps };
}
const read = (client, optional = {}) => client.request({ connectionRef: 'conn-1', url: URL_UNDER_TEST, kind: 'read' }, optional);
const write = (client) => client.request({ connectionRef: 'conn-1', url: URL_UNDER_TEST, method: 'POST', kind: 'write', body: { a: 1 } });

/** Jini's real freshness policy over an in-memory token store and an injected clock. */
function cachedConnection(required) {
  let stored = { accessToken: TOKEN, refreshToken: 'fake-refresh', tokenType: 'Bearer', scopes: [], expiresAt: '2026-10-20T10:30:00.000Z' };
  const calls = { reads: 0, refreshes: 0 };
  const refresher = createTokenRefresher({
    clock: required.clock,
    sleep: async () => { throw new Error('no refresh lease wait expected'); },
    port: {
      async load({ key }) { assert.equal(key, 'conn-1'); calls.reads += 1; return stored; },
      async persist({ tokens }) { stored = tokens; },
      async markNeedsReauth() { throw new Error('no rejected refresh expected'); },
      async refresh() { calls.refreshes += 1; return { ...stored, accessToken: `${TOKEN}-refreshed`, expiresAt: '2026-10-20T12:00:00.000Z' }; },
    },
  });
  return { calls, connections: { getAccessToken: ({ connectionRef }) => refresher.getAccessToken({ key: connectionRef }) } };
}

for (const [kind, invoke] of [['read', read], ['write', write]]) {
  test(`client: a 401 on a ${kind} with Jini's cached token requires reconnect without resending it`, async () => {
    // A corrected host clock can still put Google's rejected token outside Jini's refresh window.
    const cached = cachedConnection({ clock: { nowMs: () => Date.parse('2026-10-20T10:00:00.000Z') } });
    const fetches = [];
    const sleeps = [];
    const http = { async fetch(target, init) { fetches.push(init.headers.authorization); return new Response('', { status: 401 }); } };
    const client = createGoogleClient({ http, connections: cached.connections }, { sleep: async (ms) => { sleeps.push(ms); } });
    await assert.rejects(invoke(client), { code: 'reconnect-required', outcome: 'not-applied', retryable: false });
    assert.deepEqual([cached.calls, fetches, sleeps], [{ reads: 2, refreshes: 0 }, [`Bearer ${TOKEN}`], []]);
  });
}

for (const retryStatus of [200, 401]) {
  test(`client: a 401 on a write retries once after Jini refreshes; HTTP ${retryStatus} ends the retry`, async () => {
    let nowMs = Date.parse('2026-10-20T10:00:00.000Z');
    const cached = cachedConnection({ clock: { nowMs: () => nowMs } });
    const fetches = [];
    const sleeps = [];
    const http = { async fetch(target, init) {
      fetches.push(init.headers.authorization);
      // Google refused a 401 before acting, so even a write can retry once time makes refresh due.
      nowMs = Date.parse('2026-10-20T11:00:00.000Z');
      return new Response('{}', { status: fetches.length === 1 ? 401 : retryStatus });
    } };
    const client = createGoogleClient({ http, connections: cached.connections }, { sleep: async (ms) => { sleeps.push(ms); } });
    if (retryStatus === 200) assert.deepEqual(await write(client), {});
    else await assert.rejects(write(client), { code: 'reconnect-required', outcome: 'not-applied', retryable: false });
    assert.deepEqual([cached.calls, fetches, sleeps], [{ reads: 2, refreshes: 1 }, [`Bearer ${TOKEN}`, `Bearer ${TOKEN}-refreshed`], []]);
  });
}

test('client: a quota wait after a 401 cannot resend the rejected cached token', async () => {
  const cached = cachedConnection({ clock: { nowMs: () => Date.parse('2026-10-20T10:00:00.000Z') } });
  let reads = 0;
  let fetches = 0;
  const sleeps = [];
  const client = createGoogleClient({
    connections: { async getAccessToken(input) {
      reads += 1;
      if (reads === 2) throw Object.assign(new Error('budget'), { code: 'rate-limited', retryAfterMs: 2000 });
      return cached.connections.getAccessToken(input);
    } },
    http: { async fetch() { fetches += 1; return new Response('', { status: 401 }); } },
  }, { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 });
  await assert.rejects(write(client), { code: 'reconnect-required', outcome: 'not-applied', retryable: false });
  assert.deepEqual([reads, cached.calls, fetches, sleeps], [3, { reads: 2, refreshes: 0 }, 1, [2000]]);
});

test('client: an empty 2xx body resolves to null', async () => {
  const { client } = scripted({ answers: [{ status: 200, text: '' }] });
  assert.equal(await read(client), null);
});

test('client: a 2xx body that is not JSON is unexpected-response, not-applied for a read, and is not retried', async () => {
  const { client, fetches } = scripted({ answers: [{ status: 200, text: '<html>ok</html>' }] });
  await assert.rejects(read(client), { code: 'unexpected-response', outcome: 'not-applied', retryable: false });
  assert.equal(fetches.length, 1);
});

test('client: a 2xx body that is not JSON after a write leaves the outcome unknown', async () => {
  const { client } = scripted({ answers: [{ status: 200, text: 'not json' }] });
  await assert.rejects(write(client), { code: 'unexpected-response', outcome: 'unknown' });
});

test('client: an HTML 503 page is service-unavailable; a read is retried with full-jitter backoff, then the error is returned', async () => {
  const { client, fetches, sleeps } = scripted({ answers: [{ status: 503, text: '<html>busy</html>' }] }, { random: () => 0.5 });
  await assert.rejects(read(client), { code: 'service-unavailable', retryable: true, outcome: 'not-applied' });
  assert.equal(fetches.length, 3);
  // round(0.5 * 500 * 2^attempt): 250 ms, then 500 ms; no wait after the last attempt.
  assert.deepEqual(sleeps, [250, 500]);
});

test('client: without an injected jitter source the backoff uses Math.random, within the full-jitter bounds', async (t) => {
  t.mock.method(Math, 'random', () => 0.25);
  const { client, fetches, sleeps } = scripted({ answers: [{ status: 503, text: '<html>busy</html>' }] });
  await assert.rejects(read(client), { code: 'service-unavailable', retryable: true });
  assert.equal(fetches.length, 3);
  // round(0.25 * 500 * 2^attempt): 125 ms, then 250 ms.
  assert.deepEqual(sleeps, [125, 250]);
});

test('client: Retry-After is never undercut by the jitter', async () => {
  const { client, sleeps } = scripted({ answers: [{ status: 429, text: '{}', headers: { 'retry-after': '2' } }, { status: 200, text: '{"ok":true}' }] }, { random: () => 0 });
  assert.deepEqual(await read(client), { ok: true });
  assert.deepEqual(sleeps, [2000]);
});

test('client: without an injected sleep the real timer is used (a zero wait still retries)', async () => {
  const { client, fetches } = scripted({ answers: [{ status: 503, text: '' }, { status: 200, text: '{"n":2}' }] }, { random: () => 0, withoutSleep: true });
  assert.deepEqual(await read(client), { n: 2 });
  assert.equal(fetches.length, 2);
});

test('client: a lost connection on a read is network-error and is retried', async () => {
  const { client, fetches } = scripted({ answers: [{ throws: new TypeError('socket hang up') }, { status: 200, text: '{"n":1}' }] }, { random: () => 0 });
  assert.deepEqual(await read(client), { n: 1 });
  assert.equal(fetches.length, 2);
});

test('client: a lost connection on a write is uncertain-outcome and is sent exactly once', async () => {
  const lost = new TypeError('socket hang up');
  const { client, fetches } = scripted({ answers: [{ throws: lost }] });
  const error = await write(client).catch((caught) => caught);
  assert.equal(error.code, 'uncertain-outcome');
  assert.equal(error.cause, lost);
  assert.equal(fetches.length, 1);
});

test('client: a fetch failing because the caller aborted rethrows the abort and is not retried', async () => {
  const controller = new AbortController();
  const reason = new Error('person cancelled');
  const { client, fetches } = scripted({ answers: [{ throws: reason }] });
  controller.abort(reason);
  await assert.rejects(read(client, { signal: controller.signal }), (error) => error === reason);
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].init.signal, controller.signal);
});

test('client: the token goes only into the authorization header, and a body gets content-type JSON', async () => {
  const { client, fetches } = scripted({ answers: [{ status: 200, text: '{}' }] });
  await write(client);
  assert.deepEqual(fetches[0].init.headers, { authorization: `Bearer ${TOKEN}`, accept: 'application/json', 'content-type': 'application/json' });
  assert.equal(fetches[0].init.body, '{"a":1}');
  assert.equal(fetches[0].url.includes(TOKEN), false);
});

test('policy: Retry-After as an HTTP date becomes the remaining milliseconds', () => {
  const header = 'Tue, 20 Oct 2026 10:00:05 GMT';
  assert.equal(parseRetryAfter({ header }, { nowMs: Date.parse('Tue, 20 Oct 2026 10:00:00 GMT') }), 5000);
});

test('policy: a Retry-After date in the past, a blank header or text that is no date is ignored', () => {
  const nowMs = Date.parse('Tue, 20 Oct 2026 10:00:00 GMT');
  assert.equal(parseRetryAfter({ header: 'Tue, 20 Oct 2026 09:59:00 GMT' }, { nowMs }), undefined);
  assert.equal(parseRetryAfter({ header: '   ' }, { nowMs }), undefined);
  assert.equal(parseRetryAfter({ header: 'soon' }, { nowMs }), undefined);
});

test('policy: a Retry-After over 15 minutes is capped at 15 minutes', () => {
  assert.equal(parseRetryAfter({ header: '86400' }), 15 * 60_000);
});

test('policy: a failure without a status on an idempotent write is network-error with an unknown outcome and keeps its cause', () => {
  const cause = new Error('reset');
  const error = classifyFailure({ kind: 'idempotent-write', cause });
  assert.deepEqual([error.code, error.outcome, error.retryable, error.cause], ['network-error', 'unknown', true, cause]);
});

test('policy: a classified failure with no cause carries none, and its JSON never includes one', () => {
  const error = classifyFailure({ kind: 'read', status: 400 });
  assert.equal('cause' in error, false);
  assert.deepEqual(Object.keys(error.toJSON()).sort(), ['code', 'message', 'nextAction', 'outcome', 'retryable']);
});

/** A client stub answering by URL prefix, typed as the `client.request` port the helpers take. */
function clientAnswering(byUrl) {
  return { async request(input) { return byUrl.find(([prefix]) => input.url.startsWith(prefix))?.[1]; } };
}

test('account: an account with neither email nor name is labelled "Google account"; a name is used when the email is blank', async () => {
  const anonymous = clientAnswering([['https://www.googleapis.com/drive/v3/about', { user: { permissionId: 'perm-1' } }]]);
  assert.deepEqual(await readAccount({ client: anonymous, connectionRef: 'c' }), { accountId: 'perm-1', displayName: 'Google account' });
  const named = clientAnswering([['https://www.googleapis.com/drive/v3/about', { user: { permissionId: 'perm-2', emailAddress: '', displayName: 'Ada' } }]]);
  assert.deepEqual(await readAccount({ client: named, connectionRef: 'c' }), { accountId: 'perm-2', displayName: 'Ada' });
});

test('account: an answer naming no account id is unexpected-response', async () => {
  const empty = clientAnswering([['https://www.googleapis.com/drive/v3/about', { user: { permissionId: '' } }]]);
  await assert.rejects(readAccount({ client: empty, connectionRef: 'c' }), { code: 'unexpected-response' });
});

const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
test('picked file: the title falls back to the Drive name, then to "Untitled spreadsheet"', async () => {
  const drive = (name) => ['https://www.googleapis.com/drive/v3/files/', { id: 'sheet-one-0001', mimeType: SPREADSHEET_MIME, ...(name ? { name } : {}) }];
  const sheets = ['https://sheets.googleapis.com/', { spreadsheetId: 'sheet-one-0001' }];
  const withName = await verifySpreadsheetAccess({ client: clientAnswering([drive('From Drive'), sheets]), connectionRef: 'c', fileId: 'sheet-one-0001' });
  assert.equal(withName.title, 'From Drive');
  const withoutName = await verifySpreadsheetAccess({ client: clientAnswering([drive(undefined), sheets]), connectionRef: 'c', fileId: 'sheet-one-0001' });
  assert.equal(withoutName.title, 'Untitled spreadsheet');
});

test('products: a product id the catalog does not know is refused with product-disabled naming the id itself', async () => {
  await assert.rejects(assertProductEnabled({ state: { get: async () => ({}) }, productId: 'slides-preview' }), (error) => error instanceof GoogleWorkspaceError && error.code === 'product-disabled' && error.message.endsWith('(slides-preview)'));
});

test('products: a known product is named by its label', async () => {
  await assert.rejects(assertProductEnabled({ state: { get: async () => null }, productId: 'sheets' }), (error) => error.code === 'product-disabled' && /\(Google Sheets\)$/.test(error.message));
});

test('batch inventory: a request that is not an object (array, null, text) is invalid-input naming its position', () => {
  for (const request of [[], null, 'deleteSheet']) {
    assert.throws(() => checkRequests({ requests: [{ deleteSheet: { sheetId: 1 } }, request] }), { code: 'invalid-input', message: /request 2 must name exactly one request kind/ });
  }
});

test('batch inventory: a listed kind whose body is not an object is invalid-input naming the kind', () => {
  assert.throws(() => checkRequests({ requests: [{ deleteSheet: 5 }] }), { code: 'invalid-input', message: /request 1 \(deleteSheet\) must be an object/ });
});

test('batch inventory: an empty batch or a batch that is not a list is invalid-input', () => {
  for (const requests of [[], undefined, { deleteSheet: {} }]) assert.throws(() => checkRequests({ requests }), { code: 'invalid-input', message: /the batch has no requests/ });
});

test('output bound: nothing to serialize (undefined) fits', () => {
  assert.equal(outputFits({ value: undefined }), true);
});

/** The revocation hook over a transport that answers once with `status` and `text`. */
const revokeWith = (status, text) => createHooks({ http: { async fetch() { return new Response(text, { status }); } } }).revoke({ token: 'fake-refresh-token' });

test('revocation: a 400 whose body is not JSON is not "already revoked": the revocation stays pending', async () => {
  await assert.rejects(revokeWith(400, '<html>bad</html>'), { message: /Disconnected locally; Google revocation pending/ });
});

test('revocation: a 400 invalid_token answer means Google already revoked it, which counts as confirmed', async () => {
  assert.equal(await revokeWith(400, '{"error":"invalid_token"}'), undefined);
});
