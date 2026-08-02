/**
 * `RealtimeProvider` — a swappable pub/sub port (live updates pushed to
 * subscribers). Speculative port-design exploration (see `source-map.md`) —
 * no OD source; named in `foundry/docs/jini-port/recon/r5b-consumers-matrix.md` §3.3
 * as part of the capability set Zana and a fleet orchestrator converge on
 * (Supabase Realtime is Zana's reference adapter).
 *
 * This file defines only the port's stable interface/type surface. The one
 * real, production-quality adapter (`WebSocketRealtimeProvider` +
 * `createWebSocketRealtimeProvider`, using the `ws` package) lives at the
 * separate `@jini-ai/capability-providers/adapters/ws` entry point — moved
 * there (2026-07-29) so this package's main barrel, which imports this
 * module, is never forced to resolve `ws` just for the port type. The
 * in-memory reference implementation (`createInMemoryRealtimeProvider`) is a
 * separate, non-production stub that lives under `src/unsafe-reference/`,
 * exported only from the separate
 * `@jini-ai/capability-providers/unsafe-reference` entry point — see that
 * directory's `index.ts` header for the full warning.
 */

export type RealtimeHandler<T = unknown> = (event: T) => void;

/** Call to stop receiving events for the subscription that returned it. Idempotent. */
export type RealtimeUnsubscribe = () => void;

export interface RealtimeProvider {
  /** Delivers `event` synchronously to every current subscriber of `channel`. Resolves once all handlers have run. */
  publish<T>(channel: string, event: T): Promise<void>;
  /** Registers `handler` for every future `publish` on `channel`. Returns an unsubscribe function. */
  subscribe<T>(channel: string, handler: RealtimeHandler<T>): RealtimeUnsubscribe;
}
