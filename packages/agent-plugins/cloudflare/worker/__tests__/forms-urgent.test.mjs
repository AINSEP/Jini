import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest, acknowledge, listPending } from '../forms-receiver.mjs';
import { normalizeForms } from '../../lib/forms.mjs';
import { fakeD1 } from '../../lib/__tests__/d1-fake.mjs';
const fields = [{ name: 'email', type: 'email', required: true }, { name: 'consent', type: 'checkbox', required: true }, { name: 'choice', type: 'select', required: false, options: ['yes'] }];
const manifest = { forms: [{ slug: 'contact', fields }] };
const now = () => Date.parse('2026-11-04T00:00:00Z');
const post = body => new Request('https://site.example/forms/contact/submit', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.9' } });
test('receiver rejects invalid email, unchecked consent and forged choices before reporting success', async () => {
  const d1 = fakeD1(); const env = { TOVU_FORMS: d1.binding };
  for (const body of ['email=wrong&consent=on', 'email=a%40b.co&consent=false', 'email=a%40b.co&consent=on&choice=forged']) {
    assert.equal((await handleRequest({ request: post(body), env, manifest }, { now })).status, 400);
  }
  assert.equal(d1.rows('SELECT * FROM submissions').length, 0);
});
test('receiver stores no raw IP, including in its rate keys', async () => {
  const d1 = fakeD1();
  assert.equal((await handleRequest({ request: post('email=a%40b.co&consent=on'), env: { TOVU_FORMS: d1.binding, TOVU_FORMS_SECRET: 's'.repeat(43) }, manifest }, { now, randomId: () => 's' })).status, 303);
  assert.equal(d1.rows('SELECT ip FROM submissions')[0].ip, null);
  assert.equal(JSON.stringify(d1.rows('SELECT * FROM rate_windows')).includes('203.0.113.9'), false);
});
test('acknowledgement erases committed answers and IP, and is idempotent', async () => {
  const d1 = fakeD1();
  await d1.binding.prepare('INSERT INTO submissions (id,form_slug,answers_json,submitted_at,ip) VALUES (?,?,?,?,?)').bind('s', 'contact', '{"secret":"answer"}', new Date(now()).toISOString(), '203.0.113.9').run();
  const ack = () => acknowledge({ env: { TOVU_FORMS: d1.binding }, request: new Request('https://site.example/_tovu/forms/ack', { method: 'POST', body: JSON.stringify({ ids: ['s'] }) }) }, { now });
  assert.deepEqual(await (await ack()).json(), { acknowledged: 1 });
  assert.deepEqual(d1.rows('SELECT * FROM submissions'), []);
  assert.deepEqual(await (await ack()).json(), { acknowledged: 0 });
});
test('legacy pending IPs never leave the receiver while republish scrubs their stored copies', async () => {
  const d1 = fakeD1();
  await d1.binding.prepare('INSERT INTO submissions (id,form_slug,answers_json,submitted_at,ip) VALUES (?,?,?,?,?)').bind('s','contact','{}','2026-01-01T00:00:00.000Z','203.0.113.9').run();
  const response = await listPending({ env: { TOVU_FORMS: d1.binding }, url: new URL('https://site.example/_tovu/forms/pending') }, { now });
  assert.equal((await response.json()).items[0].ip, null);
});
test('publish refuses files and validation the receiver cannot enforce', () => {
  const kit = { DeployError: class extends Error {} };
  for (const field of [{ name: 'photo', type: 'file' }, { name: 'code', type: 'text', validationUnsupported: true }]) {
    assert.throws(() => normalizeForms({ kit, formDestination: { forms: [{ slug: 'contact', fields: [field] }], secret: 's'.repeat(43) } }), /publish|Publish|file|File/);
  }
});

test('ordinary native fields and empty select placeholders still publish', () => {
  const kit = { DeployError: class extends Error {} };
  const native = ['tel', 'phone', 'url', 'number', 'range', 'date', 'time', 'datetime-local', 'color', 'password'];
  const result = normalizeForms({ kit, formDestination: { forms: [{ slug: 'contact', fields: [...native.map(type => ({ name: type, type })), { name: 'choice', type: 'select', options: ['', 'yes'] }] }], secret: 's'.repeat(43) } });
  assert.deepEqual(result.forms[0].fields.at(-1).options, ['yes']);
});
test('rate pseudonyms depend on the receiver secret and never fall back to unsalted IP hashes', async () => {
  const keys = [];
  for (const secret of ['a'.repeat(43), 'b'.repeat(43)]) {
    const d1 = fakeD1();
    const response = await handleRequest({ request: post('email=a%40b.co&consent=on'), env: { TOVU_FORMS: d1.binding, TOVU_FORMS_SECRET: secret }, manifest }, { now, randomId: () => 's' });
    assert.equal(response.status, 303); keys.push(d1.rows('SELECT key FROM rate_windows')[0].key);
  }
  assert.notEqual(keys[0], keys[1]);
});
