import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(), exec: vi.fn(), invocation: vi.fn(), snapshots: vi.fn(), collect: vi.fn(), stop: vi.fn(),
  read: vi.fn(), write: vi.fn(), remove: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn, execFileSync: mocks.exec }));
vi.mock("@jini-ai/platform", () => ({ createCommandInvocation: mocks.invocation, listProcessSnapshots: mocks.snapshots, collectProcessTreePids: mocks.collect, stopProcesses: mocks.stop }));
vi.mock("../daemon-registry.js", () => ({ readLiveDaemonRegistryRecord: mocks.read, writeDaemonRegistryRecord: mocks.write, removeDaemonRegistryRecordIfCurrent: mocks.remove }));

import { createNodeDaemonProcessAdapter, createSupervisorRegistry } from "../supervisor-node.js";
import type { SpawnedDaemonProcess } from "../supervisor.js";
import { EventEmitter } from "node:events";

afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

test("native child events and signals are translated into object ports", () => {
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, { pid: 42 as number | undefined, kill: vi.fn().mockReturnValue(true) });
  mocks.spawn.mockReturnValue(child);
  mocks.invocation.mockReturnValue({ command: "node", args: [] });
  const port = createNodeDaemonProcessAdapter({ command: "node", args: [], cwd: "/host", env: {},
    registry: createSupervisorRegistry({ registryPath: "/host/daemon.json" }),
  }).spawnDaemonProcess();
  const exited = vi.fn(); const errored = vi.fn();
  port.on({ event: "exit", listener: exited });
  port.on({ event: "error", listener: errored });
  const error = new Error("failed launch");
  emitter.emit("exit", 7, "SIGTERM"); emitter.emit("error", error);
  expect(exited).toHaveBeenCalledWith({ code: 7, signal: "SIGTERM" });
  expect(errored).toHaveBeenCalledWith({ error });
  expect(port.kill({}, { signal: "SIGTERM" })).toBe(true);
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  expect(port.kill({})).toBe(true);
  expect(child.kill).toHaveBeenLastCalledWith(undefined);
  expect(port.pid).toBe(42); child.pid = undefined; expect(port.pid).toBeUndefined();
});

test("registry adapter delegates atomic write, live discovery and ownership-guarded removal", async () => {
  const registry = createSupervisorRegistry({ registryPath: "/host/daemon.json" });
  const record = { pid: 42, url: "http://localhost:9000", host: "localhost", port: 9000, startedAt: "2026-01-01T00:00:00Z" };
  mocks.read.mockResolvedValue(record); mocks.write.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined);
  expect(await registry.readLive()).toEqual(record);
  await registry.write({ record }); await registry.removeIfCurrent({ pid: 42 });
  expect(mocks.read).toHaveBeenCalledWith({ registryPath: "/host/daemon.json" });
  expect(mocks.write).toHaveBeenCalledWith({ registryPath: "/host/daemon.json", record });
  expect(mocks.remove).toHaveBeenCalledWith({ registryPath: "/host/daemon.json", pid: 42 });
});

test("process launch uses platform quoting, detached groups and parent output relays", () => {
  const child = { stdout: { pipe: vi.fn() }, stderr: { resume: vi.fn() } };
  mocks.spawn.mockReturnValue(child);
  mocks.invocation.mockReturnValue({ command: "quoted-command", args: ["quoted"], windowsVerbatimArguments: true });
  const stdout = { write: vi.fn() } as unknown as import("node:stream").Writable;
  const registry = createSupervisorRegistry({ registryPath: "/host/daemon.json" });
  const adapter = createNodeDaemonProcessAdapter({ command: "host-command", args: ["host-arg"], cwd: "/host", env: { HOST_ENV: "1" }, registry }, { stdout });
  const processPort = adapter.spawnDaemonProcess();
  expect(processPort).not.toBe(child);
  expect(processPort.pid).toBeUndefined();
  expect(mocks.invocation).toHaveBeenCalledWith({ command: "host-command", args: ["host-arg"], env: { HOST_ENV: "1" } });
  expect(mocks.spawn).toHaveBeenCalledWith("quoted-command", ["quoted"], {
    cwd: "/host", env: { HOST_ENV: "1" }, detached: true, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"], windowsVerbatimArguments: true,
  });
  expect(child.stdout.pipe).toHaveBeenCalledWith(stdout); expect(child.stderr.resume).toHaveBeenCalledOnce();
});

