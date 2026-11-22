import assert from 'node:assert/strict';
import { test } from 'vitest';
import { describeErrorForLog, describeErrorParts, LOGGABLE_ERROR_CODES, createErrorDescriber } from '../model-facing-tool-errors.js';
import { ToolInputError } from '../tool-input-errors.js';

class SqliteError extends Error {
  readonly code = 'SQLITE_BUSY';
}

const SECRET = 'SECRETSECRETSECRETSECRET';

test('names class, approved code and direct cause; never the message', () => {
  const err = new TypeError('password=hunter2 leaked', { cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) });
  assert.equal(describeErrorForLog({ err }), 'TypeError cause=Error(ECONNREFUSED)');
  // An unregistered subclass is labelled by the built-in class it extends, never by its own name.
  assert.equal(describeErrorForLog({ err: new SqliteError('secret') }), 'Error(SQLITE_BUSY)');
  assert.equal(describeErrorForLog({ err: Object.assign(new Error('x'), { code: 'not a token: secret' }) }), 'Error');
  assert.equal(describeErrorForLog({ err: 'raw string throw' }), 'string');
});

// A log line must never replace the failure it describes: a hostile or broken error object
// (throwing getters, a revoked Proxy) previously made the logger throw from inside a catch block.
test('never throws for hostile getters, revoked proxies or a cyclic cause', () => {
  const hostileCode = new Error('x');
  Object.defineProperty(hostileCode, 'code', { get() { throw new Error('code getter'); } });
  assert.equal(describeErrorForLog({ err: hostileCode }), 'Error');

  const hostileConstructor = new Error('x');
  Object.defineProperty(hostileConstructor, 'constructor', { get() { throw new Error('constructor getter'); } });
  assert.equal(describeErrorForLog({ err: hostileConstructor }), 'Error');

  const hostileName = new RangeError('x');
  Object.defineProperty(hostileName, 'name', { get() { throw new Error('name getter'); } });
  assert.equal(describeErrorForLog({ err: hostileName }), 'RangeError');

  const hostileCause = new RangeError('x');
  Object.defineProperty(hostileCause, 'cause', { get() { throw new Error('cause getter'); } });
  assert.equal(describeErrorForLog({ err: hostileCause }), 'RangeError cause=[diagnostic unavailable]');

  const { proxy, revoke } = Proxy.revocable(new Error('x'), {});
  revoke();
  assert.equal(describeErrorForLog({ err: proxy }), '[diagnostic unavailable]');
  assert.equal(describeErrorForLog({ err: new Error('x', { cause: proxy }) }), 'Error cause=[diagnostic unavailable]');

  const cyclic = new Error('x');
  (cyclic as { cause?: unknown }).cause = cyclic;
  assert.equal(describeErrorForLog({ err: cyclic }), 'Error cause=Error');
});

// The label is chosen by built-in class checks, never read from the value: a class name, an
// instance `name` or a `constructor` property is caller-controlled text that can carry a credential.
test('never logs a constructor name, an instance name or a constructor property', () => {
  class Named extends Error {}
  Object.defineProperty(Named, 'name', { value: `api_key_${SECRET}` });
  assert.equal(describeErrorForLog({ err: new Named('x') }), 'Error');

  const renamed = new TypeError('x');
  renamed.name = SECRET;
  assert.equal(describeErrorForLog({ err: renamed }), 'TypeError');

  const fakeConstructor = new Error('x');
  Object.defineProperty(fakeConstructor, 'constructor', { value: { name: SECRET } });
  assert.equal(describeErrorForLog({ err: fakeConstructor }), 'Error');

  const causeNamed = new Error('x', { cause: new Named('y') });
  assert.equal(describeErrorForLog({ err: causeNamed }), 'Error cause=Error');
});

test('names every built-in class, the core ToolInputError and the well-known abort/timeout names', () => {
  assert.equal(describeErrorForLog({ err: new AggregateError([], 'x') }), 'AggregateError');
  assert.equal(describeErrorForLog({ err: new SyntaxError('x') }), 'SyntaxError');
  assert.equal(describeErrorForLog({ err: new ReferenceError('x') }), 'ReferenceError');
  assert.equal(describeErrorForLog({ err: new URIError('x') }), 'URIError');
  assert.equal(describeErrorForLog({ err: new EvalError('x') }), 'EvalError');
  assert.equal(describeErrorForLog({ err: new ToolInputError({ message: 'BAD_INPUT: x' }) }), 'ToolInputError');
  assert.equal(describeErrorForLog({ err: new DOMException(`stopped ${SECRET}`, 'AbortError') }), 'AbortError');
  assert.equal(describeErrorForLog({ err: new DOMException('x', 'TimeoutError') }), 'TimeoutError');
  assert.equal(describeErrorForLog({ err: Object.assign(new Error('x'), { name: 'AbortError', code: 'ABORT_ERR' }) }), 'AbortError(ABORT_ERR)');
  assert.equal(describeErrorForLog({ err: new DOMException('x', SECRET) }), 'Error');
});

// Codes come from an explicit approved set: an uppercase token is not evidence that it is a code.
test('logs only approved codes, on the error and on its cause', () => {
  const withCode = (code: unknown) => Object.assign(new Error('x'), { code });
  assert.equal(describeErrorForLog({ err: withCode(SECRET) }), 'Error');
  assert.equal(describeErrorForLog({ err: withCode('API_KEY_ABCDEF0123456789') }), 'Error');
  assert.equal(describeErrorForLog({ err: new Error('x', { cause: withCode(SECRET) }) }), 'Error cause=Error');
  assert.equal(describeErrorForLog({ err: withCode('ENOENT') }), 'Error(ENOENT)');
  assert.ok(LOGGABLE_ERROR_CODES.has('ECONNREFUSED'));
  assert.equal(LOGGABLE_ERROR_CODES.has(SECRET), false);
});

