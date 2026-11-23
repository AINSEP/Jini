import { expect, test, vi } from 'vitest';
import { InMemoryProcessedEventStore, withProcessedEventGuard } from '../processed-event-guard.js';

// The outbox is at-least-once (worker.ts): these pin the host-side guard that turns a redelivery
// of the same event id into one effect per handler.
const event = { id: 'evt-1', name: 'post.published' };

test('a redelivered event runs the handler once', async () => {
  const handler = vi.fn(async () => {});
  const guarded = withProcessedEventGuard({ store: new InMemoryProcessedEventStore(), handlerId: 'sitemap', handler });
  await guarded(event);
  await guarded({ ...event });
  expect(handler).toHaveBeenCalledTimes(1);
});

test('a failed handler run can be retried', async () => {
  const store = new InMemoryProcessedEventStore();
  const handler = vi.fn().mockRejectedValueOnce(new Error('smtp down')).mockResolvedValueOnce(undefined);
  const guarded = withProcessedEventGuard({ store, handlerId: 'notify', handler });
  await expect(guarded(event), 'the failure still reaches the outbox so it schedules a retry').rejects.toThrow('smtp down');
  await guarded(event);
  await guarded(event);
  expect(handler, 'one failed run, one successful retry, then the duplicate is skipped').toHaveBeenCalledTimes(2);
});

test('different handlers each run once for the same event', async () => {
  const store = new InMemoryProcessedEventStore();
  const first = vi.fn(async () => {});
  const second = vi.fn(async () => {});
  const guardedFirst = withProcessedEventGuard({ store, handlerId: 'sitemap', handler: first });
  const guardedSecond = withProcessedEventGuard({ store, handlerId: 'webhooks', handler: second });
  for (let delivery = 0; delivery < 2; delivery += 1) {
    await guardedFirst(event);
    await guardedSecond(event);
  }
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
});

test('a failed release reports both the handler failure and the stuck claim', async () => {
  const store = new InMemoryProcessedEventStore();
  vi.spyOn(store, 'release').mockRejectedValueOnce(new Error('store offline'));
  const guarded = withProcessedEventGuard({ store, handlerId: 'notify', handler: async () => { throw new Error('smtp down'); } });
  const failure = await guarded(event).then(() => undefined, (error: unknown) => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).message).toBe("handler 'notify' failed on event 'evt-1' and its claim could not be released, so a redelivery will skip it");
  expect((failure as AggregateError).errors.map(error => (error as Error).message)).toEqual(['smtp down', 'store offline']);
});
