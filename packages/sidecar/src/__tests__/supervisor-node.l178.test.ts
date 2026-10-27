import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { expect, test, vi } from "vitest";
import { createNodeDaemonProcessAdapter, type NodeDaemonProcessOptions, type SupervisorRegistry } from "../supervisor-node.js";
import type { SpawnedDaemonProcess } from "../supervisor.js";

function harness(_required: Record<string, never>, { platform = "win32" }: { platform?: NodeJS.Platform } = {}) {
  const order: string[] = [];
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const native = Object.assign(new ChildProcess(), { pid: 42, stdin, stdout, stderr,
    kill: vi.fn<ChildProcess["kill"]>(() => { order.push("child-kill"); return true; }) });
  const snapshots = vi.fn<NonNullable<NodeDaemonProcessOptions["listProcessSnapshots"]>>(async () => {
    order.push("snapshot"); return [{ pid: 43, ppid: 42, command: "worker" }];
  });
  const wait = vi.fn<NonNullable<NodeDaemonProcessOptions["waitForProcessExit"]>>(async () => {
    order.push("wait"); return true;
  });
  const force = vi.fn<NonNullable<NodeDaemonProcessOptions["execFileSync"]>>(() => { order.push("force"); });
  const signal = vi.fn<NonNullable<NodeDaemonProcessOptions["signalProcess"]>>(() => { order.push("signal"); return true; });
  const stop = vi.fn<NonNullable<NodeDaemonProcessOptions["stopProcesses"]>>(async () => {
    order.push("stop");
    return { alreadyStopped: false, forcedPids: [], matchedPids: [43, 42], remainingPids: [], stoppedPids: [43, 42] };
  });
  const remove = vi.fn<SupervisorRegistry["removeIfCurrent"]>(async () => { order.push("remove"); });
  const registry: SupervisorRegistry = { readLive: async () => null, write: async () => {}, removeIfCurrent: remove };
  const required = { command: process.execPath, args: ["daemon.js"], cwd: "/host", env: {}, registry };
  const options: NodeDaemonProcessOptions = { platform, spawn: () => native, listProcessSnapshots: snapshots,
    waitForProcessExit: wait, execFileSync: force, signalProcess: signal, stopProcesses: stop };
  const adapter = createNodeDaemonProcessAdapter(required, options);
  return { adapter, required, options, native, stdin, stdout, stderr, snapshots, wait, force, signal, stop, remove, order };
}

test("relays both child output streams to supplied sinks", () => {
  const h = harness({});
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  createNodeDaemonProcessAdapter(h.required, { ...h.options, stdout, stderr }).spawnDaemonProcess();
  h.stdout.write("output");
  h.stderr.write("diagnostic");
  expect(stdout.read()?.toString()).toBe("output");
  expect(stderr.read()?.toString()).toBe("diagnostic");
});

test("C56: keeps shared output sinks open across child spawns", async () => {
  const first = harness({}, { platform: "linux" });
  const second = harness({}, { platform: "linux" });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const spawn = vi.fn().mockReturnValueOnce(first.native).mockReturnValueOnce(second.native);
  const adapter = createNodeDaemonProcessAdapter(first.required, { ...first.options, spawn, stdout, stderr });
  try {
    adapter.spawnDaemonProcess();
    const ended = Promise.all([first.stdout, first.stderr].map((stream) =>
      new Promise<void>((resolve) => { stream.once("end", resolve); })));
    first.stdout.end("first output\n");
    first.stderr.end("first diagnostic\n");
    await ended;

    expect(stdout.writableEnded).toBe(false);
    expect(stderr.writableEnded).toBe(false);
    adapter.spawnDaemonProcess();
    second.stdout.write("second output\n");
    second.stderr.write("second diagnostic\n");
    expect(stdout.read()?.toString()).toBe("first output\nsecond output\n");
    expect(stderr.read()?.toString()).toBe("first diagnostic\nsecond diagnostic\n");
  } finally {
    for (const stream of [first.stdin, first.stdout, first.stderr, second.stdin, second.stdout, second.stderr, stdout, stderr]) {
      stream.destroy();
    }
  }
});

test("drains both child output streams when no sinks are supplied", () => {
  const h = harness({});
  const stdoutResume = vi.spyOn(h.stdout, "resume");
  const stderrResume = vi.spyOn(h.stderr, "resume");
  h.adapter.spawnDaemonProcess();
  expect(stdoutResume).toHaveBeenCalledOnce();
  expect(stderrResume).toHaveBeenCalledOnce();
});

