import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { ignoreBestEffortFailure } from '../best-effort.js';

test('logs the operation, scope and the cause message at debug, and does not throw', () => {
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  try {
    const cause = Object.assign(new Error('Target closed'), { code: 'ECONNRESET' });
    assert.equal(ignoreBestEffortFailure({ operation: 'close the client' }, { scope: 'db' })(cause), undefined);
    ignoreBestEffortFailure({ operation: 'remove a temp file' })(new Error('token=' + 'ghp_' + 'a'.repeat(36)));
    const lines = debug.mock.calls.map(call => String(call[0]));
    assert.equal(lines[0], '[db] best-effort step failed and was ignored: close the client: Error(ECONNRESET): Target closed');
    assert.equal(lines[1]?.startsWith('[jini] best-effort step failed and was ignored: remove a temp file: Error: token='), true);
    assert.equal(lines[1]?.includes('ghp_'), false);
  } finally { debug.mockRestore(); }
});
