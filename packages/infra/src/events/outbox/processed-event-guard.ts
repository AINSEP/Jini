import type { ProcessedEventKey, ProcessedEventStore } from './ports.js';

/**
 * Reference `ProcessedEventStore` for tests and single-process hosts. Each method mutates
 * synchronously before returning its promise, so two concurrent claims of one key cannot both win.
 * It forgets everything on restart, which is exactly the redelivery case a durable host store
 * exists for: production hosts implement the port over their own database.
 * @complexity O(1) per call. */
export class InMemoryProcessedEventStore implements ProcessedEventStore {
  readonly #claimed = new Set<string>();

  async claim(required: ProcessedEventKey): Promise<boolean> {
    const key = processedEventKeyOf(required);
    if (this.#claimed.has(key)) return false;
    this.#claimed.add(key);
    return true;
  }
  async release(required: ProcessedEventKey): Promise<void> {
    this.#claimed.delete(processedEventKeyOf(required));
  }
}

/** JSON keeps ids containing any separator from colliding with another (eventId, handlerId) pair. */
function processedEventKeyOf(required: ProcessedEventKey): string {
  return JSON.stringify([required.eventId, required.handlerId]);
}

/**
 * Wrap one subscriber so a redelivered event (same `event.id`) runs it once per `handlerId`.
 * Apply it when subscribing, e.g. `bus.subscribe({ eventName, handler: withProcessedEventGuard({ store, handlerId: 'sitemap', handler }) })`.
 *
 * Claim first, then run: a lost claim means another delivery already ran, or is running, this
 * handler, so the duplicate returns quietly. If the handler throws, the claim is released before
 * the error is rethrown, so the outbox still sees the failure and its retry runs the handler again;
 * a concurrent duplicate skipped meanwhile is covered by that same retry. If the release itself
 * fails, the claim is stuck and a retry would silently skip the handler, so both errors surface
 * together. Residual risk: a process that dies mid-handler leaves its claim; a durable host store
 * should commit the claim in the handler's own transaction (or expire it) to close that gap.
 * @complexity O(1) store calls plus one handler run. */
export function withProcessedEventGuard<Event extends { readonly id: string }>(
  required: { store: ProcessedEventStore; handlerId: string; handler: (event: Event) => Promise<void> },
  _optional: Record<string, never> = {},
): (event: Event) => Promise<void> {
  const { store, handlerId, handler } = required;
  return async event => {
    const key = { eventId: event.id, handlerId };
    if (!await store.claim(key)) return;
    try {
      await handler(event);
    } catch (error) {
      await store.release(key).catch((releaseError: unknown) => {
        throw new AggregateError([error, releaseError],
          `handler '${handlerId}' failed on event '${event.id}' and its claim could not be released, so a redelivery will skip it`);
      });
      throw error;
    }
  };
}
