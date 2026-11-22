import { expect, test, vi } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { createChildProcessInspection } from "../supervisor-node.js";

function nativeInspection() {
  return createChildProcessInspection({ runPs: ({ args }) => execFileSync("ps", args, { encoding: "utf8" }) });
}

test("Windows probes never invoke ps, on every test host", () => {
  const runPs = vi.fn(() => "1");
  const probe = createChildProcessInspection({ runPs }, { platform: "win32" });
  expect(probe.readProcessCommand({ pid: process.pid })).toBeNull();
  expect(probe.readProcessParentPid({ pid: process.pid })).toBeNull();
  expect(probe.isOrphanedProcess({ pid: process.pid })).toBe(false);
  expect(runPs).not.toHaveBeenCalled();
});

test("command and parent probes request only the correct argv-only columns", () => {
  const runPs = vi.fn(({ args }: { args: string[] }) => args[1] === "command=" ? "  node child.js  \n" : "  42\n");
  const probe = createChildProcessInspection({ runPs }, { platform: "darwin" });
  expect(probe.readProcessCommand({ pid: 7 })).toBe("node child.js");
  expect(probe.readProcessParentPid({ pid: 7 })).toBe(42);
  expect(runPs.mock.calls).toEqual([[{ args: ["-o", "command=", "-p", "7"] }], [{ args: ["-o", "ppid=", "-p", "7"] }]]);
});

test("blank, invalid and unavailable probes fail closed", () => {
  const runPs = vi.fn(() => "   "); const probe = createChildProcessInspection({ runPs }, { platform: "linux" });
  expect(probe.readProcessCommand({ pid: 7 })).toBeNull(); expect(probe.readProcessParentPid({ pid: 7 })).toBeNull();
  runPs.mockReturnValue("not-a-pid"); expect(probe.readProcessParentPid({ pid: 7 })).toBeNull();
  expect(probe.isOrphanedProcess({ pid: 7 })).toBe(false);
  runPs.mockImplementation(() => { throw new Error("gone"); });
  expect(probe.readProcessCommand({ pid: 7 })).toBeNull(); expect(probe.readProcessParentPid({ pid: 7 })).toBeNull();
  runPs.mockReturnValue("1"); expect(probe.isOrphanedProcess({ pid: 7 })).toBe(true);
});

test("native liveness observes this process and a child that really exited", async () => {
  const probe = nativeInspection(); expect(probe.isProcessAlive({ pid: process.pid })).toBe(true);
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  await new Promise<void>(resolve => child.once("exit", () => resolve()));
  expect(probe.isProcessAlive({ pid: child.pid! })).toBe(false);
});

test.skipIf(process.platform === "win32")("native ps reads a child's argv and live parent", async () => {
  const probe = nativeInspection();
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)", "child-inspection-marker"], { stdio: "ignore" });
  try {
    expect(probe.readProcessCommand({ pid: child.pid! })).toContain("child-inspection-marker");
    expect(probe.readProcessParentPid({ pid: child.pid! })).toBe(process.pid);
    expect(probe.isOrphanedProcess({ pid: child.pid! })).toBe(false);
  } finally {
    child.kill("SIGKILL"); await new Promise<void>(resolve => child.once("exit", () => resolve()));
  }
  expect(probe.readProcessCommand({ pid: child.pid! })).toBeNull();
});

test.skipIf(process.platform !== "darwin")("a detached orphan is reparented to launchd", async () => {
  const probe = nativeInspection();
  const script = 'const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { detached: true, stdio: "ignore" }); child.unref(); console.log(child.pid);';
  const pid = Number(execFileSync(process.execPath, ["-e", script], { encoding: "utf8" }).trim());
  try {
    const deadline = Date.now() + 5000;
    while (probe.readProcessParentPid({ pid }) !== 1 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    expect(probe.readProcessParentPid({ pid })).toBe(1); expect(probe.isOrphanedProcess({ pid })).toBe(true);
  }
  finally { process.kill(pid, "SIGKILL"); }
});
