/**
 * @file The OUTBOX RELAY (lot L5): publishes the events the single writer enqueued in the same
 * transaction as the money change (`payment.succeeded`, `refund.succeeded`, `refund.failed`,
 * `dispute.opened`, `dispute.closed`) to a host-owned bus, then marks them published.
 *
 * At-least-once: a message is marked only after `publish` resolved, so a crash between the two
 * republishes it; consumers dedupe by the message `id`. A publish failure stops the batch and
 * leaves the rest pending, so a consumer never sees a later event before an earlier one.
 *
 * "Earlier" is the ledger's `listPendingOutbox` order: `created_at`, then `seq`, then `id`. Messages
 * one apply enqueues share `created_at`; `seq` (migration 0002, assigned at enqueue) keeps their
 * intra-transaction order, so `payment.succeeded` precedes a refund of the same payment.
 */
import type { PaymentMode } from "../contract/scope.js";
import type { PaymentsLedger } from "../ledger/repo.js";
import type { LedgerOutboxTopic, OutboxRecord } from "../ledger/rows.js";

/** What a consumer receives. Ids and amounts only: the writer puts no personal data in payloads. */
export interface PaymentsOutboxMessage {
  /** Stable across redeliveries: the consumer's dedupe key. */
  readonly id: string;
  readonly workspaceId: string;
  readonly mode: PaymentMode;
  readonly topic: LedgerOutboxTopic;
  /** The payment id. */
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
}

/** Host-owned bus. A throw (or rejection) = not delivered; the message stays pending. */
export interface OutboxPublisherPort {
  publish(required: { message: PaymentsOutboxMessage }, optional?: Record<string, never>): Promise<void>;
}

export interface OutboxRelayDeps {
  readonly ledger: PaymentsLedger;
  readonly publish: OutboxPublisherPort;
  readonly now: () => number;
}

/** `stopped` = a publish failed and the rest of the batch was left pending. */
export interface OutboxRunCounts {
  readonly published: number;
  readonly stopped: boolean;
}

export interface OutboxRelay {
  runOnce(required: { limit: number }, optional?: Record<string, never>): Promise<OutboxRunCounts>;
}

function messageOf(record: OutboxRecord): PaymentsOutboxMessage {
  return {
    id: record.id, workspaceId: record.workspaceId, mode: record.mode, topic: record.topic, aggregateId: record.aggregateId,
    payload: JSON.parse(record.payloadJson) as Record<string, unknown>, createdAt: record.createdAt,
  };
}

/**
 * Builds the relay. Run it on a timer; like the inbox worker, one runner per database (pending
 * messages are read, not claimed).
 * @complexity O(limit) publishes per run.
 */
export function createOutboxRelay(deps: OutboxRelayDeps, _optional: Record<string, never> = {}): OutboxRelay {
  return {
    runOnce: async ({ limit }) => {
      const pending = await deps.ledger.transaction((tx) => tx.listPendingOutbox({ limit }));
      let published = 0;
      for (const record of pending) {
        try {
          // Parsing inside the try: an unreadable payload stops the batch like a failed publish, never crashes the relay.
          await deps.publish.publish({ message: messageOf(record) });
        } catch {
          return { published, stopped: true };
        }
        await deps.ledger.transaction((tx) => tx.markOutboxPublished({ id: record.id, publishedAt: deps.now() }));
        published += 1;
      }
      return { published, stopped: false };
    },
  };
}
