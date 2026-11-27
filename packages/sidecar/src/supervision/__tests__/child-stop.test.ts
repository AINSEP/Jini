import { afterEach, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { stopSpawnedChild } from "../supervisor-node.js";
import type { ChildStopFailure, StoppableChild } from "../supervisor-node.js";

class Child extends EventEmitter implements StoppableChild {
  pid: number | undefined = 42;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  stdin: PassThrough | null = null;
  kill = vi.fn((_signal?: NodeJS.Signals | number) => true);
}
function fixture(platform: NodeJS.Platform = "linux") {
  const child = new Child(); const killTree = vi.fn((_input: { pid: number }) => {});
  const forceGroup = vi.fn((_input: { pid: number }) => {});
  const describeFailure = vi.fn((failure: ChildStopFailure) => `stop:${failure.type}`);
  const start = () => stopSpawnedChild({ child, graceMs: 100, killTree, describeFailure }, { platform, forceGroup });
  return { child, killTree, forceGroup, describeFailure, start };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

test("POSIX asks for graceful drain and waits for exit, cancelling escalation", async () => {
  vi.useFakeTimers(); const f = fixture(); let done = false; const work = f.start().then(() => { done = true; });
  expect(f.child.kill.mock.calls).toEqual([["SIGTERM"]]);
  await vi.advanceTimersByTimeAsync(90); expect(done).toBe(false);
  f.child.emit("exit", 0, null); await work;
  await vi.advanceTimersByTimeAsync(200); expect(done).toBe(true); expect(f.forceGroup).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

test("Windows without stdin kills the tree first, even if direct kill would exit immediately", async () => {
  const f = fixture("win32"); const order: string[] = [];
  f.child.kill.mockImplementation(() => { order.push("direct"); f.child.emit("exit", 0, null); return true; });
  f.killTree.mockImplementation(() => { order.push("tree"); f.child.emit("exit", 0, null); });
  await f.start(); expect(order).toEqual(["tree"]); expect(f.forceGroup).not.toHaveBeenCalled();
});

test("Windows tree failure falls back to the direct child", async () => {
  const f = fixture("win32"); f.killTree.mockImplementation(() => { throw new Error("missing native command"); });
  f.child.kill.mockImplementation(() => { f.child.emit("exit", null, "SIGTERM"); return true; });
  await f.start(); expect(f.killTree).toHaveBeenCalledWith({ pid: 42 }); expect(f.child.kill.mock.calls).toEqual([["SIGTERM"]]);
});

test("Windows closes stdin, tolerates an EPIPE race and never tree-kills a graceful exit", async () => {
  vi.useFakeTimers(); const f = fixture("win32"); f.child.stdin = new PassThrough(); const work = f.start();
  expect(f.child.stdin.writableEnded).toBe(true);
  expect(() => f.child.stdin!.emit("error", Object.assign(new Error("EPIPE"), { code: "EPIPE" }))).not.toThrow();
  expect(f.killTree).not.toHaveBeenCalled(); expect(f.child.kill).not.toHaveBeenCalled();
  f.child.emit("exit", 0, null); await work; await vi.advanceTimersByTimeAsync(200); expect(f.killTree).not.toHaveBeenCalled();
});

test("Windows escalates after EOF grace and waits for observed exit", async () => {
  vi.useFakeTimers(); const f = fixture("win32"); f.child.stdin = new PassThrough(); let done = false;
  const work = f.start().then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(100); expect(f.killTree).toHaveBeenCalledWith({ pid: 42 }); expect(done).toBe(false);
  f.child.emit("exit", null, "SIGKILL"); await work; expect(done).toBe(true);
});

test("POSIX force requests the group and stays pending until delayed exit", async () => {
  vi.useFakeTimers(); const f = fixture(); let done = false; const work = f.start().then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(100); expect(f.forceGroup).toHaveBeenCalledWith({ pid: 42 }); expect(f.killTree).not.toHaveBeenCalled(); expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(90); expect(done).toBe(false);
  f.child.emit("exit", null, "SIGKILL"); await work;
  await vi.advanceTimersByTimeAsync(100); expect(f.forceGroup).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});

test("forced exit has its own deadline and releases its listener on timeout", async () => {
  vi.useFakeTimers(); const f = fixture(); const before = f.child.listenerCount("exit"); const work = f.start();
  const check = expect(work).rejects.toThrow("stop:timeout");
  await vi.advanceTimersByTimeAsync(100); expect(f.describeFailure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(99); expect(f.describeFailure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await check;
  expect(f.describeFailure).toHaveBeenCalledWith({ type: "timeout", pid: 42, graceMs: 100 });
  expect(f.child.listenerCount("exit")).toBe(before);
});

test("a failed polite request still escalates; timeout preserves the last signal error as cause", async () => {
  vi.useFakeTimers(); const f = fixture(); const politeError = new Error("polite refused"); const forcedError = new Error("force refused");
  f.child.kill.mockImplementation(() => { throw politeError; }); f.forceGroup.mockImplementation(() => { throw forcedError; });
  const work = f.start(); const check = expect(work).rejects.toMatchObject({ message: "stop:timeout", cause: forcedError });
  await vi.advanceTimersByTimeAsync(100); expect(f.forceGroup).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(100); await check;
});

test.each(["exitCode", "signalCode"] as const)("already-exited children (%s) receive no stop request", async field => {
  const f = fixture(); if (field === "exitCode") f.child.exitCode = 0; else f.child.signalCode = "SIGTERM";
  await f.start(); expect(f.child.kill).not.toHaveBeenCalled(); expect(f.forceGroup).not.toHaveBeenCalled();
});

test("default POSIX escalation uses the negative pid group", async () => {
  vi.useFakeTimers(); const f = fixture(); const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  const work = stopSpawnedChild({ child: f.child, graceMs: 100, killTree: f.killTree, describeFailure: f.describeFailure }, { platform: "linux" });
  await vi.advanceTimersByTimeAsync(100); expect(kill).toHaveBeenCalledWith(-42, "SIGKILL");
  f.child.emit("exit", null, "SIGKILL"); await work;
});

test.each([
  { platform: "win32", phase: "windows-tree" },
  { platform: "linux", phase: "force" },
] as const)("missing pid prevents a $phase signal and is retained as the timeout cause", async ({ platform, phase }) => {
  vi.useFakeTimers();
  const f = fixture(platform);
  f.child.pid = undefined;
  const work = f.start();
  const failure = expect(work).rejects.toMatchObject({ message: "stop:timeout", cause: { message: "stop:missing-pid" } });
  await vi.advanceTimersByTimeAsync(100);
  expect(f.describeFailure.mock.calls).toEqual([[{ type: "missing-pid", phase }]]);
  expect(f.killTree.mock.calls).toEqual([]);
  expect(f.forceGroup.mock.calls).toEqual([]);
  expect(f.child.kill.mock.calls).toEqual(platform === "win32" ? [] : [["SIGTERM"]]);
  await vi.advanceTimersByTimeAsync(100);
  await failure;
  expect(f.describeFailure.mock.calls).toEqual([
    [{ type: "missing-pid", phase }], [{ type: "timeout", pid: undefined, graceMs: 100 }],
  ]);
  expect(f.child.listenerCount("exit")).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("a Windows child without stdin gets exactly one tree stop even if exit never arrives", async () => {
  vi.useFakeTimers();
  const f = fixture("win32");
  const work = f.start();
  const failure = expect(work).rejects.toThrow("stop:timeout");
  expect(f.killTree.mock.calls).toEqual([[{ pid: 42 }]]);
  await vi.advanceTimersByTimeAsync(200);
  await failure;
  expect(f.killTree.mock.calls).toEqual([[{ pid: 42 }]]);
  expect(f.child.kill.mock.calls).toEqual([]);
  expect(f.child.listenerCount("exit")).toBe(0);
});
