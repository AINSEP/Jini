import assert from "node:assert/strict";
import { test } from "vitest";

import { runBootLifecycle } from "../boot-lifecycle.js";
import type { BootModule } from "../boot-lifecycle.js";

/**
 * @file unit tests for the boot/readiness lifecycle orchestrator, including the two
 * fault-injection cases Phase 2's round-2 partial-boot-rollback correction requires.
 * See docs/decisions/DR-001-partial-boot-rollback.md.
 */

function fakeModule(overrides: Partial<BootModule> & { name: string }): BootModule & { calls: string[] } {
  const calls: string[] = [];
  const module: BootModule & { calls: string[] } = {
    owner: "test",
    criticality: "critical",
    prepare: async () => {
      calls.push("prepare");
    },
    start: async () => {
      calls.push("start");
    },
    stop: async () => {
      calls.push("stop");
    },
    calls,
    ...overrides,
  };
  return module;
}

test("runs prepare for every module, then start for every module, in array order", async () => {
  const order: string[] = [];
  const a = fakeModule({
    name: "a",
    prepare: async () => {
      order.push("a.prepare");
    },
    start: async () => {
      order.push("a.start");
    },
  });
  const b = fakeModule({
    name: "b",
    prepare: async () => {
      order.push("b.prepare");
    },
    start: async () => {
      order.push("b.start");
    },
  });

  const result = await runBootLifecycle({ modules: [a, b] });

  assert.deepEqual(order, ["a.prepare", "b.prepare", "a.start", "b.start"]);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.modules.map((m) => m.lifecycle.status),
    ["ready", "ready"]
  );
});

test("start() is never called for a module whose prepare() failed", async () => {
  const failing = fakeModule({
    name: "failing",
    criticality: "optional",
    prepare: async () => {
      throw new Error("boom");
    },
  });
  const other = fakeModule({ name: "other" });

  const result = await runBootLifecycle({ modules: [failing, other] });

  assert.equal(failing.calls.includes("start"), false);
  assert.deepEqual(other.calls, ["prepare", "start"]);
  assert.equal(result.ok, true); // failing is optional, doesn't flip overall ok
  assert.equal(result.modules.find((m) => m.name === "failing")?.lifecycle.status, "failed");
});

test("fault-injection (a): a later critical module's start() fails after earlier modules fully completed — their stop() runs in reverse order, the failing module's stop() does not run", async () => {
  const stopOrder: string[] = [];
  const one = fakeModule({
    name: "one",
    stop: async () => {
      stopOrder.push("one");
    },
  });
  const two = fakeModule({
    name: "two",
    stop: async () => {
      stopOrder.push("two");
    },
  });
  const three = fakeModule({
    name: "three",
    start: async () => {
      throw new Error("start failed");
    },
    stop: async () => {
      stopOrder.push("three");
    },
  });

  const result = await runBootLifecycle({ modules: [one, two, three] });

  assert.equal(result.ok, false);
  assert.deepEqual(stopOrder, ["two", "one"]); // reverse order, three excluded
  assert.equal(result.modules.find((m) => m.name === "three")?.lifecycle.status, "failed");
});

test("fault-injection (b): a critical module's own prepare() fails partway through — it self-cleans up, and the orchestrator's stop() is never called on it", async () => {
  let selfCleanedUp = false;
  let orchestratorCalledStopOnFailingModule = false;

  const failing = fakeModule({
    name: "failing",
    prepare: async () => {
      // Acquire a fake resource, then fail — the module's OWN responsibility is to release
      // whatever it acquired before rethrowing (not the orchestrator's).
      try {
        throw new Error("prepare failed partway through");
      } catch (err) {
        selfCleanedUp = true;
        throw err;
      }
    },
    stop: async () => {
      orchestratorCalledStopOnFailingModule = true;
    },
  });
  const earlier = fakeModule({ name: "earlier" });

  const result = await runBootLifecycle({ modules: [earlier, failing] });

  assert.equal(result.ok, false);
  assert.equal(selfCleanedUp, true);
  assert.equal(orchestratorCalledStopOnFailingModule, false);
  assert.deepEqual(earlier.calls, ["prepare", "stop"]); // earlier's prepare-acquired resources still get released
});

