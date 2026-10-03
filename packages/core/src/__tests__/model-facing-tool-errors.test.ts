import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ToolInputError, type ToolExecutionContext, type ToolRegistration } from '../tool-registry.js';
import { forbiddenRule, reclassifyToolError, withModelFacingErrors, withModelFacingRegistrationErrors } from '../model-facing-tool-errors.js';

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
