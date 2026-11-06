import assert from 'node:assert/strict';
import test from 'node:test';
import { checkFields } from '../forms-receiver.mjs';

const check = (field, values) => checkFields({ form: { fields: [{ name: 'answer', required: false, ...field }] }, fields: new Map(values === undefined ? [] : [['answer', values]]) });
test('static receiver rejects forged numeric, temporal, phone and URL values using live semantics', () => {
  for (const [field, value] of [
    [{ type: 'number' }, '4oops'], [{ type: 'number', min: 3 }, '2'],
    [{ type: 'number', max: 3 }, '4'], [{ type: 'number', step: 2 }, '3'],
    [{ type: 'range' }, '101'], [{ type: 'date' }, '2026-02-30'],
    [{ type: 'date', min: '2026-02-01' }, '2026-01-31'],
    [{ type: 'time' }, '25:00'], [{ type: 'datetime' }, '2026-02-30T12:00'],
    [{ type: 'phone' }, 'letters'], [{ type: 'url' }, 'javascript:alert(1)'],
  ]) assert.ok(check(field, [value]).error, `${JSON.stringify(field)} must refuse ${value}`);
});
test('static receiver normalizes numeric and checkbox answers and optional missing controls', () => {
  assert.deepEqual(check({ type: 'number', step: 0.5 }, ['2.5']), { answers: { answer: 2.5 } });
  assert.deepEqual(check({ type: 'checkbox' }, ['on']), { answers: { answer: true } });
  assert.deepEqual(check({ type: 'checkbox' }), { answers: {} });
  assert.deepEqual(check({ type: 'number' }, ['']), { answers: {} });
});
test('static receiver preserves published code-point caps and rejects repeated scalar values', () => {
  assert.deepEqual(check({ type: 'text', maxLength: 1 }, ['😀']), { answers: { answer: '😀' } });
  assert.ok(check({ type: 'text', maxLength: 1 }, ['😀😀']).error);
  assert.ok(check({ type: 'number' }, ['1', '2']).error);
  assert.ok(check({ type: 'multi-select', options: ['yes'] }, ['yes', 'yes']).error);
});


test('receiver stores original schema/consent evidence and pull preserves it separately from answers', async () => {
  const { fakeD1 } = await import('../../lib/__tests__/d1-fake.mjs');
  const { handleRequest, listPending } = await import('../forms-receiver.mjs');
  const d1 = fakeD1();
  const evidence = { version: 1, fields: [{ id: 'consent', label: 'I agree to the original terms', type: 'checkbox', required: true }],
    consent: [{ fieldId: 'consent', wording: 'I agree to the original terms' }], schemaHash: 'a'.repeat(64) };
  const manifest = { forms: [{ slug: 'contact', fields: [{ name: 'consent', type: 'checkbox', required: true }], evidence }] };
  const env = { TOVU_FORMS: d1.binding, TOVU_FORMS_SECRET: 's'.repeat(43) };
  const now = () => Date.parse('2026-11-05T18:00:00.000Z');
  const response = await handleRequest({ request: new Request('https://site.example/forms/contact/submit', { method: 'POST', body: 'consent=on', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), env, manifest }, { now, randomId: () => 'new' });
  assert.equal(response.status, 303);
  const page = await (await listPending({ env, url: new URL('https://site.example/_tovu/forms/pending') })).json();
  assert.deepEqual(page.items[0].answers, { consent: true });
  assert.deepEqual(page.items[0].evidence, { ...evidence, capturedAt: '2026-11-05T18:00:00.000Z', source: 'cloudflare' });
  assert.equal('evidence' in page.items[0].answers, false);
});

test('present stale, malformed or duplicate page hashes refuse before validation or D1 writes', async () => {
  const { handleRequest } = await import('../forms-receiver.mjs');
  const hash = 'a'.repeat(64);
  const manifest = { forms: [{ slug: 'contact', evidence: { schemaHash: hash }, fields: [{ name: 'email', type: 'email', required: true }] }] };
  let calls = 0;
  const env = { TOVU_FORMS: { prepare() { calls++; throw new Error('must not reach D1'); }, batch() { calls++; throw new Error('must not reach D1'); } }, TOVU_FORMS_SECRET: 's'.repeat(43) };
  for (const metadata of ['_schemaHash=' + 'b'.repeat(64), '_schemaHash=malformed', '_schemaHash=', '_schemaHash=' + hash + '&_schemaHash=' + hash]) {
    const request = new Request('https://site.example/forms/contact/submit', { method: 'POST', body: 'email=invalid&' + metadata, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const response = await handleRequest({ request, env, manifest });
    assert.equal(response.status, 409);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /This form changed while you were filling it in/);
  }
  assert.equal(calls, 0);
});

test('legacy missing hash and matching hash both accept, but schema metadata never becomes an answer', async () => {
  const { fakeD1 } = await import('../../lib/__tests__/d1-fake.mjs');
  const { handleRequest, listPending } = await import('../forms-receiver.mjs');
  const hash = 'a'.repeat(64);
  const manifest = { forms: [{ slug: 'contact', evidence: { schemaHash: hash }, fields: [{ name: 'email', type: 'email', required: true }] }] };
  const d1 = fakeD1(); const env = { TOVU_FORMS: d1.binding, TOVU_FORMS_SECRET: 's'.repeat(43) };
  let id = 0;
  for (const metadata of ['', '&_schemaHash=' + hash]) {
    const request = new Request('https://site.example/forms/contact/submit', { method: 'POST', body: 'email=ada%40example.com' + metadata, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal((await handleRequest({ request, env, manifest }, { randomId: () => String(++id) })).status, 303);
  }
  const page = await (await listPending({ env, url: new URL('https://site.example/_tovu/forms/pending') })).json();
  assert.equal(page.items.length, 2);
  assert.deepEqual(page.items.map(item => item.answers), [{ email: 'ada@example.com' }, { email: 'ada@example.com' }]);
});

test('a multipart non-text schema hash is malformed metadata and refuses with 409', async () => {
  const { handleRequest } = await import('../forms-receiver.mjs');
  const body = new FormData(); body.set('_schemaHash', new Blob(['not a hash']), 'metadata.txt'); body.set('email', 'ada@example.com');
  const request = new Request('https://site.example/forms/contact/submit', { method: 'POST', body });
  const env = { TOVU_FORMS: { prepare() { throw new Error('must not reach D1'); } } };
  const response = await handleRequest({ request, env, manifest: { forms: [{ slug: 'contact', fields: [], evidence: { schemaHash: 'a'.repeat(64) } }] } });
  assert.equal(response.status, 409);
});