test("an optional module's start() failure is recorded failed and does not block a later critical module", async () => {
  const optionalFails = fakeModule({
    name: "optional-fails",
    criticality: "optional",
    start: async () => {
      throw new Error("optional start failed");
    },
  });
  const laterCritical = fakeModule({ name: "later-critical" });

  const result = await runBootLifecycle({ modules: [optionalFails, laterCritical] });

  assert.equal(result.ok, true);
  assert.equal(result.modules.find((m) => m.name === "optional-fails")?.lifecycle.status, "failed");
  assert.equal(result.modules.find((m) => m.name === "later-critical")?.lifecycle.status, "ready");
});

test("a critical module's prepare() failure rolls back an earlier module that only completed prepare (never started)", async () => {
  const earlierPreparedOnly = fakeModule({ name: "earlier-prepared-only" });
  const failing = fakeModule({
    name: "failing",
    prepare: async () => {
      throw new Error("boom");
    },
  });

  const result = await runBootLifecycle({ modules: [earlierPreparedOnly, failing] });

  assert.equal(result.ok, false);
  assert.deepEqual(earlierPreparedOnly.calls, ["prepare", "stop"]);
  assert.equal(failing.calls.includes("stop"), false);
});

test("rollback waits for each asynchronous resource release before starting the next stop or returning", async () => {
  const order: string[] = [];
  let releaseOne!: () => void;
  let releaseTwo!: () => void;
  const oneHeld = new Promise<void>((resolve) => { releaseOne = resolve; });
  const twoHeld = new Promise<void>((resolve) => { releaseTwo = resolve; });
  let twoStarted!: () => void;
  const twoStarting = new Promise<void>((resolve) => { twoStarted = resolve; });
  const one = fakeModule({ name: "one", stop: async () => { order.push("one.start"); await oneHeld; order.push("one.released"); } });
  const two = fakeModule({ name: "two", stop: async () => { order.push("two.start"); twoStarted(); await twoHeld; order.push("two.released"); } });
  const failing = fakeModule({ name: "failing", start: async () => { throw new Error("critical start failed"); } });
  let settled = false;
  const boot = runBootLifecycle({ modules: [one, two, failing] }).then((result) => { settled = true; return result; });
  try {
    await twoStarting;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "boot cannot settle while two still owns its resource");
    assert.deepEqual(order, ["two.start"]);
    releaseTwo();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "boot cannot settle while one still owns its resource");
    assert.deepEqual(order, ["two.start", "two.released", "one.start"]);
    releaseOne();
    const result = await boot;
    assert.equal(result.ok, false);
    assert.deepEqual(order, ["two.start", "two.released", "one.start", "one.released"]);
    assert.equal(failing.calls.includes("stop"), false);
  } finally {
    releaseTwo();
    releaseOne();
    await boot;
  }
});

test("rollback continues after a stop rejects and preserves the original critical prepare failure", async () => {
  const order: string[] = [];
  const earlier = fakeModule({ name: "earlier", stop: async () => { order.push("earlier.released"); } });
  const later = fakeModule({ name: "later", stop: async () => { order.push("later.stop"); throw new Error("cleanup failed"); } });
  const failing = fakeModule({ name: "failing", prepare: async () => { throw new Error("original critical failure"); } });
  const result = await runBootLifecycle({ modules: [earlier, later, failing] });
  assert.deepEqual(order, ["later.stop", "earlier.released"]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.modules.map(({ name, lifecycle }) => ({ name, lifecycle })), [{
    name: "failing", lifecycle: { status: "failed", reasonCode: "original critical failure", remediationHint: "check the boot log for the underlying error and retry after fixing it" },
  }]);
  assert.deepEqual(failing.calls, []);
});
