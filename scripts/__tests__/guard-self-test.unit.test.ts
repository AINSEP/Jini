import { expect, it } from 'vitest';
import { runGuardSelfTest } from '../lib/self-test.js';

it('detects all known-bad guard fixtures and accepts their known-good counterparts', async () => {
  expect(await runGuardSelfTest()).toEqual([]);
});
