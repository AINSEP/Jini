import { expect, test } from 'vitest';
import { processOutbox, toEnqueueOnlyOutbox } from '../index.js';
import { fixture, NOW, row } from './fixtures.js';

// Generalized from the source worker's mixed-outcome cases. One batch can contain a poison row,
// an exhausted crashed claim and healthy events; a terminal row must not stop later deliveries.
test('mixed claims preserve attempt boundaries, envelope identity and sequential delivery', async () => {
  const capped = row('capped', 6);
  const exhausted = row('exhausted', 7);
  const healthy = row('healthy', 1);
  const f = fixture([capped, exhausted, healthy]);
  f.bus.publish.mockRejectedValueOnce(new Error('poison'));
  expect(await processOutbox(f.args, { batchSize: 3 })).toBe(3);
  expect(f.bus.publish.mock.calls.map(([args]) => args.event)).toEqual([capped.event, healthy.event]);
  expect(f.bus.publish.mock.calls[1]![0].event).toBe(healthy.event);
  expect(f.outbox.markFailed.mock.calls.map(([args]) => args)).toEqual([
    { id: 'capped', error: 'poison', nextAttemptAt: '2026-02-21T12:08:00.000Z', nextStatus: 'failed' },
    { id: 'exhausted', error: 'claimed 7 times; the last claim expired with no recorded outcome (its claimer likely died mid-delivery)', nextAttemptAt: NOW, nextStatus: 'failed' },
  ]);
  expect(f.outbox.markDelivered).toHaveBeenCalledTimes(1);
  expect(f.outbox.markDelivered).toHaveBeenCalledWith({ id: 'healthy' });
});

// A process without the real subscribers must never steal a claim and report fake delivery.
test('enqueue-only views enqueue the original envelope but every inline drain stays empty', async () => {
  const f = fixture();
  const event = row().event;
  const view = toEnqueueOnlyOutbox({ outbox: f.outbox });
  await view.enqueue({ event });
  expect(f.outbox.enqueue.mock.calls[0]![0].event).toBe(event);
  expect(await processOutbox({ ...f.args, outbox: view })).toBe(0);
  expect(f.outbox.claimPending).not.toHaveBeenCalled();
  expect(f.bus.publish).not.toHaveBeenCalled();
  await expect(view.markDelivered({ id: 'evt-1' })).rejects.toThrow("enqueue-only outbox: markDelivered('evt-1') was called, but this process never claims outbox rows");
});
