import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSerialWrites } from "../use-serial-writes.hooks";
import { useSettlementGeneration } from "../use-settlement-generation.hooks";

/**
 * @file `useSerialWrites` — the shared "queue this write behind every write already queued on
 * the same lane" chain extracted out of the six hand-rolled `*ChainRef`/`writeChainRef` call
 * sites this replaces. See the source file's own header for which six, and why none of them
 * wants poisoning, skipping, or unmount cancellation.
 *
 * Deferred promises only, never fake timers or `setTimeout` — a race is pinned by manually
 * resolving/rejecting a parked promise at the exact point the test wants to observe, not by
 * advancing a clock. `flushMicrotasks` lets pending `.then` reactions run without pinning an
 * exact tick count.
 */

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe("useSerialWrites — identity", () => {
  it("returns the same object and the same run across rerenders", () => {
    const { result, rerender } = renderHook(() => useSerialWrites());
    const first = result.current;
    const firstRun = result.current.run;
    rerender();
    expect(result.current).toBe(first);
    expect(result.current.run).toBe(firstRun);
  });
});

describe("useSerialWrites — never starts synchronously", () => {
  it("does not call the task inside run(); calls it exactly once after a flush", async () => {
    const { result } = renderHook(() => useSerialWrites());
    const task = vi.fn(async () => "value");
    const promise = result.current.run({ task: task });
    expect(task).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(task).toHaveBeenCalledTimes(1);
    await expect(promise).resolves.toBe("value");
  });
});

describe("useSerialWrites — ordering", () => {
  it("runs three queued tasks strictly one at a time, in queue order", async () => {
    const { result } = renderHook(() => useSerialWrites());
    const started: string[] = [];
    const a = deferred<void>();
    const b = deferred<void>();
    const c = deferred<void>();

    const pA = result.current.run({ task: () => {
      started.push("A");
      return a.promise;
    } });
    const pB = result.current.run({ task: () => {
      started.push("B");
      return b.promise;
    } });
    const pC = result.current.run({ task: () => {
      started.push("C");
      return c.promise;
    } });

    await flushMicrotasks();
    expect(started).toEqual(["A"]);

    a.resolve();
    await pA;
    await flushMicrotasks();
    expect(started).toEqual(["A", "B"]);

    b.resolve();
    await pB;
    await flushMicrotasks();
    expect(started).toEqual(["A", "B", "C"]);

    c.resolve();
    await pC;
  });
});

describe("useSerialWrites — a finished task never frees a lane a later task still holds", () => {
  it("a task queued after an earlier one settled, while a later one is still running, waits for that later one", async () => {
    const { result } = renderHook(() => useSerialWrites());
    const started: string[] = [];
    const b = deferred<void>();

    const pA = result.current.run({ task: async () => {
      started.push("A");
    } });
    const pB = result.current.run({ task: () => {
      started.push("B");
      return b.promise;
    } });
    await pA;
    await flushMicrotasks();
    expect(started).toEqual(["A", "B"]);

    // A has settled and B is still running. A's cleanup must not drop the lane B now owns —
    // otherwise C would start on an idle lane, concurrently with B.
    const pC = result.current.run({ task: async () => {
      started.push("C");
    } });
    await flushMicrotasks();
    expect(started).toEqual(["A", "B"]);

    b.resolve();
    await pB;
    await pC;
    expect(started).toEqual(["A", "B", "C"]);
  });
});

describe("useSerialWrites — own value", () => {
  it("resolves run with its own task's value, not an earlier queued task's", async () => {
    const { result } = renderHook(() => useSerialWrites());
    const pFirst = result.current.run({ task: async () => "first" });
    const pSecond = result.current.run({ task: async () => "second" });
    await expect(pFirst).resolves.toBe("first");
    await expect(pSecond).resolves.toBe("second");
  });
});

describe("useSerialWrites — failure isolation (rejection)", () => {
  it("a rejected task does not block the next queued task, which starts only after it settles", async () => {
    const { result } = renderHook(() => useSerialWrites());
    const err = new Error("boom");
    const started: string[] = [];
    const a = deferred<void>();

    const pA = result.current.run({ task: () => {
      started.push("A");
      return a.promise.then(() => {
        throw err;
      });
    } });
    const pB = result.current.run({ task: async () => {
      started.push("B");
      return "b-value";
    } });

    await flushMicrotasks();
    expect(started).toEqual(["A"]);

    a.resolve();
    await expect(pA).rejects.toBe(err);
    await flushMicrotasks();
    expect(started).toEqual(["A", "B"]);
    await expect(pB).resolves.toBe("b-value");
  });
});

describe("useSerialWrites — failure isolation (synchronous throw)", () => {
  it("a task that throws before returning a promise rejects its own call and still releases the lane", async () => {
    const { result } = renderHook(() => useSerialWrites());
    const err = new Error("sync boom");
    const pA = result.current.run({ task: () => {
      throw err;
    } });
    await expect(pA).rejects.toBe(err);

    const pB = result.current.run({ task: async () => "after" });
    await expect(pB).resolves.toBe("after");
  });
});

