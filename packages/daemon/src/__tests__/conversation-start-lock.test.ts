// Characterization assertions copied and generalized from server/inbound/assistant/__tests__/conversation-start-lock.unit.test.ts
import assert from "node:assert/strict";
import { test, describe } from "vitest";

import { createConversationStartLock } from "./session-fixture.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createConversationStartLock", () => {
  test("runs two critical sections for one conversation strictly one after the other", async () => {
    const lock = createConversationStartLock();
    const order: string[] = [];

    const first = lock.run("conv-1", async () => {
      order.push("first:enter");
      await delay(20);
      order.push("first:exit");
      return "a";
    });

    const second = lock.run("conv-1", async () => {
      order.push("second:enter");
      order.push("second:exit");
      return "b";
    });

    assert.deepEqual(await Promise.all([first, second]), ["a", "b"]);
    assert.deepEqual(order, ["first:enter", "first:exit", "second:enter", "second:exit"]);
  });

  test("the second section observes the first section's write — the read-modify-write this exists for", async () => {
    const lock = createConversationStartLock();

    let stored: string | null = null;
    const bind = async (id: string): Promise<string> => {
      const current = await Promise.resolve(stored);
      if (current !== null) return current;
      await delay(10);
      stored = id;
      return id;
    };

    const [a, b] = await Promise.all([
      lock.run("conv-1", () => bind("session-A")),
      lock.run("conv-1", () => bind("session-B")),
    ]);

    assert.equal(a, "session-A");
    assert.equal(b, "session-A", "the second run minted its own session instead of adopting the first run's — the conversation has forked");
  });

  test("different conversations do not block each other", async () => {
    const lock = createConversationStartLock();
    const order: string[] = [];

    const slow = lock.run("conv-1", async () => {
      await delay(30);
      order.push("slow");
    });
    const fast = lock.run("conv-2", async () => {
      order.push("fast");
    });

    await Promise.all([slow, fast]);
    assert.deepEqual(order, ["fast", "slow"], "a run on one conversation was serialized behind an unrelated conversation's run");
  });

  test("a rejected section does not wedge the conversation for every later run", async () => {
    const lock = createConversationStartLock();

    await assert.rejects(
      lock.run("conv-1", async () => {
        throw new Error("binding failed");
      }),
      /binding failed/,
    );

    assert.equal(await lock.run("conv-1", async () => "recovered"), "recovered");
  });

  test("a rejection propagates to its own caller only, not to the next section in line", async () => {
    const lock = createConversationStartLock();
    const failing = lock.run("conv-1", async () => {
      await delay(5);
      throw new Error("binding failed");
    });
    const following = lock.run("conv-1", async () => "ok");

    await assert.rejects(failing, /binding failed/);
    assert.equal(await following, "ok");
  });

  test("an absent conversation id runs immediately and serializes nothing", async () => {

    const lock = createConversationStartLock();
    const order: string[] = [];

    const first = lock.run(undefined, async () => {
      await delay(20);
      order.push("first");
    });
    const second = lock.run(undefined, async () => {
      order.push("second");
    });

    await Promise.all([first, second]);
    assert.deepEqual(order, ["second", "first"], "runs with no conversation id were serialized against each other");
  });

  test("does not retain per-conversation state after its queue drains", async () => {
    const lock = createConversationStartLock();
    await lock.run("conv-1", async () => undefined);
    await lock.run("conv-2", async () => undefined);

    assert.equal(lock.trackedConversationCount({}), 0);
  });
});

function deferredVoid(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

test("a third section arriving after the first finishes still waits for the held second section", async () => {
  const lock = createConversationStartLock();
  const firstGate = deferredVoid();
  const secondGate = deferredVoid();
  const secondEntered = deferredVoid();
  const order: string[] = [];
  const first = lock.run("conv-1", async () => { await firstGate.promise; order.push("first:exit"); });
  const second = lock.run("conv-1", async () => {
    order.push("second:enter");
    secondEntered.resolve();
    await secondGate.promise;
    order.push("second:exit");
  });
  firstGate.resolve();
  await first;
  await secondEntered.promise;
  const third = lock.run("conv-1", async () => { order.push("third:enter"); });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["first:exit", "second:enter"]);
  } finally {
    secondGate.resolve();
    await Promise.all([second, third]);
  }
  assert.deepEqual(order, ["first:exit", "second:enter", "second:exit", "third:enter"]);
});
