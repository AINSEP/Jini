import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "vitest";
import { renderInWorkerSandbox, resolveDefaultTimeoutMs, runInWorkerSandbox } from "../node-worker.js";
import type { WorkerSandboxRequired, WorkerHandle } from "../node-worker.js";

function harness() {
  const emitter = new EventEmitter();
  let terminated = 0;
  let timer: (() => void) | undefined;
  let budget = 0;
  const worker: WorkerHandle = { once: (input) => {
    if (input.event === "message") emitter.once("message", (message) => input.listener({ message }));
    else if (input.event === "error") emitter.once("error", (error) => input.listener({ error }));
    else emitter.once("exit", (code) => input.listener({ code }));
  }, terminate: async () => ++terminated };
  const required: WorkerSandboxRequired<{ value: number }> = {
    workerEntry: "/host/worker.js", input: { value: 7 }, errorLabel: "Example", defaultTimeoutMs: 5000,
    defaultResourceLimits: { maxOldGenerationSizeMb: 64 }, workerFactory: { spawn: () => worker },
    scheduler: { schedule: ({ run, delayMs }) => { timer = run; budget = delayMs; return () => { timer = undefined; }; } },
  };
  return { required, emitter, timeout: () => timer!(), terminated: () => terminated, budget: () => budget, hasTimer: () => timer !== undefined };
}

// Original exit-code characterization, generalized to caller-owned worker entries and payloads.
test("exit without a reply rejects with the exact caller-labelled exit-code message", async () => {
  for (const errorLabel of ["Example", "Alternate"]) {
    const h = harness();
    const result = renderInWorkerSandbox({ ...h.required, errorLabel });
    h.emitter.emit("exit", 7);
    await assert.rejects(result, { message: `${errorLabel} render worker exited with code 7` });
    assert.equal(h.hasTimer(), false);
  }
});

test("success and engine rejection preserve the reply protocol and terminate the worker", async () => {
  const h = harness(); const result = renderInWorkerSandbox(h.required);
  h.emitter.emit("message", { ok: true, html: "rendered" });
  assert.equal(await result, "rendered"); assert.equal(h.terminated(), 1);
  const bad = harness(); const rejected = renderInWorkerSandbox(bad.required);
  bad.emitter.emit("message", { ok: false, error: "invalid template" });
  await assert.rejects(rejected, { message: "invalid template" }); assert.equal(bad.terminated(), 1);
});

test("timeout terminates work and late messages cannot change its rejection", async () => {
  const h = harness(); const result = renderInWorkerSandbox(h.required, { timeoutMs: 25 });
  assert.equal(h.budget(), 25); h.timeout();
  h.emitter.emit("message", { ok: true, html: "too late" });
  await assert.rejects(result, { message: "Example render exceeded 25ms timeout" });
  assert.equal(h.terminated(), 1);
});

test("worker errors, malformed messages and decoder exceptions reject with cleanup", async () => {
  const h = harness(); const result = renderInWorkerSandbox(h.required);
  h.emitter.emit("error", new Error("out of memory"));
  await assert.rejects(result, { message: "out of memory" }); assert.equal(h.hasTimer(), false);
  const malformed = harness(); const bad = renderInWorkerSandbox(malformed.required);
  malformed.emitter.emit("message", { ok: true, html: 7 });
  await assert.rejects(bad, { message: "invalid worker render reply" }); assert.equal(malformed.terminated(), 1);
});

test("a payload codec can return a non-render result without changing the harness", async () => {
  const h = harness();
  const result = runInWorkerSandbox({ ...h.required, decodeResult: ({ message }) => Number(message) * 2 });
  h.emitter.emit("message", 21);
  assert.equal(await result, 42);
});

test("timeout resolver strictly accepts bounded digits and uses the supplied fallback", () => {
  for (const rawValue of [undefined, "", "5e3", "1e10", "60000ms", "abc", "0", "-1", "999999999", "300001", "9007199254740992"]) {
    assert.equal(resolveDefaultTimeoutMs({ rawValue, defaultTimeoutMs: 5000, maxTimeoutMs: 300000 }), 5000);
  }
  assert.equal(resolveDefaultTimeoutMs({ rawValue: " 60000 ", defaultTimeoutMs: 5000, maxTimeoutMs: 300000 }), 60000);
  assert.equal(resolveDefaultTimeoutMs({ rawValue: "300000", defaultTimeoutMs: 5000, maxTimeoutMs: 300000 }), 300000);
});

test("worker factory receives the caller's entry, generic payload and override limits", async () => {
  const h = harness();
  let received: unknown;
  const result = renderInWorkerSandbox({ ...h.required, workerFactory: {
    spawn: (input) => { received = input; return h.required.workerFactory.spawn(input); },
  } }, { resourceLimits: { maxOldGenerationSizeMb: 8 } });
  h.emitter.emit("message", { ok: true, html: "rendered" });
  assert.equal(await result, "rendered");
  assert.deepEqual(received, { workerEntry: "/host/worker.js", payload: { value: 7 }, resourceLimits: { maxOldGenerationSizeMb: 8 } });
});

test("spawn and schedule failures reject instead of leaving a worker running", async () => {
  const h = harness();
  await assert.rejects(renderInWorkerSandbox({ ...h.required, workerFactory: { spawn: () => { throw new Error("cannot clone payload"); } } }), { message: "cannot clone payload" });
  await assert.rejects(renderInWorkerSandbox({ ...h.required, scheduler: { schedule: () => { throw new Error("scheduler unavailable"); } } }), { message: "scheduler unavailable" });
  assert.equal(h.terminated(), 1);
});

test("invalid timer budgets reject before spawning a worker", async () => {
  const h = harness();
  for (const timeoutMs of [0, -1, NaN, Infinity, 2147483648]) {
    await assert.rejects(renderInWorkerSandbox(h.required, { timeoutMs }), RangeError);
  }
  assert.equal(h.hasTimer(), false); assert.equal(h.terminated(), 0);
});

test("a failing event subscription rejects and terminates the spawned worker", async () => {
  const h = harness(); let terminated = 0;
  await assert.rejects(renderInWorkerSandbox({ ...h.required, workerFactory: { spawn: () => ({
    once: () => { throw new Error("event registration unavailable"); },
    terminate: async () => ++terminated,
  }) } }), { message: "event registration unavailable" });
  assert.equal(terminated, 1); assert.equal(h.hasTimer(), false);
});
