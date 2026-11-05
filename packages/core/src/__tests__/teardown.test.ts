import assert from 'node:assert/strict';
import test from 'node:test';
import { onTeardown } from '../teardown.js';

test('teardown attempts every step in reverse order and reports every failure', async () => {
  const hooks: Array<() => unknown> = [];
  const t = { after: (step: () => unknown) => { hooks.push(step); } };
  const order: string[] = [];
  onTeardown({ t, step: () => { order.push('first'); throw new Error('first failure'); } });
  onTeardown({ t, step: () => { order.push('second'); } });
  onTeardown({ t, step: async () => { order.push('third'); throw new Error('third failure'); } });
  assert.equal(hooks.length, 1);
  await assert.rejects(async () => hooks[0]!(), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map((failure: Error) => failure.message), ['third failure', 'first failure']);
    return true;
  });
  assert.deepEqual(order, ['third', 'second', 'first']);
});

test('a single failure keeps its identity and a clean context has its own queue', async () => {
  const failure = new Error('cleanup failed');
  const hooks: Array<() => unknown> = [];
  const first = { after: (step: () => unknown) => { hooks.push(step); } };
  const second = { after: (step: () => unknown) => { hooks.push(step); } };
  onTeardown({ t: first, step: () => { throw failure; } });
  let cleaned = false;
  onTeardown({ t: second, step: () => { cleaned = true; } });
  await assert.rejects(async () => hooks[0]!(), error => error === failure);
  await hooks[1]!();
  assert.equal(cleaned, true);
});
