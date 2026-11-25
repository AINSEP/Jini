import type {
  Empty, OutboxSubscribedEvent, OutboxSubscriberHandler, OutboxSubscriptionBus, ProcessOnce,
} from './ports.js';

/** Bump only with a migration: hosts persist these keys and providers dedupe on them. */
const OUTBOX_KEY_VERSION = 'outbox-subscriber.v1';

/**
 * The stable idempotency key for one subscriber's run of one event: a versioned encoding of
 * `[workspaceId, eventId, handlerId]`. It never includes an attempt number, so a retry after an
 * ambiguous completion hands a provider the same key. Each part is URI-encoded, so a separator
 * inside an id cannot collide with another triple, and the key stays header-safe ASCII.
 * @complexity O(total id length). */
export function outboxIdempotencyKey(
  required: { workspaceId: string; eventId: string; handlerId: string },
  _optional: Empty = {},
): string {
  const { workspaceId, eventId, handlerId } = required;
  return [OUTBOX_KEY_VERSION, workspaceId, eventId, handlerId].map(encodeURIComponent).join(':');
}

/**
 * Register one outbox subscriber: each delivery derives the subscriber's stable key and runs the
 * handler through the host's `processOnce`, so a redelivery applies the effect once per handler.
 * Keys are per handler, so one subscriber finishing never marks the whole broadcast processed.
 * The worker's retry, lease and fencing are untouched; ordinary `bus.subscribe` listeners too.
 * @example await subscribeOutbox({ bus, eventName: 'form.submitted', handlerId: 'notify', handler, processOnce });
 * @complexity O(1) per delivery beyond `processOnce` and the handler. */
export function subscribeOutbox<Event extends OutboxSubscribedEvent, Unsubscribe>(
  required: {
    bus: OutboxSubscriptionBus<Event, Unsubscribe>;
    eventName: string;
    /** Stable across deploys and unique per event name: it is part of every persisted key. */
    handlerId: string;
    handler: OutboxSubscriberHandler<Event>;
    processOnce: ProcessOnce;
  },
  _optional: Empty = {},
): Promise<Unsubscribe> {
  const { bus, eventName, handlerId, handler, processOnce } = required;
  if (handlerId.trim() === '' || handlerId.trim() !== handlerId) {
    throw new Error('an outbox subscriber needs a stable, non-empty handler id without surrounding spaces');
  }
  return bus.subscribe({
    eventName,
    handler: async event => {
      if (!event.id || !event.workspaceId) {
        throw new Error(`outbox subscriber '${handlerId}' received an event with no id or workspace id, so it cannot derive an idempotency key`);
      }
      const idempotencyKey = outboxIdempotencyKey({ workspaceId: event.workspaceId, eventId: event.id, handlerId });
      // Worker lease fencing protects the delivery row, not the external side effect.
      await processOnce({ key: idempotencyKey, effect: () => handler({ event, idempotencyKey }) });
    },
  });
}
