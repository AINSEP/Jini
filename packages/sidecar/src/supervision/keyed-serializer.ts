/**
 * @file Per-key promise chaining, so two calls for the SAME key never race — the host's
 * existing per-project serialization pattern, generalized: this file has no
 * notion of a "project", just a string key and a function to chain.
 *
 * Multiple keys reintroduce exactly the race the host built that pattern for: with one site and one
 * button, a double-click could only ever double-spawn the same single child. With N sites, each
 * exposed through its own menu entry (open, or open-recent), the same double-click risk reappears
 * per site — this closes it generically rather than needing a guard duplicated at every call site
 * (the host's open-window and open-new-directory operations).
 *
 * Calls for DIFFERENT keys are never serialized against each other — opening site A must not wait on
 * site B's own in-flight open.
 */

import { afterSettled } from "@jini-ai/core/errors/idioms";

/** What {@link createKeyedSerializer} returns. */
interface KeyedSerializer {
  run<T>({ key, fn }: { key: string; fn: () => T | PromiseLike<T> }, optional?: Record<string, never>): Promise<T>;
}

/**
 * @returns `{ run({ key, fn }) }` — a fresh, independent chain store.
 * @complexity O(1) to construct.
 */
function createKeyedSerializer(_required: Record<string, never>, _optional: Record<string, never> = {}): KeyedSerializer {
  const chains = new Map<string, Promise<unknown>>();

  /**
   * Run `fn` only after every previously-queued call for THIS key has settled — a prior call's
   * failure never blocks the next one in line (`afterSettled` observes it before chaining `fn`
   * on; `fn`'s own rejection still propagates to ITS caller via the returned promise).
   *
   * @returns `fn`'s own resolution or rejection.
   * @complexity O(1) scheduling cost; `fn`'s own cost is the caller's.
   */
  function run<T>({ key, fn }: { key: string; fn: () => T | PromiseLike<T> }, _optional: Record<string, never> = {}): Promise<T> {
    const previous = chains.get(key) ?? Promise.resolve();
    const next = afterSettled({ promise: previous }).then(fn);
    chains.set(key, next);
    const clearSlot = () => {
      // Only clear the slot if nothing queued behind this call while it was running — otherwise a
      // later `run()` for the same key already replaced it and clearing here would drop that entry.
      if (chains.get(key) === next) chains.delete(key);
    };
    // `.then(clearSlot, clearSlot)`, not `.finally()`: `.finally()`'s own returned promise re-throws
    // `next`'s rejection and nothing observes THAT derived promise, which Node reports as an
    // unhandled rejection even though `next` itself (what the caller awaits) is handled correctly.
    // Passing `clearSlot` as both reactions produces a promise that always resolves instead.
    next.then(clearSlot, clearSlot);
    return next;
  }

  return { run };
}

export { createKeyedSerializer };
export type { KeyedSerializer };
