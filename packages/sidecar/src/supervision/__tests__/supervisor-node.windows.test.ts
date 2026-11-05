import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { PassThrough } from "node:stream";
import { expect, test, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createNodeDaemonProcessAdapter, createNodeSupervisorScheduler, type NodeDaemonProcessOptions, type SupervisorRegistry } from "../supervisor-node.js";

// Exercise the real adapter with native effect ports, including win32 on a POSIX test host.
function harness({ platform = "win32", pipe = true }: { platform?: NodeJS.Platform; pipe?: boolean } = {}) {
  const order: string[] = [];
  const stdin = new PassThrough();
  const native = Object.assign(new EventEmitter(), {
    pid: 42, stdin: pipe ? stdin : null,
    kill: vi.fn(() => { order.push("child-kill"); return true; }),
  }) as unknown as ChildProcess;
  const spawn = vi.fn<NonNullable<NodeDaemonProcessOptions["spawn"]>>(() => native);
  const snapshots = vi.fn<NonNullable<NodeDaemonProcessOptions["listProcessSnapshots"]>>(async () => [
    { pid: 43, ppid: 42, command: "worker" },
  ]);
  const wait = vi.fn<NonNullable<NodeDaemonProcessOptions["waitForProcessExit"]>>(async () => true);
  const force = vi.fn<NonNullable<NodeDaemonProcessOptions["execFileSync"]>>(() => {
    order.push("tree-kill"); return Buffer.alloc(0);
  });
  const signal = vi.fn<NonNullable<NodeDaemonProcessOptions["signalProcess"]>>(() => true);
  const stop = vi.fn<NonNullable<NodeDaemonProcessOptions["stopProcesses"]>>(async () => {
    order.push("descendants");
    return { alreadyStopped: false, forcedPids: [], matchedPids: [43, 42], remainingPids: [], stoppedPids: [43, 42] };
  });
  const remove = vi.fn<SupervisorRegistry["removeIfCurrent"]>(async () => { order.push("registry"); });
  const registry: SupervisorRegistry = { readLive: async () => null, write: async () => {}, removeIfCurrent: remove };
  const env = { HOST_ENV: "1" };
  const required = { command: process.execPath, args: ["daemon.js"], cwd: "/host", env, registry };
  const options = { platform, spawn, listProcessSnapshots: snapshots, waitForProcessExit: wait,
    execFileSync: force, signalProcess: signal, stopProcesses: stop };
  const adapter = createNodeDaemonProcessAdapter(required, options);
  return { adapter, required, options, native, stdin, spawn, snapshots, wait, force, signal, stop, remove, env, order };
}

