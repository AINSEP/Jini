/**
 * @file The Resend plugin as a Jini `MailProviderModule`: contract shape (validated by Jini's own
 * `validateMailProvider`), Svix signature verification with rotation and replay window, event
 * normalization, Domains API mapping through a fake guarded client, and the send path's error and
 * rate-limit mapping. No network: every HTTP call goes to a fake.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { validateMailProvider } from '@jini-ai/platform/mail';

import resend from '../adapters/resend.mjs';
import { domainState, qualify, retryAfterMs } from '../lib/domains.mjs';
import { parse, SVIX_TOLERANCE_SECONDS, verify } from '../lib/feedback.mjs';

const KEY = Buffer.from('test-signing-key-0123456789');
const SECRET = `whsec_${KEY.toString('base64')}`;
const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const TS = String(NOW / 1000);
const enc = (text) => new TextEncoder().encode(text);

function sign(body, { id = 'msg_1', timestamp = TS, key = KEY } = {}) {
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}
function headers(body, overrides = {}) {
  return { 'svix-id': 'msg_1', 'svix-timestamp': TS, 'svix-signature': `v1,${sign(body)}`, ...overrides };
}

test('the module is a valid Jini mail provider and matches its v2 descriptor', async () => {
  assert.equal(validateMailProvider({ provider: resend }), undefined);
  assert.equal(resend.id, 'resend');
  assert.deepEqual(resend.credentialKeys, ['token']);
  assert.deepEqual(resend.capabilities, { hosted: true, feedback: true, domainVerification: true, rateLimit: { perSecond: 2, burst: 2 } });
  const descriptor = JSON.parse(await readFile(new URL('../tovu-mail-adapters.json', import.meta.url), 'utf8'));
  assert.equal(descriptor.schemaVersion, 2);
  assert.deepEqual(descriptor.adapters[0], {
    id: 'resend', label: 'Resend', module: 'adapters/resend.mjs', credentialLabel: 'Tovu Mail — Resend API', credentialKeys: ['token'], feedback: true,
    credentialCard: {
      title: 'Connect Resend',
      // 7d1f99532 declares each card's display-only purpose.
      usedFor: ["Sends your site's emails (sign-in links, form notices, newsletters)"],
      intro: 'Connect Resend so this site can send its email (sign-in links, confirmations, form notifications).',
      helpUrl: 'https://resend.com/api-keys', helpLabel: 'Get a key at resend.com/api-keys',
      keyHint: 'Create a key with Sending access', baseUrl: 'https://api.resend.com',
    },
  });
});

test('verify accepts a valid Svix signature, with or without the whsec_ prefix, under any listed secret', () => {
  const body = '{"type":"email.delivered"}';
  const rawBody = enc(body);
  assert.equal(verify({ rawBody, headers: headers(body), secrets: [SECRET], now: NOW }), true);
  assert.equal(verify({ rawBody, headers: headers(body), secrets: [KEY.toString('base64')], now: NOW }), true);
  const rotated = `whsec_${Buffer.from('another-key').toString('base64')}`;
  assert.equal(verify({ rawBody, headers: headers(body), secrets: [rotated, SECRET], now: NOW }), true, 'the previous secret still verifies');
  const several = `v1,${sign(body, { key: Buffer.from('x') })} v2,abc v1, v1,${sign(body)}`;
  assert.equal(verify({ rawBody, headers: headers(body, { 'svix-signature': several }), secrets: [SECRET], now: NOW }), true, 'any v1 entry may match');
});

test('verify refuses wrong secrets, tampered bodies, stale or future timestamps and missing headers', () => {
  const body = '{"a":1}';
  const rawBody = enc(body);
  const check = (overrides, extra = {}) => verify({ rawBody, headers: headers(body, overrides), secrets: [SECRET], now: NOW, ...extra });
  assert.equal(verify({ rawBody, headers: headers(body), secrets: [`whsec_${Buffer.from('nope').toString('base64')}`], now: NOW }), false);
  assert.equal(verify({ rawBody: enc('{"a":2}'), headers: headers(body), secrets: [SECRET], now: NOW }), false);
  assert.equal(check({}, { now: NOW + (SVIX_TOLERANCE_SECONDS + 1) * 1000 }), false);
  assert.equal(check({}, { now: NOW - (SVIX_TOLERANCE_SECONDS + 1) * 1000 }), false);
  assert.equal(check({}, { now: NOW + SVIX_TOLERANCE_SECONDS * 1000 }), true, 'the window edge is inside');
  assert.equal(check({ 'svix-id': '' }), false);
  assert.equal(check({ 'svix-timestamp': '' }), false);
  assert.equal(check({ 'svix-signature': '' }), false);
  assert.equal(check({ 'svix-timestamp': '12.5' }), false);
  assert.equal(check({ 'svix-signature': 'v1,c2hvcnQ=' }), false, 'a different-length signature never matches');
  assert.equal(verify({ rawBody, headers: headers(body), secrets: [null], now: NOW }), false, 'a bad secret value is false, not a throw');
});

test('parse normalizes bounces, complaints and deliveries per recipient', () => {
  const bounced = { type: 'email.bounced', created_at: '2026-10-21T11:00:00.000Z', data: { email_id: 'em_1', to: [' A@X.test ', 'b@x.test', ''], bounce: { type: 'Permanent' } } };
  const events = parse({ rawBody: enc(JSON.stringify(bounced)), workspaceId: 'wa' });
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    workspaceId: 'wa', providerMessageId: 'em_1', sourceContext: { module: 'unknown' }, kind: 'bounced', eventId: `${events[0].eventId.split(':')[0]}:a@x.test`,
    recipient: 'a@x.test', hardBounce: true, occurredAt: '2026-10-21T11:00:00.000Z',
  });
  assert.match(events[0].eventId, /^[0-9a-f]{64}:a@x\.test$/, 'no payload id: the body hash, per recipient');
  assert.equal(parse({ rawBody: enc(JSON.stringify(bounced)), workspaceId: 'wa' })[1].eventId, events[1].eventId, 'a replay gets the same id');

  const soft = parse({ rawBody: enc(JSON.stringify({ type: 'email.bounced', id: 'evt_9', data: { to: 'c@x.test', created_at: '2026-10-21T10:00:00.000Z', bounce: { type: 'Transient' } } })), workspaceId: 'wa' });
  assert.deepEqual([soft[0].eventId, soft[0].hardBounce, soft[0].providerMessageId, soft[0].occurredAt], ['evt_9', false, '', '2026-10-21T10:00:00.000Z']);
  const hard = parse({ rawBody: enc(JSON.stringify({ type: 'email.bounced', data: { to: ['c@x.test'], bounce: { type: 'hard' } } })), workspaceId: 'wa' });
  assert.equal(hard[0].hardBounce, true);
  assert.match(hard[0].occurredAt, /^\d{4}-\d\d-\d\dT/, 'no timestamp in the payload: receipt time');
  const untyped = parse({ rawBody: enc(JSON.stringify({ type: 'email.bounced', data: { to: ['c@x.test'], bounce: {} } })), workspaceId: 'wa' });
  assert.equal(untyped[0].hardBounce, false, 'a bounce without a type is not hard');
  const noBounce = parse({ rawBody: enc(JSON.stringify({ type: 'email.bounced', id: '', data: { to: ['c@x.test'] } })), workspaceId: 'wa' });
  assert.equal(noBounce[0].hardBounce, false);
  assert.match(noBounce[0].eventId, /^[0-9a-f]{64}$/, 'an empty payload id falls back to the body hash');
  const complained = parse({ rawBody: enc(JSON.stringify({ type: 'email.complained', data: { email_id: 'em_2', to: ['d@x.test'] } })), workspaceId: 'wa' });
  assert.deepEqual([complained[0].kind, complained[0].hardBounce], ['complained', false]);
  const delivered = parse({ rawBody: enc(JSON.stringify({ type: 'email.delivered', data: { to: ['d@x.test'] } })), workspaceId: 'wa' });
  assert.equal(delivered[0].kind, 'delivered');
});

test('parse keys the event id on svix-id when the host passes headers, then the payload id', () => {
  const one = { type: 'email.complained', id: 'evt_1', data: { to: ['a@x.test'] } };
  const many = { type: 'email.bounced', id: 'evt_2', data: { to: ['a@x.test', 'B@x.test'], bounce: { type: 'Permanent' } } };
  const ids = (payload, headers) => parse({ rawBody: enc(JSON.stringify(payload)), workspaceId: 'wa', headers }).map((item) => item.eventId);
  assert.deepEqual(ids(one, { 'svix-id': 'msg_1' }), ['msg_1']);
  assert.deepEqual(ids(many, { 'svix-id': 'msg_2' }), ['msg_2:a@x.test', 'msg_2:b@x.test'], 'one id per recipient');
  assert.deepEqual(ids(one, { 'svix-id': '' }), ['evt_1'], 'an empty svix-id falls back to the payload id');
  assert.deepEqual(ids(one, {}), ['evt_1']);
});

test('parse ignores other event types and reports malformed bodies', () => {
  assert.deepEqual(parse({ rawBody: enc(JSON.stringify({ type: 'email.opened', data: {} })), workspaceId: 'wa' }), []);
  assert.deepEqual(parse({ rawBody: enc('not json'), workspaceId: 'wa' }), { error: 'body is not JSON' });
  for (const body of ['[]', 'null', '{"data":{}}', '{"type":"email.bounced"}', '{"type":"email.bounced","data":[]}']) {
    assert.deepEqual(parse({ rawBody: enc(body), workspaceId: 'wa' }), { error: 'not a Resend webhook event' }, body);
  }
});

/** A fake guarded client answering by path; records each request. */
function fakeHttp(routes) {
  const requests = [];
  return {
    requests,
    send: async (input) => {
      requests.push(input);
      const route = routes[new URL(input.request.url).pathname];
      if (route instanceof Error) throw route;
      return route ?? { status: 404, bodyText: '{}' };
    },
  };
}
const ok = (value) => ({ status: 200, bodyText: JSON.stringify(value) });
const ctxWith = (httpClient, baseUrl) => ({ workspaceId: 'wa', mode: 'live', credential: { token: 're_test', ...(baseUrl ? { baseUrl } : {}) }, httpClient });

