/**
 * UNSAFE REFERENCE IMPLEMENTATION — not production code. See the header
 * comment in `src/unsafe-reference/index.ts` for the full warning; the
 * short version: `createInMemoryRealtimeProvider` has no principal/tenant/
 * channel-authorization dimension and retains subscribers in unbounded
 * memory. It exists only to prove `RealtimeProvider` (defined in
 * `../realtime.ts`) is implementable and unit-testable. Never wire this
 * into anything that handles real user data.
 *
 * A real adapter (Supabase Realtime, a WebSocket/Redis pub-sub service)
 * implements the same `RealtimeProvider` interface without importing this
 * file.
 */
import type { RealtimeHandler, RealtimeProvider, RealtimeUnsubscribe } from '../realtime.js';

/** Creates the in-memory reference `RealtimeProvider`. Delivery is in-process only — no cross-process fan-out. */
export function createInMemoryRealtimeProvider(_required: Record<string, never>): RealtimeProvider {
  const channels = new Map<string, Set<RealtimeHandler>>();

  function subscribersFor(channel: string): Set<RealtimeHandler> {
    let subscribers = channels.get(channel);
    if (!subscribers) {
      subscribers = new Set();
      channels.set(channel, subscribers);
    }
    return subscribers;
  }

  return {
    async publish<T>({ channel, event }: { channel: string; event: T }): Promise<void> {
      const subscribers = channels.get(channel);
      if (!subscribers) return;
      for (const handler of [...subscribers]) {
        handler({ event });
      }
    },

    subscribe<T>({ channel, handler }: { channel: string; handler: RealtimeHandler<T> }): RealtimeUnsubscribe {
      const subscribers = subscribersFor(channel);
      subscribers.add(handler as RealtimeHandler);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        subscribers.delete(handler as RealtimeHandler);
      };
    },
  };
}
