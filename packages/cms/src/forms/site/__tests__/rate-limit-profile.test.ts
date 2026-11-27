import assert from 'node:assert/strict';
import { test } from 'vitest';
import { FORMS_SUBMIT_PROFILE } from '../rate-limit-profile.js';

test('the forms endpoint budgets five requests per minute with no extra burst', () => {
  assert.deepEqual(FORMS_SUBMIT_PROFILE, { windowSeconds: 60, max: 5, burst: 0 });
});
