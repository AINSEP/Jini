import { expect, test } from 'vitest';
import { processOutbox, toEnqueueOnlyOutbox } from '../index.js';
import { fixture, NOW, row } from './fixtures.js';

// Generalized source enqueue-only and payload characterization. No storage adapter is copied.
test('enqueue passes the whole envelope unchanged, including arbitrary payload and workspace', async () => {
  const f = fixture();
  const event = { ...row().event, payload: { nested: { value: ['all', 'fields'] } } };
  const view = toEnqueueOnlyOutbox({ outbox: f.outbox });
  await view.enqueue({ event });
  expect(f.outbox.enqueue).toHaveBeenCalledWith({ event });
  expect(f.outbox.enqueue.mock.calls[0]![0].event).toBe(event);
});

test('a non-owner drain claims and publishes nothing; the owning process can still claim', async () => {
  const f = fixture();
  const view = toEnqueueOnlyOutbox({ outbox: f.outbox });
  expect(await processOutbox({ ...f.args, outbox: view })).toBe(0);
  expect(f.outbox.claimPending).not.toHaveBeenCalled();
  expect(f.bus.publish).not.toHaveBeenCalled();
  expect(await processOutbox(f.args)).toBe(1);
  expect(f.bus.publish).toHaveBeenCalledWith({ event: row().event });
});

test('settlement methods reject with the original error messages and never call the storage port', async () => {
  const f = fixture();
  const view = toEnqueueOnlyOutbox({ outbox: f.outbox });
  await expect(view.markDelivered({ id: 'row-1' })).rejects.toThrow("enqueue-only outbox: markDelivered('row-1') was called, but this process never claims outbox rows");
  await expect(view.markFailed({ id: 'row-2', error: 'boom', nextAttemptAt: NOW, nextStatus: 'pending' })).rejects.toThrow("enqueue-only outbox: markFailed('row-2') was called, but this process never claims outbox rows");
  expect(f.outbox.markDelivered).not.toHaveBeenCalled();
  expect(f.outbox.markFailed).not.toHaveBeenCalled();
});