test("win32 launch opts into EOF shutdown with a pipe without mutating the host environment", () => {
  const h = harness();
  const child = h.adapter.spawnDaemonProcess();
  const launch: SpawnOptions = h.spawn.mock.calls[0]![0].options;
  expect(launch).toEqual({
    cwd: "/host", env: { HOST_ENV: "1", JINI_STOP_ON_STDIN_EOF: "1" },
    detached: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  expect(h.env).toEqual({ HOST_ENV: "1" });
  expect(typeof child.closeStdin).toBe("function");
});

test("win32 closes stdin synchronously, waits for graceful exit, then cleans descendants and registry", async () => {
  const h = harness();
  let release!: (exited: boolean) => void;
  h.wait.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const child = h.adapter.spawnDaemonProcess();
  // Production uses a fresh cleanup adapter: the pipe must travel with the process port.
  const cleanup = createNodeDaemonProcessAdapter(h.required, h.options);
  const pending = cleanup.terminateProcess({ child });
  expect(h.stdin.writableEnded).toBe(true);
  expect(h.wait).toHaveBeenCalledWith(42); // platform's default 5000ms grace
  expect(h.force).not.toHaveBeenCalled();
  expect(h.stop).not.toHaveBeenCalled();
  expect(h.remove).not.toHaveBeenCalled();
  release(true);
  await pending;
  expect(h.force).not.toHaveBeenCalled();
  expect(h.signal).not.toHaveBeenCalled();
  expect(h.native.kill).not.toHaveBeenCalled();
  expect(h.stop).toHaveBeenCalledWith([43, 42]);
  expect(h.remove).toHaveBeenCalledWith({ pid: 42 });
  expect(h.order).toEqual(["descendants", "registry"]);
});

test("win32 force-kills the whole tree only after the graceful exit wait expires", async () => {
  const h = harness();
  let release!: (exited: boolean) => void;
  h.wait.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const pending = h.adapter.terminateProcess({ child: h.adapter.spawnDaemonProcess() });
  expect(h.force).not.toHaveBeenCalled();
  release(false);
  await pending;
  expect(h.force).toHaveBeenCalledWith("taskkill", ["/pid", "42", "/T", "/F"], { stdio: "ignore" });
  expect(h.signal).not.toHaveBeenCalled();
  expect(h.order).toEqual(["tree-kill", "descendants", "registry"]);
});

test("win32 tolerates EPIPE when the daemon exits before its stdin pipe closes", async () => {
  const h = harness();
  const pending = h.adapter.terminateProcess({ child: h.adapter.spawnDaemonProcess() });
  h.stdin.emit("error", Object.assign(new Error("pipe closed"), { code: "EPIPE" }));
  await pending;
  expect(h.force).not.toHaveBeenCalled();
  expect(h.remove).toHaveBeenCalledWith({ pid: 42 });
});

test("win32 escalates a synchronous stdin-close failure to the whole tree", async () => {
  const h = harness();
  const child = h.adapter.spawnDaemonProcess();
  child.closeStdin = () => { throw new Error("pipe closed"); };
  await h.adapter.terminateProcess({ child });
  expect(h.wait).not.toHaveBeenCalled();
  expect(h.force).toHaveBeenCalledWith("taskkill", ["/pid", "42", "/T", "/F"], { stdio: "ignore" });
  expect(h.native.kill).not.toHaveBeenCalled();
});

test("win32 falls back to immediate tree stop for a process port without stdin", async () => {
  const h = harness({ pipe: false });
  const child = h.adapter.spawnDaemonProcess();
  expect(child.closeStdin).toBeUndefined();
  const pending = h.adapter.terminateProcess({ child });
  expect(h.force).toHaveBeenCalledWith("taskkill", ["/pid", "42", "/T", "/F"], { stdio: "ignore" });
  expect(h.wait).not.toHaveBeenCalled();
  await pending;
  expect(h.order).toEqual(["tree-kill", "descendants", "registry"]);
});

test("win32 falls back to the direct child when taskkill fails after the grace", async () => {
  const h = harness();
  h.wait.mockResolvedValue(false);
  h.force.mockImplementation(() => { throw new Error("taskkill unavailable"); });
  await h.adapter.terminateProcess({ child: h.adapter.spawnDaemonProcess() });
  expect(h.native.kill).toHaveBeenCalledWith("SIGTERM");
  expect(h.stop).toHaveBeenCalledWith([43, 42]);
  expect(h.remove).toHaveBeenCalledWith({ pid: 42 });
});

test("win32 keeps the discovery record when descendant teardown leaves survivors", async () => {
  const h = harness();
  h.stop.mockResolvedValue({ alreadyStopped: false, forcedPids: [43], matchedPids: [43, 42],
    remainingPids: [43], stoppedPids: [42] });
  await expect(h.adapter.terminateProcess({ child: h.adapter.spawnDaemonProcess() }))
    .rejects.toThrow("daemon processes still running: 43");
  expect(h.remove).not.toHaveBeenCalled();
});

test("POSIX still ignores stdin and synchronously signals the process group before descendant cleanup", async () => {
  const h = harness({ platform: "linux" });
  const child = h.adapter.spawnDaemonProcess();
  expect(child.closeStdin).toBeUndefined();
  expect(h.spawn.mock.calls[0]![0].options).toEqual({
    cwd: "/host", env: { HOST_ENV: "1" }, detached: true, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pending = h.adapter.terminateProcess({ child });
  expect(h.signal).toHaveBeenCalledWith(-42, "SIGTERM");
  expect(h.wait).not.toHaveBeenCalled();
  expect(h.force).not.toHaveBeenCalled();
  await pending;
  expect(h.stop).toHaveBeenCalledWith([43, 42]);
  expect(h.order).toEqual(["descendants", "registry"]);
});

test.skipIf(process.platform === "win32")("without a platform override the host's own platform picks the stop path (POSIX here)", async () => {
  const h = harness();
  const { platform: _platform, ...hostPlatform } = h.options;
  const child = h.adapter.spawnDaemonProcess();
  await createNodeDaemonProcessAdapter(h.required, hostPlatform).terminateProcess({ child });
  expect(h.signal).toHaveBeenCalledWith(-42, "SIGTERM");
  expect(h.force).not.toHaveBeenCalled();
});

test("win32 without an injected exit wait uses the platform wait, which sees an already-exited daemon at once", async () => {
  const exitedPid = spawnSync(process.execPath, ["-e", ""]).pid;
  const h = harness();
  const { waitForProcessExit: _wait, ...realWait } = h.options;
  const native = Object.assign(new EventEmitter(), { pid: exitedPid, stdin: new PassThrough(), kill: vi.fn() }) as unknown as ChildProcess;
  const adapter = createNodeDaemonProcessAdapter(h.required, { ...realWait, spawn: () => native });
  await adapter.terminateProcess({ child: adapter.spawnDaemonProcess() });
  expect(h.force).not.toHaveBeenCalled();
  expect(h.remove).toHaveBeenCalledWith({ pid: exitedPid });
});

test("the Node scheduler runs a task after its delay and a cancelled task never runs", async () => {
  const scheduler = createNodeSupervisorScheduler({});
  const ran: string[] = [];
  const cancel = scheduler.schedule({ delayMs: 1, run: () => { ran.push("cancelled"); } });
  cancel();
  await new Promise<void>((resolve) => { scheduler.schedule({ delayMs: 1, run: () => { ran.push("kept"); resolve(); } }); });
  expect(ran).toEqual(["kept"]);
});
