/**
 * @file What the worker writes to `lastError` and to the log when a delivery fails. A policy may
 * declare a closed list of codes; only a value on that list is stored, everything else stores the
 * class label. Each ordinary failure is logged once, keyed by the row ID and attempt the row
 * already stores (no error ID is persisted).
 */
import { expect, test } from 'vitest';
import { processOutbox, type OutboxFailureCodes, type OutboxRetryPolicyResolver } from '../index.js';
import { fixture, row } from './fixtures.js';

/** A failure as an adapter would throw it: private prose in the message, a code beside it. */
function failure(code: string): Error {
  return Object.assign(new Error('Private draft body: Acme merger closes Friday'), { code });
}
const readCode: OutboxFailureCodes['codeOf'] = ({ error }) => (error as { code?: string }).code;
function policyWith(failureCodes: OutboxFailureCodes): OutboxRetryPolicyResolver {
  return () => ({ maxAttempts: 12, backoffMs: () => 1_000, failureCodes });
}
const stored = (f: ReturnType<typeof fixture>): Array<[string, string]> =>
  f.outbox.markFailed.mock.calls.map(([call]) => [call.id, call.error]);

test('a code on the policy list is stored as lastError', async () => {
  const f = fixture([row('evt')]);
  f.bus.publish.mockRejectedValueOnce(failure('rate-limited'));
  await processOutbox(f.args, { retryPolicyForEvent: policyWith({ codes: ['rate-limited', 'delivery-failed'], codeOf: readCode }) });
  expect(stored(f)).toEqual([['evt', 'rate-limited']]);
});

test('a code-shaped value that is not on the list stores the class label, never the value', async () => {
  const f = fixture([row('evt')]);
  f.bus.publish.mockRejectedValueOnce(failure('SK_LIVE_SECRET_TOKEN'));
  await processOutbox(f.args, { retryPolicyForEvent: policyWith({ codes: ['rate-limited'], codeOf: readCode }) });
  expect(stored(f)).toEqual([['evt', 'Error']]);
});

test.each([
  ['undefined', () => undefined],
  ['a number', () => 7 as unknown as string],
  ['the error message', ({ error }: { error: unknown }) => (error as Error).message],
] satisfies Array<[string, OutboxFailureCodes['codeOf']]>)('codeOf returning %s stores the class label', async (_label, codeOf) => {
  const f = fixture([row('evt')]);
  f.bus.publish.mockRejectedValueOnce(failure('rate-limited'));
  await processOutbox(f.args, { retryPolicyForEvent: policyWith({ codes: ['rate-limited'], codeOf }) });
  expect(stored(f)).toEqual([['evt', 'Error']]);
});

test('a throwing codeOf stores the class label, is reported, and the next row in the batch is still processed', async () => {
  const f = fixture([row('bad'), row('good')]);
  f.bus.publish.mockRejectedValueOnce(failure('rate-limited'));
  const codeOf = (): string => { throw new TypeError('codeOf bug'); };
  expect(await processOutbox(f.args, { retryPolicyForEvent: policyWith({ codes: ['rate-limited'], codeOf }) })).toBe(2);
  expect(f.outbox.markFailed).toHaveBeenCalledWith({ id: 'bad', error: 'Error', nextAttemptAt: '2026-02-21T12:00:01.000Z', nextStatus: 'pending' });
  expect(f.logger.error).toHaveBeenCalledWith({
    message: '[outbox-worker] the retry policy for outbox event "demo.event" (bad) failed; storing the error class as the failure code for this row',
  }, { error: expect.any(TypeError) });
  expect(f.outbox.markDelivered).toHaveBeenCalledWith({ id: 'good' });
});

test('an ordinary failure is logged once with the row ID, the attempt and the stored code, plus the original error', async () => {
  const f = fixture([row('evt', 3)]);
  const original = failure('rate-limited');
  f.bus.publish.mockRejectedValueOnce(original);
  await processOutbox(f.args, { retryPolicyForEvent: policyWith({ codes: ['rate-limited'], codeOf: readCode }) });
  expect(f.logger.error.mock.calls).toEqual([[
    { message: '[outbox-worker] delivery of outbox event "demo.event" failed' },
    { error: original, meta: { outboxId: 'evt', attempt: 3, lastError: 'rate-limited' } },
  ]]);
});

test('a failure under the default policy is logged once too, with the class label', async () => {
  const f = fixture([row('evt', 2)]);
  const original = new Error('offline');
  f.bus.publish.mockRejectedValueOnce(original);
  await processOutbox(f.args);
  expect(f.logger.error.mock.calls).toEqual([[
    { message: '[outbox-worker] delivery of outbox event "demo.event" failed' },
    { error: original, meta: { outboxId: 'evt', attempt: 2, lastError: 'Error' } },
  ]]);
});

test('a delivered row writes no log entry', async () => {
  const f = fixture([row('evt')]);
  await processOutbox(f.args);
  expect(f.logger.error).not.toHaveBeenCalled();
});

test('a failing log sink does not stop the failure from being recorded', async () => {
  const f = fixture([row('evt')]);
  f.logger.error.mockImplementation(() => { throw new Error('sink down'); });
  f.bus.publish.mockRejectedValueOnce(failure('rate-limited'));
  await processOutbox(f.args, { retryPolicyForEvent: policyWith({ codes: ['rate-limited'], codeOf: readCode }) });
  expect(stored(f)).toEqual([['evt', 'rate-limited']]);
});
