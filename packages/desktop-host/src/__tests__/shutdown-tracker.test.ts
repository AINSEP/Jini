
import { test } from "vitest";
import assert from "node:assert/strict";

import { createShutdownTracker } from "../shutdown/index.js";


function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("an empty tracker reports nothing pending and drains immediately", async () => {
  const tracker = createShutdownTracker({});
  assert.equal(tracker.size, 0);
  await tracker.drain();
});

test("a tracked teardown is reported pending until it settles", async () => {
  const tracker = createShutdownTracker({});
  const teardown = deferred();
  tracker.track({ promise: teardown.promise });
  assert.equal(tracker.size, 1, "before-quit must be able to see that a teardown is still running");

  teardown.resolve();
  await tracker.drain();
  assert.equal(tracker.size, 0);
});

test("drain does not resolve while a teardown is still running", async () => {


  const tracker = createShutdownTracker({});
  const teardown = deferred();
  tracker.track({ promise: teardown.promise });

  let drained = false;
  const draining = tracker.drain().then(() => {
    drained = true;
  });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false, "drain resolved while the teardown had not finished");

  teardown.resolve();
  await draining;
  assert.equal(drained, true);
});

test("a REJECTED teardown is still waited for, and still lets the drain finish", async () => {


  const tracker = createShutdownTracker({});
  const teardown = deferred();
  tracker.track({ promise: teardown.promise });

  let drained = false;
  const draining = tracker.drain().then(() => {
    drained = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);

  teardown.reject(new Error("logout refused"));
  await draining;
  assert.equal(drained, true);
  assert.equal(tracker.size, 0);
});

test("a teardown registered WHILE draining is waited for too", async () => {


  const tracker = createShutdownTracker({});
  const first = deferred();
  const second = deferred();
  tracker.track({ promise: first.promise });

  let drained = false;
  const draining = tracker.drain().then(() => {
    drained = true;
  });

  tracker.track({ promise: second.promise });
  first.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false, "the late teardown was not waited for");

  second.resolve();
  await draining;
  assert.equal(drained, true);
});

test("track returns a promise a caller can await without it rejecting", async () => {
  const tracker = createShutdownTracker({});
  await tracker.track({ promise: Promise.reject(new Error("stop failed")) });
  assert.equal(tracker.size, 0);
});