// Each field is read once: a getter that answers differently on a second read cannot pass the
// check with one value and be printed with another.
test('reads code, name and cause at most once each', () => {
  const reads = { code: 0, name: 0, cause: 0 };
  const changing = new Error('x');
  Object.defineProperty(changing, 'code', { get() { reads.code += 1; return reads.code === 1 ? 'ECONNREFUSED' : SECRET; } });
  Object.defineProperty(changing, 'name', { get() { reads.name += 1; return reads.name === 1 ? 'Error' : SECRET; } });
  Object.defineProperty(changing, 'cause', { get() { reads.cause += 1; return reads.cause === 1 ? undefined : new Error(SECRET); } });
  assert.equal(describeErrorForLog({ err: changing }), 'Error(ECONNREFUSED)');
  assert.ok(reads.code === 1 && reads.name <= 1 && reads.cause === 1, JSON.stringify(reads));

  let secretFirst = 0;
  const flipping = new Error('x');
  Object.defineProperty(flipping, 'code', { get() { secretFirst += 1; return secretFirst === 1 ? SECRET : 'ECONNREFUSED'; } });
  assert.equal(describeErrorForLog({ err: flipping }), 'Error');
});

// Packages extend the approved set by building their own describer (their own constant codes and
// classes); there is no pattern a stranger's value can match, and no shared state to mutate.
test('a package builds its own describer; malformed vocabularies are refused', () => {
  class PluginRegistryError extends Error {}
  class PluginRegistryConflictError extends PluginRegistryError {}
  const describer = createErrorDescriber({
    codes: ['PLUGIN_TEST_CONFLICT'],
    classes: [{ error: PluginRegistryError, label: 'PluginRegistryError' }, { error: PluginRegistryConflictError, label: 'PluginRegistryConflictError' }],
  });
  assert.equal(describer.describeErrorForLog({ err: Object.assign(new PluginRegistryError('x'), { code: 'PLUGIN_TEST_CONFLICT' }) }), 'PluginRegistryError(PLUGIN_TEST_CONFLICT)');
  assert.equal(describer.describeErrorForLog({ err: new PluginRegistryConflictError('x') }), 'PluginRegistryConflictError');
  assert.deepEqual(describer.describeErrorParts({ err: Object.assign(new PluginRegistryError('x'), { code: 'PLUGIN_TEST_CONFLICT' }) }), { label: 'PluginRegistryError', code: 'PLUGIN_TEST_CONFLICT' });
  assert.equal(describer.describeErrorForLog({ err: Object.assign(new TypeError('x'), { code: 'ECONNREFUSED' }) }), 'TypeError(ECONNREFUSED)');
  assert.throws(() => createErrorDescriber({ codes: ['free text'] }), TypeError);
  assert.throws(() => createErrorDescriber({ classes: [{ error: PluginRegistryError, label: 'has space' }] }), TypeError);
});

test('describers are isolated: a code or class added to one is not loggable through another or the built-ins', () => {
  class OwnError extends Error {}
  const own = createErrorDescriber({ codes: ['ISOLATED_CODE'], classes: [{ error: OwnError, label: 'OwnError' }] });
  const other = createErrorDescriber({});
  const err = Object.assign(new OwnError('x'), { code: 'ISOLATED_CODE' });
  assert.equal(own.describeErrorForLog({ err }), 'OwnError(ISOLATED_CODE)');
  assert.equal(other.describeErrorForLog({ err }), 'Error');
  assert.equal(describeErrorForLog({ err }), 'Error');
  assert.equal(describeErrorParts({ err }).code, undefined);
  assert.equal(LOGGABLE_ERROR_CODES.has('ISOLATED_CODE'), false);
});

// Telemetry needs one label, not a log line: a reader beats every caller parsing `Label(CODE) cause=…`.
test('describeErrorParts returns the same fixed label and approved code, without the cause', () => {
  const err = Object.assign(new TypeError('password=hunter2', { cause: new Error('x') }), { code: 'ECONNREFUSED' });
  assert.deepEqual(describeErrorParts({ err }), { label: 'TypeError', code: 'ECONNREFUSED' });
  assert.deepEqual(describeErrorParts({ err: Object.assign(new Error('x'), { code: SECRET }) }), { label: 'Error' });
  assert.deepEqual(describeErrorParts({ err: null }), { label: 'object' });
  const hostile = new Error('x');
  Object.defineProperty(hostile, 'code', { get() { throw new Error('getter'); } });
  assert.deepEqual(describeErrorParts({ err: hostile }), { label: 'Error' });
});

test('every Node system error code (libuv errno name) is fixed vocabulary and printed; other E-codes are not', () => {
  // Owner ruling 2026-11-15: Node errno codes (EIO, EAGAIN, ...) are a fixed set, not user text.
  for (const code of ['EIO', 'EAGAIN', 'ENOTSUP', 'EAI_NONAME', 'ELOOP', 'ESRCH']) {
    assert.equal(describeErrorForLog({ err: Object.assign(new Error(SECRET), { code }) }), `Error(${code})`);
  }
  // A list, not an `E[A-Z0-9_]+` rule: a thrown value's code is caller text and could be a secret.
  assert.equal(describeErrorForLog({ err: Object.assign(new Error('x'), { code: `E${SECRET}` }) }), 'Error');
});
