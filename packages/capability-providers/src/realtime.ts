/**
 * Swappable pub/sub port for live updates. See index.ts for capability-provider ownership and adoption scope.
 *
 * This file defines only the port's stable interface/type surface. The one
 * real, production-quality adapter (`WebSocketRealtimeProvider` +
 * `createWebSocketRealtimeProvider`, using the `ws` package) lives at the
 * separate `@jini-ai/capability-providers/adapters/ws` entry point so the main barrel, which imports this
 * module, is never forced to resolve `ws` just for the port type. The
 * in-memory reference implementation (`createInMemoryRealtimeProvider`) is a
 * separate, non-production stub that lives under `src/unsafe-reference/`,
 * exported only from the separate
 * `@jini-ai/capability-providers/unsafe-reference` entry point — see that
 * directory's `index.ts` header for the full warning.
 */

export type RealtimeHandler<T = unknown> = (required: { event: T }) => void;

/** Call to stop receiving events for the subscription that returned it. Idempotent. */
export type RealtimeUnsubscribe = () => void;

export interface RealtimeProvider {
  /** Delivers `event` synchronously to every current subscriber of `channel`. Resolves once all handlers have run. */
  publish<T>(required: { channel: string; event: T }): Promise<void>;
  /** Registers `handler` for every future `publish` on `channel`. Returns an unsubscribe function. */
  subscribe<T>(required: { channel: string; handler: RealtimeHandler<T> }): RealtimeUnsubscribe;
}