describe("useSerialWrites — nothing is skipped", () => {
  it("runs all five queued tasks exactly once, in order, even when one of them rejects", async () => {
    const { result } = renderHook(() => useSerialWrites());
    const started: string[] = [];
    const err = new Error("boom");
    const labels = ["A", "B", "C", "D", "E"];

    const runs = labels.map((label) =>
      result.current
        .run({ task: async () => {
          started.push(label);
          if (label === "B") throw err;
          return label;
        } })
        .catch((e: unknown) => e),
    );

    const outcomes = await Promise.all(runs);
    expect(started).toEqual(["A", "B", "C", "D", "E"]);
    expect(outcomes).toEqual(["A", err, "C", "D", "E"]);
  });
});

describe("useSerialWrites — keys are independent lanes", () => {
  it("a pending keyed task holds up only later tasks on the SAME key", async () => {
    const { result } = renderHook(() => useSerialWrites());
    const started: string[] = [];
    const x1 = deferred<void>();

    const pX1 = result.current.run({ task: () => {
        started.push("x1");
        return x1.promise;
      } }, { key: "x" }
    );
    const pY1 = result.current.run({ task: async () => {
        started.push("y1");
        return "y1";
      } }, { key: "y" }
    );

    await flushMicrotasks();
    expect(started).toEqual(["x1", "y1"]);

    const pX2 = result.current.run({ task: async () => {
        started.push("x2");
        return "x2";
      } }, { key: "x" }
    );
    await flushMicrotasks();
    expect(started).toEqual(["x1", "y1"]);

    x1.resolve();
    await pX1;
    await flushMicrotasks();
    expect(started).toEqual(["x1", "y1", "x2"]);
    await expect(pX2).resolves.toBe("x2");
    await expect(pY1).resolves.toBe("y1");
  });
});

describe("useSerialWrites — the default lane is its own lane", () => {
  it("the default (unkeyed) lane and a keyed lane never wait on each other", async () => {
    const { result } = renderHook(() => useSerialWrites());
    const started: string[] = [];
    const keyedGate = deferred<void>();
    const unkeyedGate = deferred<void>();

    // A pending keyed task does not hold up an unkeyed one.
    const pKeyed1 = result.current.run({ task: () => {
        started.push("keyed1");
        return keyedGate.promise;
      } }, { key: "row-1" }
    );
    const pUnkeyed1 = result.current.run({ task: async () => {
      started.push("unkeyed1");
      return "u1";
    } });
    await flushMicrotasks();
    expect(started).toEqual(["keyed1", "unkeyed1"]);
    keyedGate.resolve();
    await pKeyed1;
    await pUnkeyed1;

    // A pending unkeyed task does not hold up a keyed one.
    const pUnkeyed2 = result.current.run({ task: () => {
      started.push("unkeyed2");
      return unkeyedGate.promise;
    } });
    const pKeyed2 = result.current.run({ task: async () => {
        started.push("keyed2");
        return "k2";
      } }, { key: "row-2" }
    );
    await flushMicrotasks();
    expect(started).toEqual(["keyed1", "unkeyed1", "unkeyed2", "keyed2"]);
    unkeyedGate.resolve();
    await pUnkeyed2;
    await pKeyed2;
  });
});

describe("useSerialWrites — re-entrancy", () => {
  it("a task that calls run again (without awaiting it) queues the inner call behind itself, with no deadlock", async () => {
    const { result } = renderHook(() => useSerialWrites());
    const started: string[] = [];
    let innerPromise!: Promise<string>;

    const outer = result.current.run({ task: async () => {
      started.push("outer");
      innerPromise = result.current.run({ task: async () => {
        started.push("inner");
        return "inner-value";
      } });
      return "outer-value";
    } });

    await expect(outer).resolves.toBe("outer-value");
    await expect(innerPromise).resolves.toBe("inner-value");
    expect(started).toEqual(["outer", "inner"]);
  });
});

describe("useSerialWrites — survives unmount", () => {
  it("a task queued before unmount still runs, and a call made after unmount still queues behind it", async () => {
    const { result, unmount } = renderHook(() => useSerialWrites());
    const writes = result.current;
    const started: string[] = [];
    const a = deferred<void>();

    const pA = writes.run({ task: () => {
      started.push("A");
      return a.promise;
    } });

    unmount();

    const pB = writes.run({ task: async () => {
      started.push("B");
      return "b";
    } });

    await flushMicrotasks();
    expect(started).toEqual(["A"]);

    a.resolve();
    await pA;
    await flushMicrotasks();
    expect(started).toEqual(["A", "B"]);
    await expect(pB).resolves.toBe("b");
  });
});

describe("useSerialWrites — composes with useSettlementGeneration", () => {
  it("mint-before-run makes only the newest call current when its task settles", async () => {
    const { result } = renderHook(() => ({
      writes: useSerialWrites(),
      settlement: useSettlementGeneration(),
    }));
    const seenByPort: string[] = [];
    const first = deferred<void>();
    const second = deferred<void>();

    const gen1 = result.current.settlement.next();
    const p1 = result.current.writes.run({ task: async () => {
      seenByPort.push("first");
      await first.promise;
      return result.current.settlement.isCurrent({ generation: gen1 });
    } });

    const gen2 = result.current.settlement.next();
    const p2 = result.current.writes.run({ task: async () => {
      seenByPort.push("second");
      await second.promise;
      return result.current.settlement.isCurrent({ generation: gen2 });
    } });

    first.resolve();
    const isFirstCurrent = await p1;
    second.resolve();
    const isSecondCurrent = await p2;

    expect(isFirstCurrent).toBe(false);
    expect(isSecondCurrent).toBe(true);
    expect(seenByPort).toEqual(["first", "second"]);
  });
});
