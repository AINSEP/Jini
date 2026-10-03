/** Tracks unfinished work and gates graceful shutdown without depending on a desktop backend. */
/**
 * Removing a closed window/resource from the live registry does not mean its async teardown
 * has finished. Quitting from an empty registry can abandon that work and leave detached child
 * processes alive, especially when their crash-recovery entry has already been removed.
 * Track promises separately from live resources so shutdown can still see that in-flight work.
 */
interface ShutdownTracker {
  track({ promise }: { promise: PromiseLike<unknown> }): Promise<void>;
  readonly size: number;
  drain(): Promise<void>;
}

/** Create an isolated tracker. Rejected teardowns settle normally; drain also awaits work added during draining. @complexity O(1) construction; O(n) pending work per drain snapshot. */
function createShutdownTracker(_required: Record<string, never>): ShutdownTracker {

  const pending = new Set<Promise<void>>();

  return {

    track({ promise }: { promise: PromiseLike<unknown> }): Promise<void> {
      // A failed logout/stop must still be waited for, but must not make graceful quit reject
      // and hang: that would be worse than the unfinished-resource leak this tracker prevents.
      const settled = Promise.resolve(promise).then(
        () => {},
        () => {}
      );
      pending.add(settled);
      void settled.then(() => pending.delete(settled));
      return settled;
    },

    get size(): number {
      return pending.size;
    },

    async drain(): Promise<void> {
      // Waiting for one teardown can let another closed-handler enqueue work. A single snapshot
      // would miss it; every iteration awaits real pending promises rather than spinning.
      while (pending.size > 0) {
        await Promise.all([...pending]);
      }
    },
  };
}

export { createShutdownTracker };
export type { ShutdownTracker };
