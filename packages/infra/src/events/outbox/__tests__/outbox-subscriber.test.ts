import { expect, test, vi } from 'vitest';
import type { DomainEvent } from '@jini-ai/core/contracts/events';
import { InMemoryEventBus } from '../../memory-bus.js';
import { InMemoryProcessOnceLedger } from '../processed-event-guard.js';
import { outboxIdempotencyKey, subscribeOutbox } from '../subscription.js';

// The outbox is at least once (worker.ts): a redelivery publishes the same row again. These pin the
// subscription boundary that turns each (workspace, event, handler) into one applied effect.
const event: DomainEvent = {
  id: 'evt-1', name: 'form.submitted', occurredAt: '2026-11-25T00:00:00.000Z', workspaceId: 'ws-1', payload: {},
};

test('duplicate delivery applies once to each subscriber independently', async () => {
  const bus = new InMemoryEventBus();
  const ledger = new InMemoryProcessOnceLedger();
  const mail = vi.fn(async (_input: { event: DomainEvent; idempotencyKey: string }) => {});
  const search = vi.fn(async () => {});
  await subscribeOutbox({ bus, eventName: event.name, handlerId: 'mail', handler: mail, processOnce: ledger.processOnce });
  await subscribeOutbox({ bus, eventName: event.name, handlerId: 'search', handler: search, processOnce: ledger.processOnce });
  await bus.publish(event);
  await bus.publish({ ...event });
  expect(mail, 'the first subscriber running must not mark the broadcast processed for the second').toHaveBeenCalledTimes(1);
  expect(search).toHaveBeenCalledTimes(1);
  expect(mail.mock.calls[0]?.[0]).toEqual({ event, idempotencyKey: outboxIdempotencyKey({ workspaceId: 'ws-1', eventId: 'evt-1', handlerId: 'mail' }) });

  await bus.publish({ ...event, workspaceId: 'ws-2' });
  expect(mail, 'the same event id in another workspace is a different effect').toHaveBeenCalledTimes(2);
});

test('a crash before effect commit can retry and a crash after commit cannot repeat it', async () => {
  const bus = new InMemoryEventBus();
  const ledger = new InMemoryProcessOnceLedger();
  const applied: string[] = [];
  const handler = vi.fn()
    .mockRejectedValueOnce(new Error('process died before commit'))
    .mockImplementation(async ({ idempotencyKey }: { idempotencyKey: string }) => { applied.push(idempotencyKey); });
  await subscribeOutbox({ bus, eventName: event.name, handlerId: 'index', handler, processOnce: ledger.processOnce });

  await expect(bus.publish(event), 'the failure reaches the outbox, which schedules a retry').rejects.toThrow('process died before commit');
  await bus.publish(event);
  // The effect committed with its key; a crash before markDelivered makes the worker redeliver the row.
  await bus.publish(event);
  expect(handler, 'one failed run, one committed retry, and the post-commit redelivery is skipped').toHaveBeenCalledTimes(2);
  expect(applied).toHaveLength(1);
});

test('a provider retry receives the same key after ambiguous completion', async () => {
  const bus = new InMemoryEventBus();
  const providerSeen: string[] = [];
  const providerApplied = new Set<string>();
  // An external provider that dedupes by key: the first call lands but its reply is lost.
  const provider = vi.fn(async (key: string) => {
    providerSeen.push(key);
    const first = !providerApplied.has(key);
    providerApplied.add(key);
    if (first) throw new Error('timed out waiting for the provider reply');
  });
  // External effects cannot commit atomically with a local key, so processOnce simply runs the effect.
  const passThrough = vi.fn(async ({ effect }: { key: string; effect: () => Promise<void> }) => { await effect(); });
  await subscribeOutbox({
    bus, eventName: event.name, handlerId: 'mailer', processOnce: passThrough,
    handler: async ({ idempotencyKey }) => { await provider(idempotencyKey); },
  });

  await expect(bus.publish(event)).rejects.toThrow('timed out');
  await bus.publish(event);
  expect(providerSeen).toHaveLength(2);
  expect(providerSeen[1], 'the retry must reuse the first attempt key so the provider can dedupe').toBe(providerSeen[0]);
  expect(passThrough.mock.calls.map(([call]) => call.key)).toEqual([providerSeen[0], providerSeen[0]]);
  expect(providerApplied.size).toBe(1);
});

