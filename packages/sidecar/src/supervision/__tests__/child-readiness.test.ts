import { afterEach, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { waitForChildReady } from "../supervisor-node.js";
import type { ChildReadinessFailure, ReadinessChild } from "../supervisor-node.js";

class Child extends EventEmitter implements ReadinessChild {
  pid: number | undefined = 42;
  stdout: PassThrough | null = new PassThrough();
  stderr: PassThrough | null = new PassThrough();
}
function fixture() {
  const child = new Child();
  const sinks = { stdout: { write: vi.fn(), end: vi.fn() }, stderr: { write: vi.fn(), end: vi.fn() } };
  const parseReady = vi.fn(({ text }: { text: string }) => text.includes("READY\n") ? { port: 4000 } : null);
  const onReady = vi.fn();
  const describeFailure = vi.fn(({ type }: ChildReadinessFailure) => `readiness:${type}`);
  const start = () => waitForChildReady({ child, readyTimeoutMs: 100, parseReady, onReady, createOutputSink: ({ stream }) => sinks[stream], describeFailure });
  return { child, sinks, parseReady, onReady, describeFailure, start };
}
afterEach(() => { vi.useRealTimers(); });

test.each(["stdout", "stderr"] as const)("readiness accumulates split output from %s and supplies raw text", async stream => {
  const f = fixture(); const work = f.start();
  f.child[stream]!.write("token=secret\nREA"); f.child[stream]!.write("DY\n");
  expect(await work).toEqual({ ready: { port: 4000 }, pid: 42 });
  expect(f.onReady).toHaveBeenCalledTimes(1);
  expect(f.onReady).toHaveBeenCalledWith({ ready: { port: 4000 }, pid: 42, text: "token=secret\nREADY\n" });
});

test("both streams keep draining through their sinks after readiness, and end flushes them", async () => {
  const f = fixture(); const work = f.start(); f.child.stdout!.write("READY\n"); const ready = await work;
  f.child.stdout!.write("later stdout\n"); f.child.stderr!.write("later stderr\n");
  const ended = Promise.all([new Promise<void>(resolve => f.child.stdout!.once("end", resolve)), new Promise<void>(resolve => f.child.stderr!.once("end", resolve))]);
  f.child.stdout!.end(); f.child.stderr!.end(); await ended;
  expect(f.sinks.stdout.write.mock.calls).toEqual([["READY\n"], ["later stdout\n"]]);
  expect(f.sinks.stderr.write.mock.calls).toEqual([["later stderr\n"]]);
  expect(f.sinks.stdout.end).toHaveBeenCalledTimes(1); expect(f.sinks.stderr.end).toHaveBeenCalledTimes(1);
  expect(await work).toBe(ready); expect(f.onReady).toHaveBeenCalledTimes(1); expect(f.parseReady).toHaveBeenCalledTimes(1);
});

test("timeout uses accumulated output once; later readiness cannot call the ready callback", async () => {
  vi.useFakeTimers(); const f = fixture(); const work = f.start(); const check = expect(work).rejects.toThrow("readiness:timeout");
  f.child.stderr!.write("startup diagnostics");
  await vi.advanceTimersByTimeAsync(99); expect(f.describeFailure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await check;
  expect(f.describeFailure).toHaveBeenCalledWith({ type: "timeout", text: "startup diagnostics", readyTimeoutMs: 100 });
  f.child.stdout!.write("READY\n"); f.child.emit("exit", 1, null);
  expect(f.onReady).not.toHaveBeenCalled(); expect(f.describeFailure).toHaveBeenCalledTimes(1);
});

test.each([[4, null], [null, "SIGKILL"], [null, null]] as const)("early exit retains code %s, signal %s and all raw diagnostics", async (code, signal) => {
  const f = fixture(); const work = f.start(); const check = expect(work).rejects.toThrow("readiness:exit");
  const text = "startup\n".repeat(300) + "CLI_FAILURE at the end\n"; f.child.stderr!.write(text);
  f.child.emit("exit", code, signal); await check;
  expect(f.describeFailure).toHaveBeenCalledWith({ type: "exit", code, signal, text });
  f.child.stdout!.write("READY\n"); expect(f.onReady).not.toHaveBeenCalled(); expect(f.describeFailure).toHaveBeenCalledTimes(1);
});

test("runaway raw startup output fails above one million characters", async () => {
  const f = fixture(); const work = f.start(); const check = expect(work).rejects.toThrow("readiness:output-limit");
  f.child.stdout!.write("x".repeat(600_000)); f.child.stderr!.write("y".repeat(600_000)); await check;
  expect(f.describeFailure).toHaveBeenCalledWith({ type: "output-limit", text: "x".repeat(600_000), maxOutputChars: 1_000_000 });
  expect(f.onReady).not.toHaveBeenCalled();
});

test("exactly one million raw characters are allowed", async () => {
  const f = fixture(); const work = f.start(); f.child.stdout!.write("x".repeat(999_994) + "READY\n");
  expect(await work).toEqual({ ready: { port: 4000 }, pid: 42 });
});

test("missing pid and missing streams use host diagnostics", async () => {
  const pid = fixture(); pid.child.pid = undefined; const first = pid.start();
  pid.child.stdout!.write("READY\n"); await expect(first).rejects.toThrow("readiness:missing-pid");
  expect(pid.describeFailure).toHaveBeenCalledWith({ type: "missing-pid", text: "READY\n" });
  for (const stream of ["stdout", "stderr"] as const) {
    const f = fixture(); f.child[stream] = null;
    await expect(f.start()).rejects.toThrow("readiness:missing-stream");
    expect(f.describeFailure).toHaveBeenCalledWith({ type: "missing-stream", text: "" });
  }
});

test("native spawn errors retain their original identity and cause", async () => {
  const f = fixture(); const error = Object.assign(new Error("spawn EACCES", { cause: new Error("native") }), { code: "EACCES" });
  const work = f.start(); f.child.emit("error", error);
  await expect(work).rejects.toBe(error); expect(f.describeFailure).not.toHaveBeenCalled();
});

test("late error and exit cannot replace readiness or arm a second callback", async () => {
  vi.useFakeTimers(); const f = fixture(); const work = f.start(); f.child.stdout!.write("READY\n"); const result = await work;
  f.child.emit("error", new Error("late")); f.child.emit("exit", 7, null); f.child.stderr!.write("READY\n");
  await vi.advanceTimersByTimeAsync(200);
  expect(await work).toBe(result); expect(f.onReady).toHaveBeenCalledTimes(1); expect(f.describeFailure).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("preserves diagnostics and a UTF-8 readiness value split across native byte chunks", async () => {
  const f = fixture();
  const work = f.start();
  const prefix = Buffer.from("workspace=東京 READY\n");
  const split = Buffer.byteLength("workspace=") + 1;
  f.child.stderr!.write("config loaded\n");
  f.child.stdout!.write(prefix.subarray(0, split));
  expect(f.onReady.mock.calls).toEqual([]);
  f.child.stdout!.write(prefix.subarray(split));
  await expect(work).resolves.toEqual({ ready: { port: 4000 }, pid: 42 });
  expect(f.onReady.mock.calls).toEqual([[{
    ready: { port: 4000 }, pid: 42, text: "config loaded\nworkspace=東京 READY\n",
  }]]);
});