test('domainRequirements maps Resend records to qualified DNS requirements', async () => {
  const http = fakeHttp({
    '/domains': ok({ data: [{ id: 'other', name: 'other.test' }, { id: 'd 1', name: 'Example.com', status: 'pending' }] }),
    '/domains/d%201': ok({ records: [
      { record: 'SPF', type: 'MX', name: 'send', value: 'feedback-smtp.us-east-1.amazonses.com', ttl: 3600, priority: 10 },
      { record: 'SPF', type: 'TXT', name: 'send.example.com', value: 'v=spf1 include:amazonses.com ~all', ttl: 'Auto' },
      { record: 'DKIM', type: 'TXT', name: 'resend._domainkey', value: 'p=MIGf' },
      { type: 'CNAME', name: '@' },
      { type: 'TXT', value: '_dmarc-less' },
      { record: 'X', type: 'SRV', name: 'x', value: 'y' },
    ] }),
  });
  const result = await resend.domainRequirements(ctxWith(http), { domain: 'EXAMPLE.com' });
  assert.deepEqual(result, { status: 'ok', value: { purpose: 'mail', domain: 'example.com', providerId: 'resend', records: [
    { type: 'MX', name: 'send.example.com', value: 'feedback-smtp.us-east-1.amazonses.com', ttl: 3600, priority: 10, note: 'SPF record' },
    { type: 'TXT', name: 'send.example.com', value: 'v=spf1 include:amazonses.com ~all', note: 'SPF record' },
    { type: 'TXT', name: 'resend._domainkey.example.com', value: 'p=MIGf', note: 'DKIM record' },
    { type: 'CNAME', name: 'example.com', value: '', note: 'Resend record' },
    { type: 'TXT', name: 'example.com', value: '_dmarc-less', note: 'Resend record' },
  ] } });
  const [first] = http.requests;
  assert.equal(first.request.url, 'https://api.resend.com/domains');
  assert.equal(first.url, first.request.url, 'the request is readable in both client shapes');
  assert.deepEqual(first.request.headers, { Authorization: 'Bearer re_test' });
});

