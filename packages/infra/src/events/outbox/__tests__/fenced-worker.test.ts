import { expect, test, vi } from 'vitest';
import { processFencedOutbox, type DispatchResult } from '../index.js';
import { deferredValue, fencedFixture, intent } from './fenced-fixtures.js';
import { NOW } from './fixtures.js';

const bounds = { batchSize: 2, deliveryTimeoutMs: 10, claimLeaseMs: 100 };

test('authorization sees the detached envelope and a durable marker precedes dispatch', async () => {
  const f = await fencedFixture();
  const order: string[] = [];
  f.args.authorize.mockImplementation(async () => { order.push('authorize'); return true; });
  f.args.dispatch.mockImplementation(async ({ claim }) => {
    order.push('dispatch');
    expect(f.stored().status).toBe('dispatching');
    expect(claim).toBe(f.args.authorize.mock.calls[0]![0].claim);
    expect(claim.event).toEqual(intent().event);
    return { kind: 'delivered' };
  });
  expect(await processFencedOutbox(f.args, bounds)).toBe(1);
  expect(order).toEqual(['authorize', 'dispatch']);
  expect(f.stored().status).toBe('delivered');
  expect(f.outbox.recoverExpired).toHaveBeenCalledWith({ scope: 'scope-a', nowIso: NOW, limit: 2 }, {});
  expect(f.outbox.claimReady).toHaveBeenCalledWith({ scope: 'scope-a', nowIso: NOW, batchSize: 2, claimLeaseMs: 100 }, {});
  expect(f.manual.tasks).toHaveLength(1);
  expect(f.manual.tasks[0]!.cancelled).toBe(true);
});

test('concurrent workers cannot dispatch the same pending row twice', async () => {
  const f = await fencedFixture();
  const counts = await Promise.all([processFencedOutbox(f.args, bounds), processFencedOutbox(f.args, bounds)]);
  expect(counts.sort()).toEqual([0, 1]);
  expect(f.args.dispatch).toHaveBeenCalledTimes(1);
  expect(f.stored().attempts).toBe(1);
});

test('a denied authorization completes denied without beginning dispatch', async () => {
  const f = await fencedFixture();
  f.args.authorize.mockResolvedValue(false);
  expect(await processFencedOutbox(f.args, bounds)).toBe(1);
  expect(f.stored().status).toBe('denied');
  expect(f.outbox.beginDispatch).not.toHaveBeenCalled();
  expect(f.args.dispatch).not.toHaveBeenCalled();
});

test.each(['authorize-throws', 'begin-throws', 'begin-commit-then-throw', 'begin-false', 'stale-token', 'expiry-during-begin'] as const)(
  '%s prevents transport and never plans an automatic retry', async scenario => {
    const f = await fencedFixture();
    if (scenario === 'authorize-throws') f.args.authorize.mockRejectedValue(new Error('authorization unavailable'));
    if (scenario === 'begin-throws') f.outbox.beginDispatch.mockRejectedValue(new Error('storage unavailable'));
    if (scenario === 'begin-commit-then-throw') f.outbox.beginDispatch.mockImplementation(async input => {
      await f.store.beginDispatch(input);
      throw new Error('begin acknowledgement lost');
    });
    if (scenario === 'begin-false') f.outbox.beginDispatch.mockResolvedValue(false);
    if (scenario === 'stale-token') f.outbox.beginDispatch.mockImplementation(async input => {
      f.stored().claimToken = 'new-owner';
      return f.store.beginDispatch(input);
    });
    if (scenario === 'expiry-during-begin') f.outbox.beginDispatch.mockImplementation(async input => {
      const accepted = await f.store.beginDispatch(input);
      f.advance(100);
      return accepted;
    });
    await processFencedOutbox(f.args, bounds);
    expect(f.args.dispatch).not.toHaveBeenCalled();
    expect(f.outbox.complete).not.toHaveBeenCalled();
    expect(f.args.random).not.toHaveBeenCalled();
    if (scenario === 'expiry-during-begin' || scenario === 'begin-commit-then-throw') expect(f.stored().status).toBe('dispatching');
    else expect(f.stored().status).toBe('leased');
  },
);

test('expiry at claim receipt prevents authorization and dispatch', async () => {
  const f = await fencedFixture();
  f.outbox.claimReady.mockImplementation(async input => {
    const claims = await f.store.claimReady(input);
    f.advance(100);
    return claims;
  });
  await processFencedOutbox(f.args, bounds);
  expect(f.args.authorize).not.toHaveBeenCalled();
  expect(f.args.dispatch).not.toHaveBeenCalled();
});

