import assert from 'node:assert/strict';
import { test } from 'vitest';
import { DELIVERY_STATUS_MAX_LIMIT } from '../delivery-status-limits.js';

test('a delivery-status read lists at most fifty unfinished deliveries', () => {
  assert.equal(DELIVERY_STATUS_MAX_LIMIT, 50);
});
