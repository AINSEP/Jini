/**
 * @file The one holder of "which site dirs are MID-TRANSITION right now" — the fact `openSites`
 * cannot express and the Projects screen needs to stop lying with.
 *
 * `child-entries.ts` answers "is this site's child server alive". That is a two-valued answer, and
 * the host snapshot builder (the host lifecycle handler) turned it straight into `running` or `stopped`. Both of a
 * site's lifecycle transitions take real wall-clock time — a boot is seconds, a graceful stop is a
 * SIGTERM plus however long the child takes to drain — and during either one the two-valued answer
 * is wrong in the direction the operator can see:
 *
 * - a site being started reads `stopped` for the whole boot, so a Start button they just pressed
 *   looks like it did nothing, and they press it again;
 * - a site being stopped reads `running` until the child is gone, so a Stop button looks the same.
 *
 * the host lifecycle contract has declared `starting` and `stopping` in `SiteLifecycleStatus` since the
 * port; nothing had ever been able to produce them. This is what produces them.
 *
 * **Not folded into the supervisor**, though the two are read together. The supervisor's entries are
 * owned by the child process — it learns about them from `set`/`delete` and from the child's own
 * `exit`. These are owned by an IPC handler's call stack: they exist exactly while a `handleStart`
 * or `handleStop` body is awaiting, and their correctness rule is a `finally`, not a lifecycle
 * event. Merging them would put two different ownership models behind one `get`.
 *
 * No `electron` import, so all of it is testable under plain `node --test` — same convention as
 * `child-entries.ts`, the directory registry and the directory delete guard.
 */

/** Which lifecycle transition a site is in the middle of. Both are `SiteLifecycleStatus` members
 *  verbatim (the host lifecycle contract), so a reader can use the value as the status directly. */
type ChildTransition = "starting" | "stopping";

/** What {@link createChildTransitions} returns. */
interface ChildTransitions {
  /**
   * Mark `key` as mid-`transition`, run `body`, and unmark it — whether `body` resolves or
   * rejects. The unmark is the whole contract: a start that fails must leave the card `stopped`,
   * not `starting` forever.
   */
  during<T>({ key, transition, body }: { key: string; transition: ChildTransition; body: () => Promise<T> }, optional?: Record<string, never>): Promise<T>;
  /** The transition `key` is in the middle of, or `null`. */
  get({ key }: { key: string }, optional?: Record<string, never>): ChildTransition | null;
}

/**
 * @returns an empty transition store.
 * @complexity O(1) to construct.
 */
function createChildTransitions(_required: Record<string, never>, _optional: Record<string, never> = {}): ChildTransitions {
  /**
   * Site dir -> the marker object for the transition currently running on it.
   *
   * The stored value is a fresh object per call rather than the bare string so {@link during}'s
   * `finally` can check IDENTITY before clearing — the same rule, and for the same reason, as
   * `child-entries.ts`'s `handleExit`. the host lifecycle handler serializes start and stop per site dir,
   * so overlapping transitions on one site should not happen; "should not happen" is not a reason
   * for a later transition's mark to be cleared by an earlier one's unwind if it ever does.
   */
  const active = new Map<string, { transition: ChildTransition }>();

  return {
    /** @complexity O(1) beyond `body`'s own cost. */
    async during<T>({ key, transition, body }: { key: string; transition: ChildTransition; body: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> {
      const marker = { transition };
      active.set(key, marker);
      try {
        return await body();
      } finally {
        if (active.get(key) === marker) active.delete(key);
      }
    },

    /** @complexity O(1). */
    get({ key }: { key: string }, _optional: Record<string, never> = {}): ChildTransition | null {
      return active.get(key)?.transition ?? null;
    },
  };
}

export { createChildTransitions };
export type { ChildTransition, ChildTransitions };
