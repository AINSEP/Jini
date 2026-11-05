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
test('static receiver uses the live UTF-16 string length and rejects repeated scalar values', () => {
  assert.ok(check({ type: 'text', maxLength: 1 }, ['😀']).error);
  assert.ok(check({ type: 'number' }, ['1', '2']).error);
  assert.ok(check({ type: 'multi-select', options: ['yes'] }, ['yes', 'yes']).error);
});
