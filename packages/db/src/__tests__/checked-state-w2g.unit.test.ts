import { AsyncLocalStorage } from 'node:async_hooks';
import { expect, test } from 'vitest';
import { assertCheckedAvailable, SqliteClientError, type CheckedState, type SqliteLease } from '../sqlite/checked-state.js';

test('an acquired lease admits its own async context and rejects outsiders and expired work', () => {
  const lease = { active: true, acquired: true };
  const state: CheckedState = { context: new AsyncLocalStorage<SqliteLease>(), lease, quarantined: false, cleanupAllowed: false };
  expect(() => assertCheckedAvailable({ state })).toThrowError(expect.objectContaining({ code: 'transaction_busy' }));
  state.context.run(lease, () => {
    expect(assertCheckedAvailable({ state })).toBeUndefined();
    lease.active = false;
    expect(() => assertCheckedAvailable({ state })).toThrowError(expect.objectContaining({ code: 'session_expired' }));
    state.quarantined = true;
    expect(() => assertCheckedAvailable({ state })).toThrowError(expect.objectContaining({ code: 'quarantined' }));
  });
});

test('client errors retain a native cause without changing the stable public code', () => {
  const cause = new Error('native rollback failed');
  const error = new SqliteClientError({ code: 'rollback_failed' }, { cause });
  expect({ name: error.name, message: error.message, code: error.code, cause: error.cause }).toEqual({
    name: 'SqliteClientError', message: 'rollback_failed', code: 'rollback_failed', cause,
  });
});