test('domainRequirements: an unknown domain, a failed detail read, and odd list/record shapes', async () => {
  const missing = await resend.domainRequirements(ctxWith(fakeHttp({ '/domains': ok({ data: [{}] }) })), { domain: 'example.com' });
  assert.deepEqual(missing, { status: 'rejected', error: { code: 'not_found', message: 'Add example.com under Domains in Resend first' } });
  assert.equal((await resend.domainRequirements(ctxWith(fakeHttp({ '/domains': ok({}) })), { domain: 'a.test' })).error.code, 'not_found');
  const detailDown = fakeHttp({ '/domains': ok({ data: [{ id: 'd', name: 'a.test' }] }), '/domains/d': { status: 503, bodyText: '' } });
  assert.deepEqual(await resend.domainRequirements(ctxWith(detailDown), { domain: 'a.test' }), { status: 'unknown', error: { code: 'provider_unavailable', message: 'Resend responded with HTTP 503' } });
  const noRecords = fakeHttp({ '/domains': ok({ data: [{ id: 'd', name: 'a.test' }] }), '/domains/d': ok({}) });
  assert.deepEqual((await resend.domainRequirements(ctxWith(noRecords), { domain: 'a.test' })).value.records, []);
  const listDown = await resend.domainRequirements(ctxWith(fakeHttp({ '/domains': { status: 401, bodyText: '' } })), { domain: 'a.test' });
  assert.equal(listDown.error.code, 'unauthorized');
  // A Sending access key is a permission refusal, which the host may retry with the account key.
  const restricted = await resend.domainStatus(ctxWith(fakeHttp({ '/domains': { status: 401, bodyText: '{"statusCode":401,"name":"restricted_api_key","message":"This API key is restricted to only send emails"}' } })), { domain: 'a.test' });
  assert.equal(restricted.error.code, 'forbidden');
  const badKey = await resend.domainStatus(ctxWith(fakeHttp({ '/domains': { status: 401, bodyText: '{"name":"invalid_api_key"}' } })), { domain: 'a.test' });
  assert.equal(badKey.error.code, 'unauthorized');
});

