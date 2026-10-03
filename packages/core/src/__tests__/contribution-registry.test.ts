import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createContributionRegistry } from '../contribution-registry.js';

interface Contribution { domain: string; tools: readonly string[]; }
const keyOf = ({ contribution }: { contribution: Contribution }) => contribution.domain;

// Generalized from the original registry mechanics tests; host catalog tests stay in the host.
test('new registry has no contributions and appends in registration order', () => {
  const registry = createContributionRegistry({ keyOf });
  assert.deepEqual(registry.list({}), []);
  registry.register({ contribution: { domain: 'alpha', tools: ['alpha_one'] } });
  registry.register({ contribution: { domain: 'beta', tools: ['beta_one'] } });
  assert.deepEqual(registry.list({}).map(c => c.domain), ['alpha', 'beta']);
});

test('repeated domain replaces in place without appending or reordering', () => {
  const registry = createContributionRegistry({ keyOf });
  registry.register({ contribution: { domain: 'alpha', tools: ['alpha_one'] } });
  registry.register({ contribution: { domain: 'beta', tools: ['beta_one'] } });
  registry.register({ contribution: { domain: 'alpha', tools: ['alpha_two'] } });
  assert.deepEqual(registry.list({}), [
    { domain: 'alpha', tools: ['alpha_two'] }, { domain: 'beta', tools: ['beta_one'] },
  ]);
});

test('list snapshots and separate ordinary/derived instances cannot alter each other', () => {
  const ordinary = createContributionRegistry({ keyOf });
  const derived = createContributionRegistry({ keyOf });
  const first = { domain: 'alpha', tools: ['one'] };
  ordinary.register({ contribution: first });
  const snapshot = ordinary.list({});
  (snapshot as Contribution[]).pop();
  assert.deepEqual(ordinary.list({}), [first]);
  assert.deepEqual(derived.list({}), []);
  derived.register({ contribution: { domain: 'alpha', tools: ['derived'] } });
  ordinary.clear({});
  assert.deepEqual(ordinary.list({}), []);
  assert.deepEqual(derived.list({}), [{ domain: 'alpha', tools: ['derived'] }]);
});

test('key policy can select a different identity without changing the factory', () => {
  const registry = createContributionRegistry({ keyOf: ({ contribution }: { contribution: { id: number } }) => contribution.id });
  registry.register({ contribution: { id: 42 } });
  registry.register({ contribution: { id: 42 } });
  assert.deepEqual(registry.list({}), [{ id: 42 }]);
});
