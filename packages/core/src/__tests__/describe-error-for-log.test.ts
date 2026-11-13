import assert from 'node:assert/strict';
import { test } from 'vitest';
import { describeErrorForLog } from '../model-facing-tool-errors.js';

class SqliteError extends Error {
  readonly code = 'SQLITE_BUSY';
}

test('names class, constant-token code and direct cause; never the message', () => {
  const err = new TypeError('password=hunter2 leaked', { cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) });
  assert.equal(describeErrorForLog({ err }), 'TypeError cause=Error(ECONNREFUSED)');
  assert.equal(describeErrorForLog({ err: new SqliteError('secret') }), 'SqliteError(SQLITE_BUSY)');
  assert.equal(describeErrorForLog({ err: Object.assign(new Error('x'), { code: 'not a token: secret' }) }), 'Error');
  assert.equal(describeErrorForLog({ err: 'raw string throw' }), 'string');
});

// A log line must never replace the failure it describes: a hostile or broken error object
// (throwing getters, a revoked Proxy) previously made the logger throw from inside a catch block.
test('never throws for hostile getters, revoked proxies or a cyclic cause', () => {
  const hostileCode = new Error('x');
  Object.defineProperty(hostileCode, 'code', { get() { throw new Error('code getter'); } });
  assert.equal(describeErrorForLog({ err: hostileCode }), '[diagnostic unavailable]');

  const hostileConstructor = new Error('x');
  Object.defineProperty(hostileConstructor, 'constructor', { get() { throw new Error('constructor getter'); } });
  assert.equal(describeErrorForLog({ err: hostileConstructor }), '[diagnostic unavailable]');

  const hostileCause = new RangeError('x');
  Object.defineProperty(hostileCause, 'cause', { get() { throw new Error('cause getter'); } });
  assert.equal(describeErrorForLog({ err: hostileCause }), 'RangeError cause=[diagnostic unavailable]');

  const { proxy, revoke } = Proxy.revocable(new Error('x'), {});
  revoke();
  assert.equal(describeErrorForLog({ err: proxy }), '[diagnostic unavailable]');

  const cyclic = new Error('x');
  (cyclic as { cause?: unknown }).cause = cyclic;
  assert.equal(describeErrorForLog({ err: cyclic }), 'Error cause=Error');
});