test('domainStatus maps Resend states and the custom base URL is used', async () => {
  const http = fakeHttp({ '/v1/domains': ok({ data: [{ id: '1', name: 'v.test', status: 'verified' }, { id: '2', name: 'f.test', status: 'failed' }, { id: '3', name: 'p.test', status: 'temporary_failure' }] }) });
  const ctx = ctxWith(http, 'https://proxy.test/v1');
  const state = async (domain) => (await resend.domainStatus(ctx, { domain })).value.state;
  assert.deepEqual([await state('v.test'), await state('F.test'), await state('p.test'), await state('none.test')], ['verified', 'failed', 'pending', 'not_found']);
  assert.equal(http.requests[0].request.url, 'https://proxy.test/v1/domains');
  assert.equal((await resend.domainStatus(ctxWith(fakeHttp({})), { domain: 'x.test' })).error.code, 'not_found', 'an API 404 is a rejection');
  assert.deepEqual([domainState(undefined), qualify('', 'a.test'), qualify('A.TEST', 'a.test')], ['pending', 'a.test', 'a.test']);
});

test('domain calls never throw: HTTP failures, network errors and non-JSON bodies become results', async () => {
  const status = async (response) => (await resend.domainStatus(ctxWith(fakeHttp({ '/domains': response })), { domain: 'a.test' }));
  assert.deepEqual(await status({ status: 429, bodyText: '', headers: { 'retry-after': '2' } }), { status: 'rejected', error: { code: 'rate_limited', message: 'Resend rate limit reached', retryAfterMs: 2000 } });
  assert.deepEqual(await status({ status: 429, bodyText: '' }), { status: 'rejected', error: { code: 'rate_limited', message: 'Resend rate limit reached' } });
  assert.equal((await status({ status: 403, bodyText: '' })).error.code, 'forbidden');
  assert.equal((await status({ status: 422, bodyText: '' })).error.code, 'provider_error');
  assert.deepEqual(await status({ status: 200, bodyText: '<html>' }), { status: 'unknown', error: { code: 'unexpected_response', message: 'Resend returned a body that is not JSON' } });
  assert.deepEqual(await status(new Error('socket hang up')), { status: 'unknown', error: { code: 'network', message: 'socket hang up' } });
  const thrown = await resend.domainStatus(ctxWith({ send: async () => { throw 'boom'; } }), { domain: 'a.test' });
  assert.deepEqual(thrown.error, { code: 'network', message: 'boom' });
  assert.deepEqual([retryAfterMs({ 'Retry-After': '0.5' }), retryAfterMs({ 'retry-after': '' }), retryAfterMs({ 'retry-after': 'soon' }), retryAfterMs({ 'retry-after': '-1' }), retryAfterMs(undefined)], [500, undefined, undefined, undefined, undefined]);
});