test.each([true, false])("tolerates missing output streams with sinks=%s", (sinks) => {
  const h = harness({});
  const native = Object.assign(new ChildProcess(), { pid: 42, stdout: null, stderr: null });
  const options = { ...h.options, spawn: () => native };
  const adapter = createNodeDaemonProcessAdapter(h.required,
    sinks ? { ...options, stdout: new PassThrough(), stderr: new PassThrough() } : options);
  expect(adapter.spawnDaemonProcess().pid).toBe(42);
});

test("termination without a pid performs no snapshot, stop or registry effects", async () => {
  const h = harness({});
  const child: SpawnedDaemonProcess = { on: vi.fn(), kill: vi.fn(() => true) };
  await h.adapter.terminateProcess({ child });
  expect(h.order).toEqual([]);
  expect(child.kill).not.toHaveBeenCalled();
});

test("Windows requests snapshots and closes stdin before awaiting graceful exit", async () => {
  const h = harness({});
  let release!: (exited: boolean) => void;
  h.wait.mockImplementation(() => {
    h.order.push("wait");
    return new Promise<boolean>((resolve) => { release = resolve; });
  });
  const pending = h.adapter.terminateProcess({ child: h.adapter.spawnDaemonProcess() });
  expect(h.stdin.writableEnded).toBe(true);
  expect(h.order).toEqual(["snapshot", "wait"]);
  expect(h.wait).toHaveBeenCalledTimes(1);
  expect(h.wait).toHaveBeenCalledWith(42);
  release(true);
  await pending;
  expect(h.order).toEqual(["snapshot", "wait", "stop", "remove"]);
  expect(h.stop).toHaveBeenCalledTimes(1);
  expect(h.stop).toHaveBeenCalledWith([43, 42]);
  expect(h.remove).toHaveBeenCalledTimes(1);
  expect(h.remove).toHaveBeenCalledWith({ pid: 42 });
});

test.each(["missing stdin", "close failure", "wait failure", "timeout"])("Windows escalates %s to taskkill", async (failure) => {
  const h = harness({});
  const child: SpawnedDaemonProcess = { pid: 42, on: vi.fn(), kill: vi.fn(() => true) };
  if (failure !== "missing stdin") child.closeStdin = vi.fn(() => {});
  if (failure === "close failure") child.closeStdin = () => { throw new Error("broken pipe"); };
  if (failure === "wait failure") h.wait.mockRejectedValue(new Error("wait failed"));
  if (failure === "timeout") h.wait.mockResolvedValue(false);
  await h.adapter.terminateProcess({ child });
  expect(h.force).toHaveBeenCalledTimes(1);
  expect(h.force).toHaveBeenCalledWith("taskkill", ["/pid", "42", "/T", "/F"], { stdio: "ignore" });
  expect(child.kill).not.toHaveBeenCalled();
  expect(h.stop).toHaveBeenCalledTimes(1);
  expect(h.stop).toHaveBeenCalledWith([43, 42]);
  expect(h.remove).toHaveBeenCalledTimes(1);
  expect(h.remove).toHaveBeenCalledWith({ pid: 42 });
});

test("taskkill failure falls back to child SIGTERM before descendant cleanup", async () => {
  const h = harness({});
  h.wait.mockResolvedValue(false);
  h.force.mockImplementation(() => { throw new Error("no taskkill"); });
  await h.adapter.terminateProcess({ child: h.adapter.spawnDaemonProcess() });
  expect(h.native.kill).toHaveBeenCalledTimes(1);
  expect(h.native.kill).toHaveBeenCalledWith("SIGTERM");
  expect(h.order).toEqual(["snapshot", "child-kill", "stop", "remove"]);
});

test("POSIX group-signal failure falls back to child SIGTERM", async () => {
  const h = harness({}, { platform: "linux" });
  h.signal.mockImplementation(() => { h.order.push("signal"); throw new Error("no process group"); });
  await h.adapter.terminateProcess({ child: h.adapter.spawnDaemonProcess() });
  expect(h.signal).toHaveBeenCalledTimes(1);
  expect(h.signal).toHaveBeenCalledWith(-42, "SIGTERM");
  expect(h.native.kill).toHaveBeenCalledTimes(1);
  expect(h.native.kill).toHaveBeenCalledWith("SIGTERM");
  expect(h.order).toEqual(["snapshot", "signal", "child-kill", "stop", "remove"]);
});

test("surviving processes reject cleanup and retain registry ownership", async () => {
  const h = harness({});
  h.stop.mockResolvedValue({ alreadyStopped: false, forcedPids: [43, 42], matchedPids: [43, 42], remainingPids: [43, 42], stoppedPids: [] });
  await expect(h.adapter.terminateProcess({ child: h.adapter.spawnDaemonProcess() }))
    .rejects.toThrow("daemon processes still running: 43, 42");
  expect(h.remove).not.toHaveBeenCalled();
});
