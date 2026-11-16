import assert from 'node:assert/strict';
import { test } from 'vitest';
import { describeErrorForLog } from '../model-facing-tool-errors.js';

// why: desktop logs showed `Error(EACCES)` / `check failed: Error`, so nobody could tell what
// failed. The line must keep class + approved code + the (redacted) message.
test('keeps the message next to the class and approved code', () => {
  const err = Object.assign(new Error("EACCES: permission denied, open '/data/x.json'"), { code: 'EACCES' });
  assert.equal(describeErrorForLog({ err }), "Error(EACCES): EACCES: permission denied, open '/data/x.json'");
});

test('keeps a plain message and the message of the cause', () => {
  const err = new TypeError('fetch failed', { cause: Object.assign(new Error('offline'), { code: 'ENOTFOUND' }) });
  assert.equal(describeErrorForLog({ err }), 'TypeError: fetch failed cause=Error(ENOTFOUND): offline');
});

test('redacts credentials inside the message', () => {
  const secret = 'sk-ant-api03-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
  const line = describeErrorForLog({ err: new Error(`request failed with key ${secret}`) });
  assert.equal(line.includes(secret), false);
  assert.match(line, /^Error: request failed with key \[REDACTED:[a-z_-]+\]$/);
});

test('truncates a very long message and survives a throwing message getter', () => {
  const long = describeErrorForLog({ err: new Error('x'.repeat(5000)) });
  assert.equal(long.length < 700, true);
  const hostile = new Error('x');
  Object.defineProperty(hostile, 'message', { get() { throw new Error('boom'); } });
  assert.equal(describeErrorForLog({ err: hostile }), 'Error');
});