/** The send path keeps its positional Tovu client shape. */
function sendClient(response) {
  const calls = [];
  return { calls, send: async (request) => { calls.push(request); if (response instanceof Error) throw response; return response; } };
}
const MESSAGE = { to: { email: 'a@x.test', name: 'A' }, from: { email: 's@x.test' }, replyTo: { email: 'r@x.test' }, subject: 'Hi', html: '<p>Hi</p>', text: 'Hi',
  headers: { 'X-T': '1' }, attachments: [{ filename: 'a.txt', contentType: 'text/plain', contentBase64: 'YQ==' }] };

test('send posts to /emails with the idempotency key and maps success, errors and 429 back-off', async () => {
  const success = sendClient({ status: 200, bodyText: '{"id":"em_1"}' });
  const mailer = resend.create({ credential: { token: 're_t' }, kit: { httpClient: success } });
  const sent = await mailer.send(MESSAGE, { idempotencyKey: 'k1' });
  assert.deepEqual([sent.ok, sent.providerMessageId], [true, 'em_1']);
  const call = success.calls[0];
  assert.deepEqual([call.url, call.headers['Idempotency-Key'], call.timeoutMs], ['https://api.resend.com/emails', 'k1', 10_000]);
  assert.deepEqual(JSON.parse(call.body), { from: 's@x.test', to: 'A <a@x.test>', subject: 'Hi', reply_to: 'r@x.test', html: '<p>Hi</p>', text: 'Hi', headers: { 'X-T': '1' },
    attachments: [{ filename: 'a.txt', content: 'YQ==', content_type: 'text/plain' }] });

  const plain = resend.create({ credential: { token: 't', baseUrl: 'https://b.test' }, kit: { httpClient: sendClient({ status: 202, bodyText: 'garbled' }) } });
  assert.equal((await plain.send({ to: { email: 'a@x.test' }, from: { email: 's@x.test' }, subject: 'S' }, { idempotencyKey: 'k2', timeoutMs: 5 })).providerMessageId, 'k2');

  const limited = resend.create({ credential: { token: 't' }, kit: { httpClient: sendClient({ status: 429, bodyText: '{"name":"rate_limit_exceeded","message":"slow down"}', headers: { 'retry-after': '1' } }) } });
  // Throttling is normalized to the shared mail contract's code so every caller defers it; the provider's name stays in the message.
  assert.deepEqual(await limited.send(MESSAGE, { idempotencyKey: 'k' }), { ok: false, retryable: true, errorCode: 'MAIL_RATE_LIMITED', message: 'slow down (rate_limit_exceeded)', retryAfterMs: 1000 });
  const bare = resend.create({ credential: { token: 't' }, kit: { httpClient: sendClient({ status: 429, bodyText: '' }) } });
  assert.deepEqual(await bare.send(MESSAGE, { idempotencyKey: 'k' }), { ok: false, retryable: true, errorCode: 'MAIL_RATE_LIMITED', message: 'Resend responded with HTTP 429 (HTTP_429)' });
  const invalid = resend.create({ credential: { token: 't' }, kit: { httpClient: sendClient({ status: 422, bodyText: '' }) } });
  assert.deepEqual(await invalid.send(MESSAGE, { idempotencyKey: 'k' }), { ok: false, retryable: false, errorCode: 'HTTP_422', message: 'Resend responded with HTTP 422' });
  const empty = resend.create({ credential: { token: 't' }, kit: { httpClient: sendClient({ status: 500, bodyText: '{"name":"","message":""}' }) } });
  assert.deepEqual(await empty.send(MESSAGE, { idempotencyKey: 'k' }), { ok: false, retryable: true, errorCode: 'HTTP_500', message: '{"name":"","message":""}' });
  const conflict = resend.create({ credential: { token: 't' }, kit: { httpClient: sendClient({ status: 409, bodyText: 'proxy' }) } });
  assert.equal((await conflict.send(MESSAGE, { idempotencyKey: 'k' })).retryable, true);
  const down = resend.create({ credential: { token: 't' }, kit: { httpClient: sendClient(new Error('egress refused')) } });
  assert.deepEqual(await down.send(MESSAGE, { idempotencyKey: 'k' }), { ok: false, retryable: true, errorCode: 'TRANSPORT_ERROR', message: 'egress refused' });
  const odd = resend.create({ credential: { token: 't' }, kit: { httpClient: { send: async () => { throw 'x'; } } } });
  assert.equal((await odd.send(MESSAGE, { idempotencyKey: 'k' })).message, 'x');
});

