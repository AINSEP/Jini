import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest, LIMITS } from '../forms-receiver.mjs';
import { fakeD1 } from '../../lib/__tests__/d1-fake.mjs';

const SECRET = 's'.repeat(43);
const manifest = { forms: [
  { slug: 'waitlist', fields: [{ name: 'email', required: true, maxLength: 20 }, { name: 'interests', required: true, multiple: true }, { name: 'note', required: false }] },
  { slug: 'host', successPath: '/thanks/', fields: [{ name: 'name', required: true }] },
] };

function setup({ fail } = {}) {
  const d1 = fakeD1({ fail });
  const assets = [];
  const env = { TOVU_FORMS: d1.binding, TOVU_FORMS_SECRET: SECRET, ASSETS: { fetch: async request => { assets.push(request.url); return new Response('asset'); } } };
  let clock = Date.parse('2026-10-19T10:00:00Z');
  let ids = 0;
  const options = { now: () => clock, randomId: () => `id-${++ids}` };
  const call = (request) => handleRequest({ request, env, manifest }, options);
  return { d1, env, assets, call, advance: ms => { clock += ms; } };
}

const post = (body, { slug = 'waitlist', type = 'application/x-www-form-urlencoded', headers = {} } = {}) => new Request(`https://site.example/forms/${slug}/submit`, {
  method: 'POST', body, headers: { 'Content-Type': type, Referer: 'https://site.example/join/?form=old&form_status=error&keep=1', 'CF-Connecting-IP': '203.0.113.9', ...headers } });
const valid = 'email=a%40b.co&interests=attending&interests=hosting&_hp=&_attempt=abc';

test('stores a valid submission with repeated checkbox values as an array and 303s back with the host\'s result keys', async () => {
  const s = setup();
  const resp = await s.call(post(valid));
  assert.equal(resp.status, 303);
  assert.equal(resp.headers.get('Location'), '/join/?keep=1&form=waitlist&form_status=success');
  const [row] = s.d1.rows('SELECT * FROM submissions');
  assert.deepEqual(JSON.parse(row.answers_json), { email: 'a@b.co', interests: ['attending', 'hosting'] });
  assert.equal(row.form_slug, 'waitlist');
  assert.equal(row.ip, null, 'the receiver no longer retains raw IPs');
  assert.equal(row.id, 'id-1');
  assert.equal(row.pulled_at, null);
});