test("POSIX termination signals the group and reuses platform descendant escalation", async () => {
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  const child: SpawnedDaemonProcess = { pid: 42, on: vi.fn(), kill: vi.fn() };
  const registry = createSupervisorRegistry({ registryPath: "/host/daemon.json" });
  mocks.snapshots.mockResolvedValue([{ pid: 43, ppid: 42, command: "worker" }]);
  mocks.collect.mockReturnValue([43, 42]); mocks.stop.mockResolvedValue({ remainingPids: [] }); mocks.remove.mockResolvedValue(undefined);
  await createNodeDaemonProcessAdapter({ command: "node", args: [], cwd: "/host", env: {}, registry }, { platform: "linux" }).terminateProcess({ child });
  expect(kill).toHaveBeenCalledWith(-42, "SIGTERM");
  expect(mocks.collect).toHaveBeenCalledWith([{ pid: 43, ppid: 42, command: "worker" }], [42]);
  expect(mocks.stop).toHaveBeenCalledWith([43, 42]); expect(mocks.remove).toHaveBeenCalledWith({ registryPath: "/host/daemon.json", pid: 42 });
});

test("Windows termination uses platform tree stopping without a POSIX group signal", async () => {
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  const child: SpawnedDaemonProcess = { pid: 42, on: vi.fn(), kill: vi.fn() };
  const registry = createSupervisorRegistry({ registryPath: "/host/daemon.json" });
  mocks.snapshots.mockResolvedValue([]); mocks.collect.mockReturnValue([42]); mocks.stop.mockResolvedValue({ remainingPids: [] }); mocks.remove.mockResolvedValue(undefined);
  await createNodeDaemonProcessAdapter({ command: "node", args: [], cwd: "/host", env: {}, registry }, { platform: "win32" }).terminateProcess({ child });
  expect(kill).not.toHaveBeenCalled(); expect(mocks.stop).toHaveBeenCalledWith([42]);
  expect(mocks.exec).toHaveBeenCalledWith("taskkill", ["/pid", "42", "/T", "/F"], { stdio: "ignore" });
});

test("failed group signalling falls back to the direct child; survivors retain their registry", async () => {
  vi.spyOn(process, "kill").mockImplementation(() => { throw new Error("not a group"); });
  const child: SpawnedDaemonProcess = { pid: 42, on: vi.fn(), kill: vi.fn().mockReturnValue(true) };
  const registry = createSupervisorRegistry({ registryPath: "/host/daemon.json" });
  mocks.snapshots.mockResolvedValue([]); mocks.collect.mockReturnValue([42]); mocks.stop.mockResolvedValue({ remainingPids: [42] });
  await expect(createNodeDaemonProcessAdapter({ command: "node", args: [], cwd: "/host", env: {}, registry }, { platform: "linux" }).terminateProcess({ child })).rejects.toThrow("daemon processes still running: 42");
  expect(child.kill).toHaveBeenCalledWith({}, { signal: "SIGTERM" }); expect(mocks.remove).not.toHaveBeenCalled();
});

test("tree signalling happens synchronously before snapshot and registry cleanup await", async () => {
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  let complete!: (value: unknown[]) => void;
  mocks.snapshots.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  mocks.collect.mockReturnValue([42]); mocks.stop.mockResolvedValue({ remainingPids: [] }); mocks.remove.mockResolvedValue(undefined);
  const child: SpawnedDaemonProcess = { pid: 42, on: vi.fn(), kill: vi.fn() };
  const registry = createSupervisorRegistry({ registryPath: "/host/daemon.json" });
  const pending = createNodeDaemonProcessAdapter({ command: "node", args: [], cwd: "/host", env: {}, registry }, { platform: "linux" }).terminateProcess({ child });
  expect(kill).toHaveBeenCalledWith(-42, "SIGTERM"); expect(mocks.remove).not.toHaveBeenCalled();
  complete([]); await pending;
  expect(mocks.remove).toHaveBeenCalledWith({ registryPath: "/host/daemon.json", pid: 42 });
});
