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
