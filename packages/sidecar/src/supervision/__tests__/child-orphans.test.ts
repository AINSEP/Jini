import { afterEach, expect, test, vi } from "vitest";
import { spawn } from "node:child_process";
import { reconcileRows, terminateConfirmedOrphan } from "../child-orphans.js";
import { createChildProcessInspection } from "../supervisor-node.js";
import { execFileSync } from "node:child_process";

const row = { key: "child", pid: 99 };
function fixture() {
  const processes = { isAlive: vi.fn((_input: { pid: number }) => true), isLiveRow: vi.fn((_input: { row: { pid: number } }) => true), isOrphan: vi.fn((_input: { pid: number }) => true), signal: vi.fn((_input: { pid: number; signal: NodeJS.Signals }) => {}) };
  return processes;
}
afterEach(() => { vi.useRealTimers(); });

test.each(["isAlive", "isLiveRow", "isOrphan"] as const)("reconciliation proves %s before signalling", async probe => {
  const processes = fixture(); processes[probe].mockReturnValue(false);
  expect(await reconcileRows({ rows: [row], processes })).toEqual([]);
  expect(processes.signal).not.toHaveBeenCalled();
});

test("identity is checked again before force; changed identity keeps the process alive", async () => {
  vi.useFakeTimers(); const processes = fixture();
  const work = reconcileRows({ rows: [row], processes });
  expect(processes.signal).toHaveBeenCalledTimes(1); expect(processes.signal).toHaveBeenCalledWith({ pid: 99, signal: "SIGTERM" });
  processes.isLiveRow.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await work).toEqual([row]); expect(processes.signal).toHaveBeenCalledTimes(1);
});

test("force acceptance waits for observed exit, with a separate bounded final poll", async () => {
  vi.useFakeTimers(); const processes = fixture(); let finished = false;
  const work = terminateConfirmedOrphan({ row, processes }, { graceMs: 0 }).then(() => { finished = true; });
  expect(processes.signal.mock.calls).toEqual([[{ pid: 99, signal: "SIGTERM" }], [{ pid: 99, signal: "SIGKILL" }]]);
  await vi.advanceTimersByTimeAsync(200); expect(finished).toBe(false);
  processes.isAlive.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(200); await work; expect(finished).toBe(true);
});

test("the default graceful window is 5 seconds in 200ms polls, followed by at most 5 seconds", async () => {
  vi.useFakeTimers(); const processes = fixture(); let finished = false;
  const work = terminateConfirmedOrphan({ row, processes }).then(() => { finished = true; });
  await vi.advanceTimersByTimeAsync(4800); expect(processes.signal).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(200); expect(processes.signal).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(4800); expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(200); await work; expect(finished).toBe(true);
});

test("exit during grace avoids force, and signal races preserve reconciliation reports", async () => {
  vi.useFakeTimers(); const processes = fixture();
  const work = reconcileRows({ rows: [row], processes }); processes.isAlive.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(200); expect(await work).toEqual([row]); expect(processes.signal).toHaveBeenCalledTimes(1);
  processes.isAlive.mockReturnValue(true); processes.signal.mockImplementation(() => { throw new Error("ESRCH"); });
  expect(await reconcileRows({ rows: [row], processes })).toEqual([row]);
});

test("a failed force signal does not start a final poll", async () => {
  vi.useFakeTimers(); const processes = fixture();
  processes.signal.mockImplementation(({ signal }: { signal: NodeJS.Signals }) => { if (signal === "SIGKILL") throw new Error("gone"); });
  await terminateConfirmedOrphan({ row, processes }, { graceMs: 0 });
  expect(vi.getTimerCount()).toBe(0);
});

test.skipIf(process.platform === "win32")("a controlled native child is signalled and its exit observed", async () => {
  const child = spawn(process.execPath, ["-e", "console.log('ready'); setTimeout(() => {}, 60000)", "orphan-native-marker"], { stdio: ["ignore", "pipe", "ignore"] });
  const exit = new Promise<void>(resolve => child.once("exit", () => resolve()));
  await new Promise<void>(resolve => child.stdout!.once("data", () => resolve()));
  const inspection = createChildProcessInspection({ runPs: ({ args }) => execFileSync("ps", args, { encoding: "utf8" }) });
  try {
    await terminateConfirmedOrphan({ row: { pid: child.pid! }, processes: {
      isAlive: ({ pid }) => inspection.isProcessAlive({ pid }),
      isLiveRow: ({ row }) => inspection.readProcessCommand({ pid: row.pid })?.includes("orphan-native-marker") === true,
      isOrphan: () => false,
      signal: ({ pid, signal }) => { process.kill(pid, signal); },
    } });
    await exit; expect(inspection.isProcessAlive({ pid: child.pid! })).toBe(false);
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exit; } }
});

test.skipIf(process.platform === "win32")("a native child ignoring TERM is forced and actually reaped", async () => {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); console.log('ready'); setTimeout(() => {}, 60000)", "orphan-force-marker"], { stdio: ["ignore", "pipe", "ignore"] });
  const exit = new Promise<void>(resolve => child.once("exit", () => resolve()));
  await new Promise<void>(resolve => child.stdout!.once("data", () => resolve()));
  const inspection = createChildProcessInspection({ runPs: ({ args }) => execFileSync("ps", args, { encoding: "utf8" }) });
  try {
    await terminateConfirmedOrphan({ row: { pid: child.pid! }, processes: {
      isAlive: ({ pid }) => inspection.isProcessAlive({ pid }),
      isLiveRow: ({ row }) => inspection.readProcessCommand({ pid: row.pid })?.includes("orphan-force-marker") === true,
      isOrphan: () => false,
      signal: ({ pid, signal }) => { process.kill(pid, signal); },
    } }, { graceMs: 200 });
    await exit; expect(child.signalCode).toBe("SIGKILL"); expect(inspection.isProcessAlive({ pid: child.pid! })).toBe(false);
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exit; } }
});

test.skipIf(process.platform === "win32")("native identity changes during TERM grace prevent force", async () => {
  const script = "process.on('SIGTERM', () => { process.title = 'unrelated-worker'; console.log('changed'); }); console.log('ready'); setTimeout(() => {}, 60000)";
  const child = spawn(process.execPath, ["-e", script, "orphan-identity-marker"], { stdio: ["ignore", "pipe", "ignore"] });
  const exit = new Promise<void>(resolve => child.once("exit", () => resolve()));
  await new Promise<void>(resolve => child.stdout!.once("data", () => resolve()));
  const inspection = createChildProcessInspection({ runPs: ({ args }) => execFileSync("ps", args, { encoding: "utf8" }) });
  try {
    const changed = new Promise<void>(resolve => child.stdout!.once("data", () => resolve()));
    const work = terminateConfirmedOrphan({ row: { pid: child.pid! }, processes: {
      isAlive: ({ pid }) => inspection.isProcessAlive({ pid }),
      isLiveRow: ({ row }) => inspection.readProcessCommand({ pid: row.pid })?.includes("orphan-identity-marker") === true,
      isOrphan: () => false,
      signal: ({ pid, signal }) => { process.kill(pid, signal); },
    } }, { graceMs: 400 });
    await changed; await work;
    expect(inspection.readProcessCommand({ pid: child.pid! })).not.toContain("orphan-identity-marker");
    expect(inspection.isProcessAlive({ pid: child.pid! })).toBe(true);
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exit; } }
});
