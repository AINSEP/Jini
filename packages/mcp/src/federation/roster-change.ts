import type { ToolAccessChange } from "@jini-ai/core/contracts/site/daemon";

/**
 * @file A keyed, last-wins fan-out for "the external-MCP roster changed" — the seam that lets every
 * runtime holding a live federated-tool registry (an agent daemon's own, a per-request BYOK
 * federation runtime) hear about a roster write without each writer (a connection PUT, an OAuth
 * callback, a model-facing roster tool) having to know how many runtimes exist or what each one's
 * reload method is called.
 *
 * Keyed rather than a plain list: a composition root that calls its own registration twice (a
 * hot-reloaded module, a test that rebuilds the app) must replace its own listener, not accumulate a
 * second one that fires the same reload twice per roster change.
 *
 * Ordinary discovery refreshes never reject or wait past `waitMs` for a stuck listener: callers
 * that await it (an OAuth callback) do so to let an operator return to the chat and find a newly
 * authorized connection already usable, not to gate their own response's correctness on every
 * registered runtime's reload succeeding — a listener that never resolves must not turn into a
 * request that never resolves either. Lowering tool access is different: callers await Stop and
 * cleanup, and a failure or deadline rejects with the host's safe, actionable error
 * (`createLoweringError`), so this package never owns the host's error class or wording.
 *
 * State is owned by each bus instance (no module-level registry): the host creates ONE bus in its
 * composition module and binds `on`/`notify`/`reset` from it.
 *
 * Architectural role:
 * In-memory registry. No I/O of its own; every listener performs its own.
 */

/** A registered reaction to a roster change. Return shape varies by runtime (a reload result, an
 *  `{ok}` shape, or nothing at all) — `notify` only needs to know when each one settles, never what
 *  it settled with. */
export type McpRosterChangeListener = (lowered?: ToolAccessChange) => unknown;

/** Options for one `notify` call. */
export interface McpRosterChangeNotifyOptions {
  readonly waitMs?: number;
  readonly lowered?: ToolAccessChange;
}

/** Collaborators the host injects into {@link createMcpRosterChangeBus}. */
export interface McpRosterChangeBusDeps {
  /** Builds the safe, actionable error a failed or timed-out lowering rejects with. It must not carry
   *  the listener's own failure text (that may hold secrets or internal detail). */
  readonly createLoweringError: () => Error;
  /** Default cap for one `notify` call. */
  readonly defaultWaitMs?: number;
}

/** One instance-owned roster-change fan-out. */
export interface McpRosterChangeBus {
  /** Registers a reaction under `key`; re-registering the same key REPLACES the earlier listener. */
  on(args: { key: string; listener: McpRosterChangeListener }, _optional?: object): void;
  /** Fans a change out to every listener; lowering rejects with the injected error on failure. */
  notify(options?: McpRosterChangeNotifyOptions): Promise<void>;
  /** Drops every registered listener (tests that rebuild composition roots in one process). */
  reset(): void;
}

/** Bounds one `notify()` call: one on-demand, idempotent attempt should fail fast rather than hold a
 *  caller's response open, applied across every registered listener at once. */
const DEFAULT_WAIT_MS = 5_000;

/** Invokes a listener without letting a synchronous throw escape before `Promise.allSettled` ever
 *  sees it — `Array.prototype.map` would otherwise abort the whole fan-out on the first offender. */
function invokeSafely(listener: McpRosterChangeListener, lowered?: ToolAccessChange): Promise<unknown> {
  try {
    return Promise.resolve(listener(lowered));
  } catch (err) {
    return Promise.reject(err);
  }
}

/** Lowering is a correctness boundary, unlike a best-effort discovery refresh: the serving listener
 *  awaits the authenticated daemon Stop/cleanup control and failures reach the writer. */
function awaitLowering(args: { listeners: readonly McpRosterChangeListener[]; lowered: ToolAccessChange; waitMs: number; createLoweringError: () => Error }): Promise<void> {
  const { listeners, lowered, waitMs, createLoweringError } = args;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(createLoweringError()), waitMs);
    void Promise.all(listeners.map(listener => invokeSafely(listener, lowered))).then(
      () => { clearTimeout(timer); resolve(); },
      () => { clearTimeout(timer); reject(createLoweringError()); },
    );
  });
}

/** Best-effort refresh: `allSettled`, so one throwing or rejecting listener never stops the rest,
 *  capped at `waitMs` so a listener cannot hold a caller open indefinitely. */
function awaitRefresh(listeners: readonly McpRosterChangeListener[], waitMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      timer = undefined;
      resolve();
    }, waitMs);
    void Promise.allSettled(listeners.map(listener => invokeSafely(listener))).then(() => {
      if (timer !== undefined) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

/**
 * Creates an instance-owned roster-change bus. The host injects `createLoweringError` so a failed
 * lowering rejects with the host's own error type.
 *
 * @complexity `notify` is O(1) plus the cost of every registered listener, in parallel, once.
 */
export function createMcpRosterChangeBus(deps: McpRosterChangeBusDeps, _optional = {}): McpRosterChangeBus {
  const listenersByKey = new Map<string, McpRosterChangeListener>();
  const defaultWaitMs = deps.defaultWaitMs ?? DEFAULT_WAIT_MS;
  return {
    on({ key, listener }) {
      listenersByKey.set(key, listener);
    },
    async notify(options = {}) {
      const waitMs = options.waitMs ?? defaultWaitMs;
      const listeners = [...listenersByKey.values()];
      if (listeners.length === 0) return;
      if (options.lowered) {
        await awaitLowering({ listeners, lowered: options.lowered, waitMs, createLoweringError: deps.createLoweringError });
        return;
      }
      await awaitRefresh(listeners, waitMs);
    },
    reset() {
      listenersByKey.clear();
    },
  };
}
