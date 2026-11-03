import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "vitest";
import { createWorkerCapacity, renderInWorkerSandbox, WorkerCapacityError, type WorkerSandboxRequired } from "../node-worker.js";

function renderHarness() {
  const workers: { events: EventEmitter; terminated: number; finishTermination: () => void; failTermination: () => void }[] = [];
  const timers: (() => void)[] = [];
  const required: WorkerSandboxRequired<{ source: string }> = {
    workerEntry: "/theme/worker.js", input: { source: "hello" }, errorLabel: "Theme",
    defaultTimeoutMs: 5000, defaultResourceLimits: { maxOldGenerationSizeMb: 64 },
    capacity: createWorkerCapacity({ maxConcurrent: 2 }),
    workerFactory: { spawn: () => {
      const events = new EventEmitter();
      let resolveTermination!: () => void;
      let rejectTermination!: () => void;
      const termination = new Promise<number>((resolve, reject) => {
        resolveTermination = () => resolve(0);
        rejectTermination = () => reject(new Error("cannot terminate"));
      });
      const record = { events, terminated: 0, finishTermination: resolveTermination, failTermination: rejectTermination };
      workers.push(record);
      return {
        once: (subscription) => {
          if (subscription.event === "message") events.once("message", (message) => subscription.listener({ message }));
          else if (subscription.event === "error") events.once("error", (error) => subscription.listener({ error }));
          else events.once("exit", (code) => subscription.listener({ code }));
        },
        terminate: () => { record.terminated++; return termination; },
      };
    } },
    scheduler: { schedule: ({ run }) => { timers.push(run); return () => {}; } },
  };
  return { required, workers, timers };
}

test("visitors cannot spawn more than two theme workers while earlier renders are still terminating", async () => {
  const h = renderHarness();
  const first = renderInWorkerSandbox(h.required);
  const second = renderInWorkerSandbox({ ...h.required, workerEntry: "/theme/other-engine.js" });
  await assert.rejects(renderInWorkerSandbox(h.required), WorkerCapacityError);
  assert.equal(h.workers.length, 2);
  h.workers[0]!.events.emit("message", { ok: true, html: "first" });
  assert.equal(await first, "first");
  assert.equal(h.workers[0]!.terminated, 1, "a successful render is terminated immediately");
  await assert.rejects(renderInWorkerSandbox(h.required), WorkerCapacityError);
  h.workers[0]!.finishTermination();
  await Promise.resolve();
  const third = renderInWorkerSandbox(h.required);
  assert.equal(h.workers.length, 3);
  h.workers[0]!.events.emit("exit", 0); // Late exit cannot release the same slot twice.
  await assert.rejects(renderInWorkerSandbox(h.required), WorkerCapacityError);
  h.workers[1]!.events.emit("message", { ok: true, html: "second" });
  h.workers[2]!.events.emit("message", { ok: true, html: "third" });
  assert.deepEqual(await Promise.all([second, third]), ["second", "third"]);
  h.workers[1]!.finishTermination(); h.workers[2]!.finishTermination();
});

test("a timed out theme keeps its slot until worker termination completes", async () => {
  const h = renderHarness();
  const first = renderInWorkerSandbox(h.required);
  const second = renderInWorkerSandbox(h.required);
  h.timers[0]!();
  await assert.rejects(first, /exceeded 5000ms timeout/);
  assert.equal(h.workers[0]!.terminated, 1);
  await assert.rejects(renderInWorkerSandbox(h.required), WorkerCapacityError);
  h.workers[0]!.finishTermination();
  await Promise.resolve();
  const third = renderInWorkerSandbox(h.required);
  h.workers[1]!.events.emit("message", { ok: true, html: "second" });
  h.workers[2]!.events.emit("message", { ok: true, html: "third" });
  await Promise.all([second, third]);
  h.workers[1]!.finishTermination(); h.workers[2]!.finishTermination();
});

test("a worker that cannot terminate holds capacity until its exit event", async () => {
  const h = renderHarness();
  const first = renderInWorkerSandbox(h.required);
  const second = renderInWorkerSandbox(h.required);
  h.workers[0]!.events.emit("error", new Error("worker failed"));
  await assert.rejects(first, /worker failed/);
  h.workers[0]!.failTermination();
  await Promise.resolve();
  await assert.rejects(renderInWorkerSandbox(h.required), WorkerCapacityError);
  h.workers[0]!.events.emit("exit", 1);
  const third = renderInWorkerSandbox(h.required);
  h.workers[1]!.events.emit("message", { ok: true, html: "second" });
  h.workers[2]!.events.emit("message", { ok: true, html: "third" });
  await Promise.all([second, third]);
  h.workers[1]!.finishTermination(); h.workers[2]!.finishTermination();
});

test("a theme worker spawn failure does not consume render capacity", async () => {
  const h = renderHarness();
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(renderInWorkerSandbox({ ...h.required, workerFactory: {
      spawn: () => { throw new Error("spawn failed"); },
    } }), /spawn failed/);
  }
  const result = renderInWorkerSandbox(h.required);
  h.workers[0]!.events.emit("message", { ok: true, html: "recovered" });
  assert.equal(await result, "recovered");
  h.workers[0]!.finishTermination();
});

test("worker capacity rejects invalid bounds and releases each lease only once", () => {
  for (const maxConcurrent of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => createWorkerCapacity({ maxConcurrent }), RangeError);
  }
  const capacity = createWorkerCapacity({ maxConcurrent: 1 });
  const release = capacity.acquire({});
  assert.throws(() => capacity.acquire({}), WorkerCapacityError);
  release(); release();
  capacity.acquire({});
  assert.throws(() => capacity.acquire({}), WorkerCapacityError);
});
