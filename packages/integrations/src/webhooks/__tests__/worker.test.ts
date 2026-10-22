import assert from "node:assert/strict";
import { test, vi } from "vitest";

import {
  describeWebhookTickError,
  nodeWebhookDeliveryScheduler,
  startWebhookDeliveryWorker,
  WEBHOOK_DELIVERY_FAILED_LINE,
  WEBHOOK_DELIVERY_INTERVAL_MS,
  WEBHOOK_DELIVERY_STOP_GRACE_MS,
  WEBHOOK_DELIVERY_STOP_LATE_LINE,
  WebhookDeliveryWorkerStoppedError,
  type WebhookDeliveryScheduler,
} from "../worker.js";

/**
 * @file The generic webhook delivery loop on a fake scheduler: when it ticks, that ticks never
 * overlap, that `stop` cancels the running pass through its signal and bounds its wait, and that a
 * failed tick is logged without secrets while the loop keeps going.
 */

/** Manual scheduler: records each timer and lets the test fire it. */
function fakeScheduler() {
  const intervals: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const timeouts: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const scheduler: WebhookDeliveryScheduler = {
    every: ({ ms, run }) => {
      const timer = { ms, run, cancelled: false };
      intervals.push(timer);
      return { cancel: () => { timer.cancelled = true; } };
    },
    after: ({ ms, run }) => {
      const timer = { ms, run, cancelled: false };
      timeouts.push(timer);
      return { cancel: () => { timer.cancelled = true; } };
    },
  };
  const fire = () => { for (const timer of intervals) if (!timer.cancelled) timer.run(); };
  return { scheduler, intervals, timeouts, fire };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("starts one interval at the default 15 s and ticks only when it fires", async () => {
  const clock = fakeScheduler();
  let calls = 0;
  startWebhookDeliveryWorker({ processDue: async () => { calls += 1; } }, { scheduler: clock.scheduler, log: () => {} });
  assert.equal(WEBHOOK_DELIVERY_INTERVAL_MS, 15_000);
  assert.deepEqual(clock.intervals.map((timer) => timer.ms), [15_000]);
  await flush();
  assert.equal(calls, 0);
  clock.fire();
  await flush();
  assert.equal(calls, 1);
});

test("refuses an interval or stop grace that is not a positive finite number", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => startWebhookDeliveryWorker({ processDue: async () => {} }, { intervalMs: bad, scheduler: fakeScheduler().scheduler }), /intervalMs/);
    assert.throws(() => startWebhookDeliveryWorker({ processDue: async () => {} }, { stopGraceMs: bad, scheduler: fakeScheduler().scheduler }), /stopGraceMs/);
  }
});

test("a tick never overlaps a tick that is still running", async () => {
  const clock = fakeScheduler();
  const pending = deferred();
  let calls = 0;
  const worker = startWebhookDeliveryWorker(
    { processDue: () => { calls += 1; return calls === 1 ? pending.promise : Promise.resolve(); } },
    { scheduler: clock.scheduler, log: () => {} },
  );
  clock.fire();
  const first = worker.tick();
  assert.equal(worker.tick(), first);
  await flush();
  assert.equal(calls, 1);
  pending.resolve();
  await first;
  await worker.tick();
  assert.equal(calls, 2);
});

test("a failed tick is logged scrubbed and the loop continues; the default log is console.error", async () => {
  const lines: string[] = [];
  let calls = 0;
  const failure = Object.assign(new Error("POST https://user:hunter2@hooks.example.com/in refused"), { name: "RepoError", code: "ECONNRESET" });
  const worker = startWebhookDeliveryWorker(
    { processDue: async () => { calls += 1; if (calls === 1) throw failure; } },
    { scheduler: fakeScheduler().scheduler, log: (line) => lines.push(line) },
  );
  await worker.tick();
  await worker.tick();
  assert.deepEqual(lines, [`${WEBHOOK_DELIVERY_FAILED_LINE}: RepoError: POST [url] refused (code ECONNRESET)`]);
  assert.equal(calls, 2);

  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await startWebhookDeliveryWorker({ processDue: async () => { throw new Error("db closed"); } }, { scheduler: fakeScheduler().scheduler }).tick();
    assert.deepEqual(errors.mock.calls, [[`${WEBHOOK_DELIVERY_FAILED_LINE}: Error: db closed`]]);
  } finally { errors.mockRestore(); }
});