test('concurrent duplicate deliveries run the effect once', async () => {
  const bus = new InMemoryEventBus();
  const ledger = new InMemoryProcessOnceLedger();
  let finish: () => void = () => {};
  const handler = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  await subscribeOutbox({ bus, eventName: event.name, handlerId: 'slow', handler, processOnce: ledger.processOnce });
  const first = bus.publish(event);
  const second = bus.publish(event);
  await Promise.resolve();
  finish();
  await Promise.all([first, second]);
  expect(handler).toHaveBeenCalledTimes(1);
});

test('a concurrent duplicate sees the in-flight failure so the outbox retries it', async () => {
  const ledger = new InMemoryProcessOnceLedger();
  let fail: (error: Error) => void = () => {};
  const effect = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
  const first = ledger.processOnce({ key: 'k', effect });
  const second = ledger.processOnce({ key: 'k', effect });
  fail(new Error('smtp down'));
  await expect(first).rejects.toThrow('smtp down');
  await expect(second).rejects.toThrow('smtp down');
  await ledger.processOnce({ key: 'k', effect: async () => {} });
  expect(effect).toHaveBeenCalledTimes(1);
});

test('registering an outbox subscriber requires a stable handler id', () => {
  const bus = new InMemoryEventBus();
  const ledger = new InMemoryProcessOnceLedger();
  for (const handlerId of ['', '  ', ' mail']) {
    expect(() => subscribeOutbox({ bus, eventName: event.name, handlerId, handler: async () => {}, processOnce: ledger.processOnce }))
      .toThrow('an outbox subscriber needs a stable, non-empty handler id without surrounding spaces');
  }
});

test('an event without an id or workspace id is refused rather than given a colliding key', async () => {
  const bus = new InMemoryEventBus();
  const handler = vi.fn(async () => {});
  await subscribeOutbox({ bus, eventName: event.name, handlerId: 'mail', handler, processOnce: new InMemoryProcessOnceLedger().processOnce });
  await expect(bus.publish({ ...event, workspaceId: '' }))
    .rejects.toThrow("outbox subscriber 'mail' received an event with no id or workspace id, so it cannot derive an idempotency key");
  expect(handler).not.toHaveBeenCalled();
});

test('ordinary listeners on the same bus still see every delivery', async () => {
  const bus = new InMemoryEventBus();
  const listener = vi.fn(async () => {});
  await bus.subscribe({ eventName: event.name, handler: listener });
  await subscribeOutbox({ bus, eventName: event.name, handlerId: 'mail', handler: async () => {}, processOnce: new InMemoryProcessOnceLedger().processOnce });
  await bus.publish(event);
  await bus.publish(event);
  expect(listener).toHaveBeenCalledTimes(2);
});

test('the key is versioned and separators inside ids cannot collide', () => {
  const key = outboxIdempotencyKey({ workspaceId: 'w:1', eventId: 'e', handlerId: 'h' });
  expect(key).toBe('outbox-subscriber.v1:w%3A1:e:h');
  expect(key).not.toBe(outboxIdempotencyKey({ workspaceId: 'w', eventId: '1:e', handlerId: 'h' }));
});

test('unsubscribing stops the outbox subscriber', async () => {
  const bus = new InMemoryEventBus();
  const handler = vi.fn(async () => {});
  const unsubscribe = await subscribeOutbox({ bus, eventName: event.name, handlerId: 'mail', handler, processOnce: new InMemoryProcessOnceLedger().processOnce });
  await unsubscribe();
  await bus.publish(event);
  expect(handler).not.toHaveBeenCalled();
});
