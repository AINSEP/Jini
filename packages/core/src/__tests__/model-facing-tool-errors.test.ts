import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ToolInputError, type ToolExecutionContext, type ToolRegistration } from '../tool-registry.js';
import { describeErrorForLog, forbiddenRule, reclassifyToolError, withModelFacingErrors, withModelFacingRegistrationErrors } from '../model-facing-tool-errors.js';

class MissingRecordError extends Error {}
class SecretStoreError extends Error {}
class DeniedError extends Error {}
const rules = [
  { error: MissingRecordError, code: 'RECORD_NOT_FOUND' },
  { error: SecretStoreError, code: 'STORE_UNAVAILABLE', message: 'secret store unavailable', guidance: 'Configure the store' },
  forbiddenRule({ domainPrefix: 'RECORD', error: DeniedError }),
];
const ctx: ToolExecutionContext = {
  executionId: 'execution-1', principal: { id: 'actor-1' }, run: { id: 'run-1' },
  input: {}, signal: new AbortController().signal,
};
const registrationThatThrows = (error: unknown): ToolRegistration => ({
  descriptor: { id: 'record_get' }, policy: { authorize: () => 'allow' },
  handler: async () => { throw error; },
});

// Generalized from the original registration container tests.
test('listed class becomes a coded ToolInputError and descriptor/policy retain identity', async () => {
  const original = registrationThatThrows(new MissingRecordError("record 'r1' was not found"));
  const wrapped = withModelFacingRegistrationErrors({ registrations: [original], rules });
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0]!.descriptor, original.descriptor);
  assert.equal(wrapped[0]!.policy, original.policy);
  assert.notEqual(wrapped[0]!.handler, original.handler);
  await assert.rejects(wrapped[0]!.handler(ctx), { name: 'ToolInputError', message: "RECORD_NOT_FOUND: record 'r1' was not found" });

});

test('unlisted and already-classified errors retain exact identity', async () => {
  for (const err of [new Error('private data'), new ToolInputError({ message: 'already safe' }), 'raw throw', null]) {
    assert.equal(reclassifyToolError({ err, rules }), err);
    const wrapped = withModelFacingRegistrationErrors({ registrations: [registrationThatThrows(err)], rules });
    await assert.rejects(wrapped[0]!.handler(ctx), caught => caught === err);
  }
});

test('first subclass rule wins and fixed-message guidance never publishes inner text', () => {
  class NarrowError extends MissingRecordError {}
  const ordered = [{ error: NarrowError, code: 'NARROW' }, ...rules];
  const classified = reclassifyToolError({ err: new NarrowError('missing'), rules: ordered });
  assert.equal((classified as ToolInputError).message, 'NARROW: missing');
  const secret = reclassifyToolError({ err: new SecretStoreError('LEAK-secret'), rules });
  assert.equal((secret as ToolInputError).message, 'STORE_UNAVAILABLE: secret store unavailable. Configure the store');
  assert.equal((reclassifyToolError({ err: new DeniedError('access denied'), rules }) as Error).message, 'RECORD_FORBIDDEN: access denied');
});

test('every map and registration handler is wrapped; successful values retain identity', async () => {
  const result = { value: 7 };
  const handlers = {
    successful: async () => result,
    first: async () => { throw new MissingRecordError('first'); },
    second: async () => { throw new MissingRecordError('second'); },
  };
  const wrapped = withModelFacingErrors({ handlers, rules });
  assert.deepEqual(Object.keys(wrapped), Object.keys(handlers));
  assert.equal(await wrapped.successful!(ctx), result);
  for (const key of ['first', 'second'] as const) {
    await assert.rejects(wrapped[key]!(ctx), { name: 'ToolInputError', message: `RECORD_NOT_FOUND: ${key}` });
    await assert.rejects(handlers[key](), MissingRecordError);
  }
  const successful: ToolRegistration = { ...registrationThatThrows(null), handler: async () => result };
  assert.equal(await withModelFacingRegistrationErrors({ registrations: [successful], rules })[0]!.handler(ctx), result);
});

// describeErrorForLog must never echo a message: messages can quote secrets (JSON.parse input, sealer plaintext).
test('describeErrorForLog names the class and a constant-token code, never the message', () => {
  const secret = ['tok', 'en-', 'value'].join('');
  class SqliteError extends Error { code = 'SQLITE_BUSY'; }
  assert.equal(describeErrorForLog({ err: new SqliteError(`database is locked near '${secret}'`) }), 'SqliteError(SQLITE_BUSY)');
  assert.equal(describeErrorForLog({ err: new SyntaxError(`Unexpected token in '${secret}'`) }), 'SyntaxError');
  assert.equal(describeErrorForLog({ err: new (class extends Error {})(secret) }), 'Error');
});

test('describeErrorForLog drops codes that are not short constant tokens', () => {
  const withCode = (code: unknown) => Object.assign(new Error('x'), { code });
  assert.equal(describeErrorForLog({ err: withCode('ECONNREFUSED') }), 'Error(ECONNREFUSED)');
  assert.equal(describeErrorForLog({ err: withCode('free text with secret') }), 'Error');
  assert.equal(describeErrorForLog({ err: withCode('lowercase_code') }), 'Error');
  assert.equal(describeErrorForLog({ err: withCode('E'.repeat(65)) }), 'Error');
  assert.equal(describeErrorForLog({ err: withCode(503) }), 'Error');
});

test('describeErrorForLog describes a direct cause the same way, and a non-Error throw by its type', () => {
  const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1'), { code: 'ECONNREFUSED' });
  assert.equal(describeErrorForLog({ err: new TypeError('fetch failed', { cause }) }), 'TypeError cause=Error(ECONNREFUSED)');
  assert.equal(describeErrorForLog({ err: new Error('wrapped', { cause: 'raw string cause' }) }), 'Error cause=string');
  assert.equal(describeErrorForLog({ err: 'thrown string' }), 'string');
  assert.equal(describeErrorForLog({ err: null }), 'object');
  assert.equal(describeErrorForLog({ err: undefined }), 'undefined');
});