test("describeWebhookTickError never stringifies a non-Error, keeps numeric codes, drops other codes and caps the message", () => {
  assert.equal(describeWebhookTickError({ error: { secret: "x" } }), `${WEBHOOK_DELIVERY_FAILED_LINE}: a non-Error value was thrown`);
  assert.equal(describeWebhookTickError({ error: Object.assign(new Error("busy"), { code: 5 }) }), `${WEBHOOK_DELIVERY_FAILED_LINE}: Error: busy (code 5)`);
  assert.equal(describeWebhookTickError({ error: Object.assign(new Error("odd"), { code: { secret: "x" } }) }), `${WEBHOOK_DELIVERY_FAILED_LINE}: Error: odd`);
  assert.equal(describeWebhookTickError({ error: new Error("a".repeat(500)) }), `${WEBHOOK_DELIVERY_FAILED_LINE}: Error: ${"a".repeat(200)}`);
});

test("each pass receives the worker's signal; stop aborts it with a stopped reason, then no tick runs", async () => {
  const clock = fakeScheduler();
  const signals: AbortSignal[] = [];
  const worker = startWebhookDeliveryWorker({ processDue: async ({ signal }) => { signals.push(signal); } }, { scheduler: clock.scheduler });
  await worker.tick();
  assert.equal(signals[0]!.aborted, false);

  await worker.stop();
  await worker.stop();
  assert.equal(signals[0]!.aborted, true);
  assert.ok(signals[0]!.reason instanceof WebhookDeliveryWorkerStoppedError);
  assert.equal((signals[0]!.reason as Error).message, "webhook delivery worker stopped");
  assert.equal(clock.intervals[0]!.cancelled, true);
  assert.equal(clock.timeouts.length, 0, "nothing was running, so no grace timer");
  clock.intervals[0]!.run();
  await worker.tick();
  assert.equal(signals.length, 1);
});

test("stop cancels a running pass, which settles inside the grace (default 1 s)", async () => {
  const clock = fakeScheduler();
  const lines: string[] = [];
  const worker = startWebhookDeliveryWorker({
    processDue: ({ signal }) => new Promise<void>((resolve) => { signal.addEventListener("abort", () => resolve(), { once: true }); }),
  }, { scheduler: clock.scheduler, log: (line) => lines.push(line) });
  clock.fire();
  await worker.stop();
  assert.deepEqual(clock.timeouts.map((timer) => [timer.ms, timer.cancelled]), [[WEBHOOK_DELIVERY_STOP_GRACE_MS, true]]);
  assert.deepEqual(lines, []);
});

test("stop abandons a pass that ignores its signal past an injected grace", async () => {
  const clock = fakeScheduler();
  const lines: string[] = [];
  const worker = startWebhookDeliveryWorker({ processDue: () => new Promise(() => {}) }, { scheduler: clock.scheduler, stopGraceMs: 250, log: (line) => lines.push(line) });
  clock.fire();
  const stopping = worker.stop();
  await flush();
  assert.equal(clock.timeouts[0]!.ms, 250);
  clock.timeouts[0]!.run();
  await stopping;
  assert.deepEqual(lines, [WEBHOOK_DELIVERY_STOP_LATE_LINE]);
});

test("the node scheduler fires its interval and timeout and cancels them", async () => {
  let ticks = 0;
  const interval = nodeWebhookDeliveryScheduler.every({ ms: 1, run: () => { ticks += 1; } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  interval.cancel();
  const seen = ticks;
  assert.ok(seen >= 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(ticks, seen);

  let fired = 0;
  nodeWebhookDeliveryScheduler.after({ ms: 1, run: () => { fired += 1; } });
  nodeWebhookDeliveryScheduler.after({ ms: 1, run: () => { fired += 10; } }).cancel();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fired, 1);
});
