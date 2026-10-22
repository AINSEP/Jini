// Characterization assertions copied and generalized from server/inbound/assistant/__tests__/agent-run-concurrency.unit.test.ts
import assert from "node:assert/strict";
import { test, describe } from "vitest";

import { CONCURRENT_RUN_REFUSAL_MESSAGE, createLiveRunTracker, failRunBeforeStart, waitForStoppingRuns } from "./session-fixture.js";

describe("createLiveRunTracker", () => {
  test("run-to-conversation lookup isolates live registrations and removes only the unregistered run", () => {
    const tracker = createLiveRunTracker();
    assert.equal(tracker.conversationIdForRun("run-a"), undefined);
    tracker.register("conv-1", "run-a");
    tracker.register("conv-2", "run-b");
    assert.equal(tracker.conversationIdForRun("run-a"), "conv-1");
    assert.equal(tracker.conversationIdForRun("run-b"), "conv-2");
    tracker.unregister("conv-2", "run-a");
    assert.equal(tracker.conversationIdForRun("run-a"), "conv-1");
    tracker.unregister("conv-1", "run-a");
    assert.equal(tracker.conversationIdForRun("run-a"), undefined);
    assert.equal(tracker.conversationIdForRun("run-b"), "conv-2");
    tracker.unregister("conv-2", "run-b");
    assert.equal(tracker.conversationIdForRun("run-b"), undefined);
  });

  test("hasConcurrentLiveRun is false for a conversation with no registered runs at all", () => {
    const tracker = createLiveRunTracker();
    assert.equal(tracker.hasConcurrentLiveRun("conv-1", "run-a"), false);
  });

  test("hasConcurrentLiveRun is false for the only run registered for a conversation (checking against itself)", () => {
    const tracker = createLiveRunTracker();
    tracker.register("conv-1", "run-a");
    assert.equal(tracker.hasConcurrentLiveRun("conv-1", "run-a"), false);
  });

  test("H2: hasConcurrentLiveRun is true for each of two runs registered concurrently on the same conversation", () => {
    const tracker = createLiveRunTracker();
    tracker.register("conv-1", "run-a");
    tracker.register("conv-1", "run-b");

    assert.equal(tracker.hasConcurrentLiveRun("conv-1", "run-a"), true, "run-a should see run-b as a concurrent live run");
    assert.equal(tracker.hasConcurrentLiveRun("conv-1", "run-b"), true, "run-b should see run-a as a concurrent live run");
  });

  test("unregistering the other run clears the concurrency signal for the one still live", () => {
    const tracker = createLiveRunTracker();
    tracker.register("conv-1", "run-a");
    tracker.register("conv-1", "run-b");

    tracker.unregister("conv-1", "run-b");

    assert.equal(tracker.hasConcurrentLiveRun("conv-1", "run-a"), false, "with run-b gone, run-a is alone again");
  });

  test("unregister is a silent no-op for a runId that was never registered", () => {
    const tracker = createLiveRunTracker();
    assert.doesNotThrow(() => tracker.unregister("conv-1", "run-never-registered"));
  });

  test("two different conversationIds never see each other's live runs", () => {
    const tracker = createLiveRunTracker();
    tracker.register("conv-1", "run-a");
    tracker.register("conv-2", "run-b");

    assert.equal(tracker.hasConcurrentLiveRun("conv-1", "run-a"), false);
    assert.equal(tracker.hasConcurrentLiveRun("conv-2", "run-b"), false);
  });

  test("a fresh tracker instance starts with no memory of a prior instance's registrations (matches an in-process map's empty state after a daemon restart)", () => {
    const trackerBeforeRestart = createLiveRunTracker();
    trackerBeforeRestart.register("conv-1", "run-a");

    const trackerAfterRestart = createLiveRunTracker();
    assert.equal(trackerAfterRestart.hasConcurrentLiveRun("conv-1", "run-a"), false);
  });
});

describe("waitForStoppingRuns", () => {
  function fakeLifecycle() {
    const cancelled = new Set<string>();
    const ends = new Map<string, () => void>();
    const ended = new Map<string, Promise<void>>();
    return {
      cancel(runId: string) {
        cancelled.add(runId);
      },
      end(runId: string) {
        ends.get(runId)?.();
      },
      onCancelRequested({ runId, listener }: { runId: string; listener: () => void }) {
        if (cancelled.has(runId)) listener();
        return () => undefined;
      },
      waitForTerminal({ runId }: { runId: string }) {
        let promise = ended.get(runId);
        if (!promise) {
          promise = new Promise<void>((resolve) => ends.set(runId, resolve));
          ended.set(runId, promise);
        }
        return promise;
      },
    };
  }

  test("waits for a run the user stopped to end, then no longer counts it as live", async () => {
    const tracker = createLiveRunTracker();
    const lifecycle = fakeLifecycle();
    tracker.register("conv-1", "old");
    tracker.register("conv-1", "new");
    lifecycle.cancel("old");

    let settled = false;
    const waiting = waitForStoppingRuns({ tracker, lifecycle, conversationId: "conv-1", runId: "new", timeoutMs: 5_000 }).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "must wait while the stopped run is still exiting");

    lifecycle.end("old");
    await waiting;
    assert.equal(tracker.hasConcurrentLiveRun("conv-1", "new"), false);
  });

  test("does not wait for a live run nobody stopped", async () => {
    const tracker = createLiveRunTracker();
    const lifecycle = fakeLifecycle();
    tracker.register("conv-1", "other-tab");
    tracker.register("conv-1", "new");

    await waitForStoppingRuns({ tracker, lifecycle, conversationId: "conv-1", runId: "new", timeoutMs: 60_000 });
    assert.equal(tracker.hasConcurrentLiveRun("conv-1", "new"), true);
  });

  test("gives up after the timeout when the stopped run never ends", async () => {
    const tracker = createLiveRunTracker();
    const lifecycle = fakeLifecycle();
    tracker.register("conv-1", "old");
    tracker.register("conv-1", "new");
    lifecycle.cancel("old");

    await waitForStoppingRuns({ tracker, lifecycle, conversationId: "conv-1", runId: "new", timeoutMs: 20 });
    assert.equal(tracker.hasConcurrentLiveRun("conv-1", "new"), true);
  });
});

describe("failRunBeforeStart", () => {
  test("puts the plain reason on the run's stream before finishing it failed", async () => {
    const calls: unknown[] = [];
    const lifecycle = {
      async emit({ runId, input }: Parameters<import("../session-coordination.js").FailingRunLifecycle["emit"]>[0]) {
        calls.push(["emit", runId, input]);
      },
      async finish(input: unknown) {
        calls.push(["finish", input]);
      },
    };

    await failRunBeforeStart(lifecycle, "run-1", CONCURRENT_RUN_REFUSAL_MESSAGE);

    assert.deepEqual(calls, [
      ["emit", "run-1", { event: "error", data: { message: "The assistant could not start: another answer in this chat is still running. Wait for it to finish, or stop it, then send again." } }],
      ["finish", { runId: "run-1", status: "failed", code: null, signal: null, resumable: false }],
    ]);
  });

  test("still finishes the run when the stream refuses the event", async () => {
    const finished: unknown[] = [];
    const lifecycle = {
      async emit() {
        throw new Error("run already terminal");
      },
      async finish(input: unknown) {
        finished.push(input);
      },
    };

    await failRunBeforeStart(lifecycle, "run-1", "why");
    assert.deepEqual(finished, [{ runId: "run-1", status: "failed", code: null, signal: null, resumable: false }]);
  });
});