test('sendBatch sends one message per key suffix and capabilities stay as before', async () => {
  const client = sendClient({ status: 200, bodyText: '{"id":"em"}' });
  const mailer = resend.create({ credential: { token: 't' }, kit: { httpClient: client } });
  const results = await mailer.sendBatch([MESSAGE, MESSAGE], { idempotencyKey: 'b' });
  assert.equal(results.length, 2);
  assert.deepEqual(client.calls.map((call) => call.headers['Idempotency-Key']), ['b:0', 'b:1']);
  assert.deepEqual(mailer.capabilities(), { driver: 'resend', supportsIdempotencyKey: true, supportsWebhookFeedback: true, maxBatchSize: 1, supportsAttachments: true });
});

test('domain errors keep the canonical code and carry Resend name and human-readable message for restricted API keys', async () => {
  const http = { send: async () => ({ status: 403, bodyText: JSON.stringify({ name: 'restricted_api_key', message: 'This API key is restricted to sending emails. Use a full-access key to list domains.' }) }) };
  const result = await resend.domainStatus(ctxWith(http), { domain: 'a.test' });
  assert.deepEqual(result, { status: 'rejected', error: { code: 'forbidden', message: 'restricted_api_key: This API key is restricted to sending emails. Use a full-access key to list domains.' } });
});
