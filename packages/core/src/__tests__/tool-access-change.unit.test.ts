import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ToolAccessLoweringError } from '../tool-access-change.js';

/** @file The saved OFF decision stands when the stop cannot be confirmed; the error carries a fixed, cause-free message and a stable code. */
test('ToolAccessLoweringError is an Error with the stable stop-failed code and a cause-free message', () => {
  const error = new ToolAccessLoweringError();
  assert.ok(error instanceof Error);
  assert.ok(error instanceof ToolAccessLoweringError);
  assert.equal(error.code, 'TOOL_ACCESS_STOP_FAILED');
  assert.equal(error.message, 'Tool access changed, but affected answers could not be confirmed stopped.');
});
