
import { test } from "vitest";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { routeQuitSignals, QUIT_SIGNALS } from "../shutdown/index.js";


function harness() {
  const processLike = new EventEmitter();
  const calls = { quit: 0, forceExit: 0, unref: 0 };
  const timers: { fn: () => void; ms: number }[] = [];
  const setTimer = ({ fn, ms }: { fn: () => void; ms: number }) => {
    timers.push({ fn, ms });
    return { unref: () => (calls.unref += 1) };
  };
  routeQuitSignals(
    {
      processLike: { on: ({ signal, listener }) => processLike.on(signal, listener) },
      quit: () => (calls.quit += 1),
      forceExit: () => (calls.forceExit += 1),
      deadlineMs: 15_000,
    },
    { setTimer },
  );
  return { processLike, calls, timers };
}

test("covers the same three signals Chromium's own one-shot shutdown handler takes", () => {
  assert.deepEqual(QUIT_SIGNALS, ["SIGINT", "SIGTERM", "SIGHUP"]);
});

test("nothing is requested or armed before a signal arrives", () => {
  const { processLike, calls, timers } = harness();
  assert.equal(calls.quit, 0);
  assert.equal(timers.length, 0);
  for (const signal of QUIT_SIGNALS) assert.equal(processLike.listenerCount(signal), 1, `expected one ${signal} listener`);
});

for (const signal of QUIT_SIGNALS) {
  test(`${signal} starts the graceful quit`, () => {
    const { processLike, calls } = harness();
    processLike.emit(signal);
    assert.equal(calls.quit, 1);
    assert.equal(calls.forceExit, 0, "the first copy must go through before-quit's drain, never a hard exit");
  });
}

test("repeated copies of a termination signal are absorbed: the graceful quit is requested once", () => {



  const { processLike, calls, timers } = harness();
  processLike.emit("SIGTERM");
  processLike.emit("SIGTERM");
  processLike.emit("SIGINT");
  processLike.emit("SIGHUP");
  assert.equal(calls.quit, 1);
  assert.equal(timers.length, 1, "one deadline for the whole shutdown, not one per copy");
  assert.equal(calls.forceExit, 0);
});

test("a drain that outlives the deadline is force-exited, so a stop never hangs forever", () => {
  const { processLike, calls, timers } = harness();
  processLike.emit("SIGTERM");
  assert.equal(timers[0]!.ms, 15_000);
  assert.equal(calls.forceExit, 0, "the deadline must not fire early");
  timers[0]!.fn();
  assert.equal(calls.forceExit, 1);
});

test("the deadline timer does not by itself keep the process alive", () => {
  const { processLike, calls } = harness();
  processLike.emit("SIGTERM");
  assert.equal(calls.unref, 1);
});
