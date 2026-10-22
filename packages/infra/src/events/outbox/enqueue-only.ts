import type { EventEnvelope, OutboxPort } from './ports.js';

/** Non-owner view: enqueue unchanged envelopes, never claim or settle deliveries.
 *
 * The 2026-09-14 fix prevents lost effects when an assistant process and a serving process
 * share storage but each owns a different in-memory bus. Only the serving bus has the real
 * subscribers, such as sitemap invalidation, notifications, webhook fan-out and batch work.
 * Inline drains in the assistant formerly published against a bus without those handlers and
 * marked rows delivered, losing those events and any unrelated pending rows in the same claim.
 * This view returns no claims, leaving rows pending for the delivery owner's background loop.
 * markDelivered and markFailed reject loudly: no legitimate outcome can arrive without a claim,
 * so such a call is a wiring bug. The wrapped outbox is not modified; enqueue preserves envelope
 * identity. Storage, schema and delivery-owner selection remain host responsibilities.
 * @complexity O(1) per call beyond the wrapped enqueue. */
export function toEnqueueOnlyOutbox<Event extends EventEnvelope>(required: { outbox: OutboxPort<Event> }): OutboxPort<Event> {
  return {
    enqueue: args => required.outbox.enqueue(args),
    claimPending: async () => [],
    async markDelivered({ id }) {
      throw new Error(`enqueue-only outbox: markDelivered('${id}') was called, but this process never claims outbox rows`);
    },
    async markFailed({ id }) {
      throw new Error(`enqueue-only outbox: markFailed('${id}') was called, but this process never claims outbox rows`);
    },
  };
}
