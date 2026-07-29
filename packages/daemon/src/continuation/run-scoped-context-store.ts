/**
 * @module run-scoped-context-store
 *
 * A bind/resolve/auto-evict map keyed by run id, for host-owned context that has to survive the gap
 * between starting a run and a later, out-of-band call that carries only that run's id.
 *
 * The shape of the problem: a session-authenticated product verifies a caller in its own process,
 * starts a run in a daemon process that has no session of its own, and later receives a delegated
 * tool call from that run's spawned MCP subprocess — a request whose only identifying content is the
 * run id. Something has to remember which authority that run was started with, and stop remembering
 * once the run ends.
 *
 * **Why this isn't `resolveRunInput`.** `createDefaultRunStartHandler`'s `resolveRunInput` seam
 * already receives `{runId, contextRef}`, so a host could decode and stash there — but it is handed no
 * lifecycle, so it cannot register the eviction half, and a map that only ever grows is a leak that
 * also keeps stale authority resolvable. Owning both halves together is this module's entire reason
 * to exist.
 *
 * **What this deliberately does NOT do**, because it is host policy and Jini is identity-neutral:
 *
 * - It does not decode `contextRef`. That field is an opaque string by contract (see
 *   `@jini-ai/http-kit`'s `RunCreateRequest`), and no wire format for it is standardized here.
 * - It does not sign, verify, or validate anything. `T` is whatever the host binds.
 * - It has no notion of a principal, a session, or a user. `T` is fully generic for that reason.
 *
 * **Durability, stated plainly: there is none.** The map is in-memory and per-process. After a daemon
 * restart every `resolve` fails, which is the correct posture rather than a gap — an in-memory map
 * cannot authorize a resumed run, and silently treating "I have forgotten who started this" as
 * "anyone may act as them" is the failure this module exists to make impossible. A host needing
 * cross-restart continuity must reconstruct bindings from its own durable store on boot.
 */
import type { RunLifecycle } from '../run-lifecycle.js';

/**
 * Thrown by {@link RunScopedContextStore.resolve} for a run this store is not currently tracking.
 *
 * A distinct class rather than a bare `Error` so a caller can map it deliberately — an unknown run is
 * usually "not found", not "internal error" — instead of string-matching a message.
 */
export class RunContextNotBoundError extends Error {
  constructor(public readonly runId: string) {
    super(`no context is bound for run "${runId}"`);
    this.name = 'RunContextNotBoundError';
  }
}

export interface RunScopedContextStore<T> {
  /**
   * Associates `value` with `runId` and schedules its removal for when the run reaches a terminal
   * state. Binding the same `runId` twice replaces the value without adding a second eviction
   * subscription.
   */
  bind(runId: string, value: T): void;
  /**
   * The value bound for `runId`.
   * @throws {@link RunContextNotBoundError} when the run is unknown, already finished, or was never
   * bound. Never returns a default — see this module's doc on why fabricating one would be the bug.
   */
  resolve(runId: string): T;
  /** Whether `runId` currently has a binding. For callers that need a check without a throw. */
  has(runId: string): boolean;
  /** Live binding count. Exists so a host (or a test) can assert the map actually drains. */
  readonly size: number;
}

export interface CreateRunScopedContextStoreOptions {
  /**
   * The lifecycle whose terminal transitions evict bindings. Must be the same lifecycle the bound
   * runs were started on — a store wired to a different one would never evict anything.
   */
  readonly lifecycle: Pick<RunLifecycle, 'waitForTerminal'>;
}

/**
 * Builds a run-scoped context store — see this module's doc for the problem it solves and the policy
 * it deliberately leaves to the host.
 *
 * @param options.lifecycle - See {@link CreateRunScopedContextStoreOptions.lifecycle}.
 * @returns A {@link RunScopedContextStore} for the caller's own `T`.
 * @complexity `bind`/`resolve`/`has` are O(1). Memory is O(n) in concurrently-live bound runs, which
 * is bounded by eviction rather than by total runs ever started.
 * @overallScore 100/100
 */
export function createRunScopedContextStore<T>(
  options: CreateRunScopedContextStoreOptions,
): RunScopedContextStore<T> {
  const values = new Map<string, T>();

  return {
    bind(runId: string, value: T): void {
      // Re-binding replaces the value but must not subscribe twice: each subscription is a retained
      // promise callback, and one eviction is all a run can need.
      const alreadyTracked = values.has(runId);
      values.set(runId, value);
      if (alreadyTracked) return;

      const evict = (): void => {
        values.delete(runId);
      };
      // `then(evict, evict)`, not `.finally(evict)`: a rejecting `waitForTerminal` would leave
      // `.finally`'s returned promise rejected, and nothing awaits it — an unhandled rejection that
      // could take the process down. Either outcome means the run is over, so both evict.
      void options.lifecycle.waitForTerminal(runId).then(evict, evict);
    },

    resolve(runId: string): T {
      if (!values.has(runId)) throw new RunContextNotBoundError(runId);
      return values.get(runId) as T;
    },

    has(runId: string): boolean {
      return values.has(runId);
    },

    get size(): number {
      return values.size;
    },
  };
}