test('a form success path wins; without a same-host referer the fallback is the home page', async () => {
  const s = setup();
  assert.equal((await s.call(post('name=Ana', { slug: 'host' }))).headers.get('Location'), '/thanks/');
  const foreign = await s.call(post(valid, { headers: { Referer: 'https://evil.example/x' } }));
  assert.equal(foreign.headers.get('Location'), '/?form=waitlist&form_status=success');
  const none = await s.call(new Request('https://site.example/forms/waitlist/submit', { method: 'POST', body: valid, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
  assert.equal(none.headers.get('Location'), '/?form=waitlist&form_status=success');
  assert.equal(s.d1.rows('SELECT ip FROM submissions')[2].ip, null);
});

test('honeypot pretends success and stores nothing', async () => {
  const s = setup();
  const resp = await s.call(post(`${valid.replace('_hp=', '_hp=bot')}`));
  assert.equal(resp.status, 303);
  assert.equal(s.d1.rows('SELECT * FROM submissions').length, 0);
});

test('light validation refusals render an accessible page with a Go back link and store nothing', async () => {
  const cases = [
    ['interests=attending', 400, /&#34;email&#34; is required/],
    ['email=a%40b.co', 400, /&#34;interests&#34; is required/],
    ['email=a%40b.co&email=c%40d.co&interests=x', 400, /sent more than once/],
    [`email=${'x'.repeat(21)}&interests=x`, 400, /longer than 20/],
    [`email=a&interests=x&note=${'y'.repeat(LIMITS.maxValueLength + 1)}`, 400, /longer than 5000/],
    ['email=a&interests=x&other=1', 400, /&#34;other&#34; is not part of this form/],
  ];
  for (const [body, status, message] of cases) {
    const s = setup();
    const resp = await s.call(post(body));
    assert.equal(resp.status, status, body.slice(0, 40));
    const html = await resp.text();
    assert.match(html, message);
    assert.match(html, /role="alert"/);
    assert.match(html, /<a href="\/join\/\?form=old&#38;form_status=error&#38;keep=1">Go back<\/a>/);
    assert.equal(s.d1.rows('SELECT * FROM submissions').length, 0);
  }
});

test('unknown slug is 404, GET on the submit path is 405, other paths are static assets', async () => {
  const s = setup();
  assert.equal((await s.call(post(valid, { slug: 'missing' }))).status, 404);
  assert.equal((await s.call(new Request('https://site.example/forms/waitlist/submit'))).status, 405);
  assert.equal(await (await s.call(new Request('https://site.example/about/'))).text(), 'asset');
  assert.deepEqual(s.assets, ['https://site.example/about/']);
});

test('body bounds: declared and streamed oversize, too many fields, wrong content type, file parts', async () => {
  const s = setup();
  assert.equal((await s.call(post('x', { headers: { 'Content-Length': String(LIMITS.maxBodyBytes + 1) } }))).status, 413);
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < 3; i += 1) controller.enqueue(new Uint8Array(LIMITS.maxBodyBytes / 2)); controller.close(); } });
  assert.equal((await s.call(new Request('https://site.example/forms/waitlist/submit', { method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }))).status, 413);
  assert.equal((await s.call(post(Array.from({ length: LIMITS.maxFields + 1 }, () => 'interests=a').join('&')))).status, 413);
  assert.equal((await s.call(post('{}', { type: 'application/json' }))).status, 415);
  const files = new FormData();
  files.append('email', 'a@b.co');
  files.append('interests', new File(['x'], 'x.txt'));
  const fileRequest = new Request('https://site.example/forms/waitlist/submit', { method: 'POST', body: files });
  assert.match(await (await s.call(fileRequest)).text(), /File uploads are not accepted/);
  const broken = await s.call(post('--x\r\nbroken', { type: 'multipart/form-data; boundary=zzz' }));
  assert.equal(broken.status, 400);
  assert.equal((await s.call(new Request('https://site.example/forms/waitlist/submit', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }))).status, 400);
});

test('multipart text fields are accepted like URL-encoded ones', async () => {
  const s = setup();
  const body = new FormData();
  body.append('email', 'a@b.co');
  body.append('interests', 'hosting');
  const resp = await s.call(new Request('https://site.example/forms/waitlist/submit', { method: 'POST', body }));
  assert.equal(resp.status, 303);
  assert.deepEqual(JSON.parse(s.d1.rows('SELECT answers_json FROM submissions')[0].answers_json), { email: 'a@b.co', interests: ['hosting'] });
});

test('rate limit: five valid submissions per IP per form per minute, then 429; a new window resets', async () => {
  const s = setup();
  for (let i = 0; i < LIMITS.ratePerWindow; i += 1) assert.equal((await s.call(post(valid))).status, 303);
  assert.equal((await s.call(post(valid))).status, 429);
  assert.equal((await s.call(post('name=Ana', { slug: 'host' }))).status, 303, 'another form has its own window');
  assert.equal((await s.call(post(valid, { headers: { 'CF-Connecting-IP': '198.51.100.1' } }))).status, 303, 'another IP has its own window');
  s.advance(LIMITS.windowSeconds * 1000);
  assert.equal((await s.call(post(valid))).status, 303);
  assert.equal(s.d1.rows('SELECT * FROM submissions').length, 8);
});

test('stale rate windows are pruned in the same batch', async () => {
  const s = setup();
  s.d1.sqlite.exec("INSERT INTO rate_windows (key, window_start, count) VALUES ('old', 1, 3)");
  await s.call(post(valid));
  // Receiver-secret salting prevents offline IPv4 enumeration; pruning retains exactly that key.
  assert.deepEqual(s.d1.rows('SELECT key FROM rate_windows').map(row => row.key), [
    createHash('sha256').update(JSON.stringify([SECRET, 'waitlist', '203.0.113.9'])).digest('hex'),
  ]);
});

test('storage failure answers 503 without logging answers', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const s = setup({ fail: sql => sql.startsWith('INSERT INTO submissions') });
    const resp = await s.call(post(valid));
    assert.equal(resp.status, 503);
    assert.deepEqual(errors, ['FORMS_STORE_FAILED']);
  } finally { console.error = original; }
});

