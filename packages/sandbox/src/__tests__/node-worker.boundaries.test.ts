import { EventEmitter } from "node:events";
import type { Worker, WorkerOptions } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { createNodeWorkerFactory, renderInWorkerSandbox, resolveDefaultTimeoutMs, runInWorkerSandbox } from "../node-worker.js";
import type { WorkerHandle, WorkerSandboxRequired } from "../node-worker.js";

/** L9 §8.9: timeout grammar/boundaries, malformed render replies (one clause per case), and the
 *  native factory's isolation options (env copy, empty execArgv, error/terminate forwarding). */
function harness() {
  const emitter = new EventEmitter();
  const worker: WorkerHandle = { once: (input) => {
    if (input.event === "message") emitter.once("message", (message) => input.listener({ message }));
    else if (input.event === "error") emitter.once("error", (error) => input.listener({ error }));
    else emitter.once("exit", (code) => input.listener({ code }));
  }, terminate: async () => 0 };
  let timer: (() => void) | undefined;
  const required: WorkerSandboxRequired<{ value: number }> = {
    workerEntry: "/host/worker.js", input: { value: 1 }, errorLabel: "Ex", defaultTimeoutMs: 5000,
    defaultResourceLimits: {}, workerFactory: { spawn: () => worker },
    scheduler: { schedule: ({ run }) => { timer = run; return () => { timer = undefined; }; } },
  };
  return { required, emitter, fire: () => timer!() };
}

describe("resolveDefaultTimeoutMs", () => {
  const resolve = (rawValue: string | undefined) => resolveDefaultTimeoutMs({ rawValue, defaultTimeoutMs: 1000, maxTimeoutMs: 60000 });
  it.each([
    [undefined, 1000], ["", 1000], ["   ", 1000], ["12a", 1000], ["a12", 1000], ["5e3", 1000], ["60000ms", 1000], ["-5", 1000], ["1.5", 1000],
    ["0", 1000], ["60001", 1000], ["9007199254740993", 1000], ["1", 1], ["60000", 60000], [" 250 ", 250], ["250\n", 250], ["007", 7],
  ])("%j → %i", (raw, expected) => {
    expect(resolve(raw)).toBe(expected);
  });
});

describe("runInWorkerSandbox timeout validation", () => {
  it.each([0, -1, 1.5, Number.NaN, 2147483648])("rejects timeoutMs %s with RangeError before spawning", async (timeoutMs) => {
    const h = harness();
    const spawn = vi.spyOn(h.required.workerFactory, "spawn");
    await expect(runInWorkerSandbox({ ...h.required, decodeResult: () => 1 }, { timeoutMs })).rejects.toEqual(new RangeError("timeoutMs must be a positive integer within the Node timer range"));
    expect(spawn).not.toHaveBeenCalled();
  });
  it("accepts the Node timer maximum 2147483647 and labels a timeout", async () => {
    const h = harness();
    const run = runInWorkerSandbox({ ...h.required, decodeResult: () => 1 }, { timeoutMs: 2147483647 });
    h.fire();
    await expect(run).rejects.toThrow("Ex exceeded 2147483647ms timeout");
  });
});

describe("renderInWorkerSandbox reply protocol", () => {
  it.each([
    ["null", null], ["string", "<p>"], ["array", []], ["ok without html", { ok: true }], ["non-string html", { ok: true, html: 5 }],
    ["truthy non-true ok", { ok: "true", html: "x" }], ["html without ok", { html: "x" }], ["ok:false without error", { ok: false }],
    ["non-string error", { ok: false, error: { message: "x" } }], ["ok:0 with error", { ok: 0, error: "x" }],
  ])("refuses a %s reply as 'invalid worker render reply'", async (_label, message) => {
    const h = harness();
    const result = renderInWorkerSandbox(h.required);
    h.emitter.emit("message", message);
    await expect(result).rejects.toThrow(/^invalid worker render reply$/);
  });
  it("an empty html string is a valid reply and a string error is relayed verbatim", async () => {
    const ok = harness();
    const rendered = renderInWorkerSandbox(ok.required);
    ok.emitter.emit("message", { ok: true, html: "" });
    await expect(rendered).resolves.toBe("");
    const bad = harness();
    const failed = renderInWorkerSandbox(bad.required);
    bad.emitter.emit("message", { ok: false, error: "engine said no" });
    await expect(failed).rejects.toThrow(/^engine said no$/);
  });
  it("a worker error event rejects with that error and the render label on exit/timeout", async () => {
    const h = harness();
    const result = renderInWorkerSandbox(h.required);
    const error = new Error("worker crashed");
    h.emitter.emit("error", error);
    await expect(result).rejects.toBe(error);
    const t = harness();
    const timed = renderInWorkerSandbox(t.required, { timeoutMs: 10 });
    t.fire();
    await expect(timed).rejects.toThrow("Ex render exceeded 10ms timeout");
  });
});

