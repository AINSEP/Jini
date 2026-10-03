import { useRef } from "react";

/**
 * Writes on one lane must reach persistence in call order: a later write must not race an
 * earlier one, and rejecting a write must neither poison the lane nor drop queued work.
 * Independent row writes can use separate keys. Cancellation, deduplication and newest-result
 * UI ownership belong to the caller; queued final writes may still be needed after unmount.
 * When composing with useSettlementGeneration, mint the generation BEFORE run({ task }),
 * not inside task: otherwise each delayed task can claim to be current when it finally starts.
 *
 * Even an idle lane starts its task one microtask later, leaving synchronous busy/error and
 * generation bookkeeping ahead of execution. run returns the task's own outcome; internal
 * lane cleanup does not swallow a discarded rejecting promise's unhandled rejection.
 * Re-entrant run calls queue normally, but awaiting an inner call from a task on the same
 * lane deadlocks: the inner task is waiting for the outer task to release that lane.
 */
export interface SerialWrites {

  /** Each caller observes its own task result or rejection, never the internal lane tail. */
  run<T>({ task }: { task: () => Promise<T> }, options?: { key?: string }): Promise<T>;
}

const DEFAULT_LANE = Symbol("useSerialWrites default lane");
const IDLE: Promise<void> = Promise.resolve();

function createSerialWrites(): SerialWrites {
  // Each lane's tail is the promise the NEXT queued task waits on; a lane is dropped from the
  // map once its own tail settles and nothing newer has replaced it, so a keyed caller (only
  // `use-external-mcp.hooks.ts` today) cannot grow this map without bound.
  const tails = new Map<string | symbol, Promise<void>>();
  return {
    run<T>({ task }: { task: () => Promise<T> }, options?: { key?: string }): Promise<T> {
      const lane = options?.key ?? DEFAULT_LANE;
      const prior = tails.get(lane) ?? IDLE;
      let release!: () => void;
      const tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      tails.set(lane, tail);
      return prior.then(async () => {
        try {
          return await task();
        } finally {
          if (tails.get(lane) === tail) tails.delete(lane);
          release();
        }
      });
    },
  };
}

/** Stable promise lane: queue writes in call order without poisoning later work after rejection.
 * Already queued persistence continues after unmount; callers guard their own state updates. */
export function useSerialWrites(): SerialWrites {
  // Stable identity over a mutable ref, same reason as `useSettlementGeneration`: several
  // adopting call sites put this in a `useCallback`/`useMemo` dependency list.
  const ref = useRef<SerialWrites | undefined>(undefined);
  if (!ref.current) ref.current = createSerialWrites();
  return ref.current;
}