const privateCall = (s, path, { method = 'GET', token = SECRET, body } = {}) => s.call(new Request(`https://site.example${path}`, {
  method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), headers: token ? { Authorization: `Bearer ${token}` } : {} }));

test('private API requires the exact bearer key', async () => {
  const s = setup();
  assert.equal((await privateCall(s, '/_tovu/forms/pending', { token: null })).status, 401);
  assert.equal((await privateCall(s, '/_tovu/forms/pending', { token: 'wrong' })).status, 401);
  assert.equal((await privateCall(s, '/_tovu/forms/pending', { token: `${SECRET}x` })).status, 401);
  s.env.TOVU_FORMS_SECRET = 'short';
  assert.equal((await privateCall(s, '/_tovu/forms/pending', { token: 'short' })).status, 401);
  assert.equal((await privateCall(s, '/_tovu/forms/pending', { method: 'POST' })).status, 405);
  assert.equal((await privateCall(s, '/_tovu/forms/ack')).status, 405);
});

test('pending pages oldest first after a cursor; ack marks only listed unpulled rows', async () => {
  const s = setup();
  for (let i = 0; i < 3; i += 1) { await s.call(post(valid)); }
  const first = await (await privateCall(s, '/_tovu/forms/pending?limit=2')).json();
  assert.deepEqual(first.items.map(item => item.seq), [1, 2]);
  assert.equal(first.items[0].formSlug, 'waitlist');
  assert.deepEqual(first.items[0].answers.interests, ['attending', 'hosting']);
  assert.equal(first.hasMore, true);
  const second = await (await privateCall(s, `/_tovu/forms/pending?after=${first.nextAfter}&limit=500`)).json();
  assert.deepEqual(second.items.map(item => item.id), ['id-3']);
  assert.equal(second.hasMore, false);
  const acked = await (await privateCall(s, '/_tovu/forms/ack', { method: 'POST', body: { ids: ['id-1', 'id-2', 'unknown'] } })).json();
  assert.equal(acked.acknowledged, 2);
  assert.equal((await (await privateCall(s, '/_tovu/forms/ack', { method: 'POST', body: { ids: ['id-1'] } })).json()).acknowledged, 0);
  const rest = await (await privateCall(s, '/_tovu/forms/pending?after=garbage&limit=0')).json();
  assert.deepEqual(rest.items.map(item => item.id), ['id-3']);
  const empty = await (await privateCall(s, '/_tovu/forms/pending?after=9')).json();
  assert.deepEqual(empty, { items: [], nextAfter: 9, hasMore: false });
});

test('ack refuses malformed id lists; storage failure on the private API is 503', async () => {
  const s = setup();
  for (const body of [{}, { ids: [] }, { ids: [1] }, { ids: [''] }, { ids: ['x'.repeat(65)] }, { ids: Array.from({ length: 101 }, (_, i) => `i${i}`) }]) {
    assert.equal((await privateCall(s, '/_tovu/forms/ack', { method: 'POST', body })).status, 400);
  }
  const notJson = await s.call(new Request('https://site.example/_tovu/forms/ack', { method: 'POST', body: 'nope', headers: { Authorization: `Bearer ${SECRET}` } }));
  assert.equal(notJson.status, 400);
  const original = console.error;
  console.error = () => {};
  try {
    const broken = setup({ fail: sql => sql.startsWith('SELECT') });
    assert.equal((await privateCall(broken, '/_tovu/forms/pending')).status, 503);
  } finally { console.error = original; }
});

test('default clock and id ports are the platform ones', async () => {
  const s = setup();
  const env = s.env;
  assert.equal((await handleRequest({ request: post(valid), env, manifest })).status, 303);
  const [row] = s.d1.rows('SELECT id, submitted_at FROM submissions');
  assert.match(row.id, /^[0-9a-f-]{36}$/);
  const ack = await handleRequest({ request: new Request('https://site.example/_tovu/forms/ack', { method: 'POST', body: JSON.stringify({ ids: [row.id] }), headers: { Authorization: `Bearer ${SECRET}` } }), env, manifest });
  assert.equal((await ack.json()).acknowledged, 1);
  assert.deepEqual(s.d1.rows('SELECT * FROM submissions'), [], 'ack removes the remote copy');
});