describe("createNodeWorkerFactory", () => {
  function fakeWorker() {
    const emitter = new EventEmitter() as EventEmitter & { stdout: { resume: () => void }; stderr: { resume: () => void }; terminate: () => Promise<number> };
    emitter.stdout = { resume: vi.fn() };
    emitter.stderr = { resume: vi.fn() };
    emitter.terminate = vi.fn(async () => 3);
    return emitter;
  }
  it("passes isolated options: env COPY, empty execArgv, no stdin, drained piped output", async () => {
    const worker = fakeWorker();
    const createWorker = vi.fn((_input: { entry: string | URL; options: WorkerOptions }) => worker as unknown as Worker);
    const env = { KEEP: "1", NODE_V8_COVERAGE: "/cov" };
    const handle = createNodeWorkerFactory({ env }, { createWorker }).spawn({ workerEntry: "/w.js", payload: { p: 1 }, resourceLimits: { maxOldGenerationSizeMb: 32 } });
    const { entry, options } = createWorker.mock.calls[0]![0];
    expect(entry).toBe("/w.js");
    expect(options).toEqual({ workerData: { p: 1 }, resourceLimits: { maxOldGenerationSizeMb: 32 }, env: { KEEP: "1", NODE_V8_COVERAGE: "/cov" }, execArgv: [], stdin: false, stdout: true, stderr: true });
    expect(options.env).not.toBe(env);
    expect(worker.stdout.resume).toHaveBeenCalledOnce();
    expect(worker.stderr.resume).toHaveBeenCalledOnce();
    const onError = vi.fn(); const onExit = vi.fn(); const onMessage = vi.fn();
    handle.once({ event: "error", listener: onError });
    handle.once({ event: "exit", listener: onExit });
    handle.once({ event: "message", listener: onMessage });
    const failure = new Error("boom");
    worker.emit("error", failure); worker.emit("exit", 2); worker.emit("message", "m");
    expect(onError).toHaveBeenCalledWith({ error: failure });
    expect(onExit).toHaveBeenCalledWith({ code: 2 });
    expect(onMessage).toHaveBeenCalledWith({ message: "m" });
    await expect(handle.terminate()).resolves.toBe(3);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("TypeScript bootstrap: requires an absolute string entry, strips NODE_V8_COVERAGE only from the worker env", () => {
    const createWorker = vi.fn((_input: { entry: string | URL; options: WorkerOptions }) => fakeWorker() as unknown as Worker);
    const env = { NODE_V8_COVERAGE: "/cov", KEEP: "1" };
    const factory = createNodeWorkerFactory({ env }, { createWorker, typescriptBootstrap: { registerModulePath: "/tsx/cjs/api" } });
    for (const workerEntry of ["relative/w.ts", new URL("file:///abs/w.ts")]) {
      expect(() => factory.spawn({ workerEntry, payload: null, resourceLimits: {} })).toThrow(new TypeError("TypeScript bootstrap requires an absolute filesystem entry path"));
    }
    factory.spawn({ workerEntry: "/abs/w.ts", payload: null, resourceLimits: {} });
    const { entry, options } = createWorker.mock.calls[0]![0];
    expect(entry).toBe('require("/tsx/cjs/api").register();\nrequire("/abs/w.ts");\n');
    expect(options.eval).toBe(true);
    expect(options.env).toEqual({ KEEP: "1" });
    expect(env).toEqual({ NODE_V8_COVERAGE: "/cov", KEEP: "1" });
  });
});