test.each([
  { kind: 'permanent-failure', status: 'failed' },
  { kind: 'confirmed-no-effect', status: 'pending' },
  { kind: 'uncertain', status: 'uncertain' },
  { kind: 'unrecognized', status: 'uncertain' },
] as const)('dispatch $kind completes $status; retry policy runs only for confirmed no-effect', async ({ kind, status }) => {
  const f = await fencedFixture();
  f.args.dispatch.mockResolvedValue({ kind } as DispatchResult);
  const backoffMs = vi.fn(() => 25);
  const retryable = vi.fn(() => true);
  await processFencedOutbox(f.args, { ...bounds, retryPolicyForEvent: () => ({ maxAttempts: 3, backoffMs, retryable }) });
  expect(f.stored().status).toBe(status);
  expect(backoffMs).toHaveBeenCalledTimes(kind === 'confirmed-no-effect' ? 1 : 0);
  expect(retryable).toHaveBeenCalledTimes(kind === 'confirmed-no-effect' ? 1 : 0);
  if (kind === 'confirmed-no-effect') expect(f.stored().nextAttemptAt).toBe('2026-02-21T12:00:00.025Z');
});

test.each(['throw', 'reject', 'null', 'throwing-getter'] as const)('unknown effects from %s stay uncertain', async scenario => {
  const f = await fencedFixture();
  f.args.dispatch.mockImplementation(() => {
    if (scenario === 'throw') throw new Error('effect may have occurred');
    if (scenario === 'reject') return Promise.reject(new Error('connection lost'));
    if (scenario === 'null') return Promise.resolve(null as unknown as DispatchResult);
    return Promise.resolve({ get kind(): never { throw new Error('invalid result'); } });
  });
  await processFencedOutbox(f.args, bounds);
  expect(f.stored().status).toBe('uncertain');
  expect(f.args.random).not.toHaveBeenCalled();
});

test('confirmed no-effect uses existing fallback backoff and seals at the retry cap', async () => {
  const f = await fencedFixture();
  f.args.dispatch.mockResolvedValue({ kind: 'confirmed-no-effect' });
  const backoffMs = vi.fn(() => -1);
  const options = { ...bounds, retryPolicyForEvent: () => ({ maxAttempts: 2, backoffMs }) };
  await processFencedOutbox(f.args, options);
  expect(f.stored().nextAttemptAt).toBe('2026-02-21T12:00:15.000Z');
  expect(f.args.logger.error).toHaveBeenCalledTimes(1);
  // A valid policy is still worker-owned and applies the cap to the next confirmed failure.
  f.advance(15_000);
  backoffMs.mockReturnValue(25);
  await processFencedOutbox(f.args, options);
  expect(f.stored().status).toBe('failed');
  expect(f.stored().attempts).toBe(2);
  f.advance(100_000);
  expect(await processFencedOutbox(f.args, options)).toBe(0);
});

test('timeout stays uncertain after late success and is never automatically reclaimed', async () => {
  const f = await fencedFixture();
  const entered = deferredValue<void>();
  const transport = deferredValue<DispatchResult>();
  f.args.dispatch.mockImplementation(() => { entered.resolve(); return transport.promise; });
  const processing = processFencedOutbox(f.args, bounds);
  await entered.promise;
  expect(f.stored().status).toBe('dispatching');
  f.advance(10);
  f.manual.tasks[0]!.callback();
  await processing;
  expect(f.stored().status).toBe('uncertain');
  expect(f.outbox.complete).toHaveBeenCalledTimes(1);
  transport.resolve({ kind: 'delivered' });
  await transport.promise;
  f.advance(1000);
  expect(await processFencedOutbox(f.args, bounds)).toBe(0);
  expect(f.stored().status).toBe('uncertain');
  expect(f.outbox.complete).toHaveBeenCalledTimes(1);
  expect(f.args.dispatch).toHaveBeenCalledTimes(1);
});

test.each([false, true])('acknowledgement failure (committed=%s) cannot become a delivery retry', async committed => {
  const f = await fencedFixture();
  f.outbox.complete.mockImplementation(async input => {
    if (committed) await f.store.complete(input);
    throw new Error('acknowledgement lost');
  });
  f.args.logger.error.mockImplementation(() => { throw new Error('reporter unavailable'); });
  await processFencedOutbox(f.args, bounds);
  expect(f.stored().status).toBe(committed ? 'delivered' : 'dispatching');
  expect(f.outbox.complete).toHaveBeenCalledTimes(1);
  expect(f.args.random).not.toHaveBeenCalled();
  f.advance(100);
  expect(await processFencedOutbox(f.args, bounds)).toBe(0);
  expect(f.stored().status).toBe(committed ? 'delivered' : 'uncertain');
  expect(f.args.dispatch).toHaveBeenCalledTimes(1);
});

test('recovery/claim failures propagate before effects; invalid bounds do no storage work', async () => {
  const f = await fencedFixture();
  await expect(processFencedOutbox(f.args, { ...bounds, batchSize: 0 })).rejects.toThrow(RangeError);
  expect(f.outbox.recoverExpired).not.toHaveBeenCalled();
  f.outbox.recoverExpired.mockRejectedValueOnce(new Error('recovery unavailable'));
  await expect(processFencedOutbox(f.args, bounds)).rejects.toThrow('recovery unavailable');
  expect(f.outbox.claimReady).not.toHaveBeenCalled();
  f.outbox.claimReady.mockRejectedValueOnce(new Error('claim unavailable'));
  await expect(processFencedOutbox(f.args, bounds)).rejects.toThrow('claim unavailable');
  expect(f.args.dispatch).not.toHaveBeenCalled();
});