/** Records handlers and replays them over a scripted element list, like HTMLRewriter's document order. */
function fakeRewriter(elements) {
  return class {
    constructor() { this.handlers = []; }
    on(selector, handler) { this.handlers.push([selector, handler]); return this; }
    transform(response) {
      for (const element of elements) for (const [selector, handler] of this.handlers) if (selector === element.selector) handler.element(element);
      return new Response('rewritten', { status: response.status, headers: response.headers });
    }
  };
}

function element(selector) {
  return { selector, attributes: new Map([['hidden', '']]), inserted: [],
    removeAttribute(name) { this.attributes.delete(name); }, setAttribute(name, value) { this.attributes.set(name, value); },
    after(content, options) { this.inserted.push({ content, options }); } };
}

function pageEnv({ contentType = 'text/html; charset=utf-8', status = 200 } = {}) {
  const seen = [];
  return { seen, env: { ASSETS: { fetch: async request => { seen.push(request.url); return new Response('<html></html>', { status, headers: { 'Content-Type': contentType } }); } } } };
}

const sent = (query = '?form=waitlist&form_status=success', method = 'GET') => new Request(`https://site.example/join/${query}`, { method });

test('a page GET after a successful submission shows the form\'s own success slot and hides the form', async () => {
  const slot = element('div.tovu-form-success[data-form-slug="waitlist"]');
  const form = element('form[data-form-slug="waitlist"]');
  const { env, seen } = pageEnv();
  const resp = await handleRequest({ request: sent(), env, manifest }, { Rewriter: fakeRewriter([slot, form]) });
  assert.equal(await resp.text(), 'rewritten');
  assert.deepEqual(seen, ['https://site.example/join/?form=waitlist&form_status=success']);
  assert.equal(slot.attributes.has('hidden'), false);
  assert.equal(form.attributes.get('hidden'), '');
  assert.deepEqual(form.inserted, [], 'the host\'s own message is used, nothing is added');
});

test('the plain data-tovu-form-success slot is revealed the same way', async () => {
  const slot = element('div[data-tovu-form-success][data-form-slug="waitlist"]');
  const form = element('form[data-form-slug="waitlist"]');
  await handleRequest({ request: sent(), env: pageEnv().env, manifest }, { Rewriter: fakeRewriter([slot, form]) });
  assert.equal(slot.attributes.has('hidden'), false);
  assert.deepEqual(form.inserted, []);
});

test('a page without a success slot gets one minimal accessible message after the first matching form', async () => {
  const first = element('form[data-form-slug="waitlist"]');
  const second = element('form[data-form-slug="waitlist"]');
  await handleRequest({ request: sent(), env: pageEnv().env, manifest }, { Rewriter: fakeRewriter([first, second]) });
  assert.deepEqual(first.inserted, [{ content: '<p class="tovu-form-success" data-form-slug="waitlist" role="status">Thanks, your submission was received.</p>', options: { html: true } }]);
  assert.deepEqual(second.inserted, []);
  assert.equal(second.attributes.get('hidden'), '');
});

test('the sent state is skipped for unknown forms, other statuses, non-GET, non-HTML and failed assets', async () => {
  const never = class { constructor() { throw new Error('rewriter must not run'); } };
  const cases = [
    [sent('?form=nope&form_status=success'), pageEnv()],
    [sent('?form=waitlist&form_status=error'), pageEnv()],
    [sent('?form=waitlist&form_status=success', 'HEAD'), pageEnv()],
    [sent(), pageEnv({ contentType: 'image/png' })],
    [sent(), pageEnv({ status: 404 })],
  ];
  for (const [request, { env, seen }] of cases) {
    const resp = await handleRequest({ request, env, manifest }, { Rewriter: never });
    assert.equal(await resp.text(), '<html></html>');
    assert.equal(seen.length, 1);
  }
  const noType = { ASSETS: { fetch: async () => new Response('x', { status: 200, headers: {} }) } };
  assert.equal(await (await handleRequest({ request: sent(), env: noType, manifest }, { Rewriter: never })).text(), 'x');
  assert.equal(await (await handleRequest({ request: sent(), env: pageEnv().env, manifest }, { Rewriter: undefined })).text(), '<html></html>', 'outside Workers there is no HTMLRewriter');
});
