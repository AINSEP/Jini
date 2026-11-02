import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createNodeDurableJsonPorts } from "../durable-json.js";
import { createNodeDirectoryWorkspace } from "../directory-workspace.js";
import { FileLockTimeoutError, withFileLock, withFileLockSync } from "../file-lock.js";

const roots: string[] = [];
function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "incomplete-lock-holder-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

// Full ownership metadata is needed for assertHeld/release, but a local positive PID alone
// suffices to prove death. Missing display metadata must not wedge a restart forever.
for (const adapter of ["sync", "async"] as const) {
  test.each([
    { pid: 4242, hostname: "local" },
    { pid: 4242, hostname: "local", token: 7, acquiredAt: "invalid" },
    { pid: 4242, hostname: "local", token: "old", acquiredAt: null },
  ])(`${adapter} reclaims an incomplete local dead holder: %j`, async holder => {
    const lockPath = path.join(temporaryRoot(), "running.json.lock");
    fs.writeFileSync(lockPath, JSON.stringify(holder));
    const isAlive = vi.fn(({ pid }: { pid: number }) => pid !== 4242);
    let elapsed = 0;
    const options = {
      staleMs: Infinity, timeoutMs: 10, pollMs: 1, hostname: () => "local",
      process: { pid: 4243, isAlive }, clock: { nowMs: () => elapsed },
      sleep: () => { elapsed++; },
    };
    const required = { lockPath, run: () => {
      expect(JSON.parse(fs.readFileSync(lockPath, "utf8"))).toMatchObject({ pid: 4243 });
      return "restarted";
    } };
    const result = adapter === "sync" ? withFileLockSync(required, options) : await withFileLock(required, options);
    expect(result).toBe("restarted");
    expect(isAlive).toHaveBeenCalledWith({ pid: 4242 });
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test.each([
    { pid: 4242, hostname: "local" },
    { pid: 4242, hostname: "local", token: "live", acquiredAt: "2000-01-01T00:00:00Z" },
  ])(`${adapter} preserves an old live local holder: %j`, async holder => {
    const lockPath = path.join(temporaryRoot(), "running.json.lock");
    const raw = JSON.stringify(holder);
    fs.writeFileSync(lockPath, raw);
    fs.utimesSync(lockPath, new Date(0), new Date(0));
    const run = vi.fn();
    const isAlive = vi.fn(() => true);
    const required = { lockPath, run };
    for (const staleMs of [100, Infinity]) {
      const options = { staleMs, timeoutMs: 0, hostname: () => "local", process: { pid: 4243, isAlive } };
      if (adapter === "sync") expect(() => withFileLockSync(required, options)).toThrow(FileLockTimeoutError);
      else await expect(withFileLock(required, options)).rejects.toThrow(FileLockTimeoutError);
      expect(fs.readFileSync(lockPath, "utf8")).toBe(raw);
    }
    expect(isAlive).toHaveBeenCalledWith({ pid: 4242 });
    expect(run).not.toHaveBeenCalled();
    expect(fs.readFileSync(lockPath, "utf8")).toBe(raw);
  });

  test.each([
    "", "{", "null", "[]", "{}",
    JSON.stringify({ pid: 4242 }),
    JSON.stringify({ pid: 4242, hostname: "foreign" }),
    ...[0, -1, 1.5, "4242", 2 ** 60].map(pid => JSON.stringify({ pid, hostname: "local" })),
  ])(`${adapter} never treats an unidentified or foreign holder as a dead local PID: %j`, async raw => {
    const lockPath = path.join(temporaryRoot(), "running.json.lock");
    fs.writeFileSync(lockPath, raw);
    fs.utimesSync(lockPath, new Date(0), new Date(0));
    const run = vi.fn(), isAlive = vi.fn(() => false);
    const options = { staleMs: Infinity, timeoutMs: 0, hostname: () => "local", process: { pid: 4243, isAlive } };
    if (adapter === "sync") expect(() => withFileLockSync({ lockPath, run }, options)).toThrow(FileLockTimeoutError);
    else await expect(withFileLock({ lockPath, run }, options)).rejects.toThrow(FileLockTimeoutError);
    expect(isAlive).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(fs.readFileSync(lockPath, "utf8")).toBe(raw);
  });

  test(`${adapter} preserves an incomplete holder when the native PID probe is denied`, async () => {
    const lockPath = path.join(temporaryRoot(), "running.json.lock");
    const raw = JSON.stringify({ pid: process.pid, hostname: os.hostname() });
    fs.writeFileSync(lockPath, raw);
    fs.utimesSync(lockPath, new Date(0), new Date(0));
    const denied = Object.assign(new Error("permission denied"), { code: "EPERM" });
    const probe = vi.spyOn(process, "kill").mockImplementation(() => { throw denied; });
    const run = vi.fn();
    const options = { staleMs: Infinity, timeoutMs: 0 };
    if (adapter === "sync") expect(() => withFileLockSync({ lockPath, run }, options)).toThrow(FileLockTimeoutError);
    else await expect(withFileLock({ lockPath, run }, options)).rejects.toThrow(FileLockTimeoutError);
    expect(probe).toHaveBeenCalledWith(process.pid, 0);
    expect(run).not.toHaveBeenCalled();
    expect(fs.readFileSync(lockPath, "utf8")).toBe(raw);
  });

  test(`${adapter} surfaces a failing process port and preserves the incomplete holder`, async () => {
    const lockPath = path.join(temporaryRoot(), "running.json.lock");
    const raw = JSON.stringify({ pid: 4242, hostname: "local" });
    fs.writeFileSync(lockPath, raw);
    const failure = new Error("liveness unavailable"), run = vi.fn();
    const options = { staleMs: Infinity, timeoutMs: 0, hostname: () => "local",
      process: { pid: 4243, isAlive: () => { throw failure; } } };
    if (adapter === "sync") expect(() => withFileLockSync({ lockPath, run }, options)).toThrow(failure);
    else await expect(withFileLock({ lockPath, run }, options)).rejects.toBe(failure);
    expect(run).not.toHaveBeenCalled();
    expect(fs.readFileSync(lockPath, "utf8")).toBe(raw);
  });
}

test("a site restart claims its running lease after an incomplete local dead holder", () => {
  const root = temporaryRoot(), site = path.join(root, "site");
  fs.mkdirSync(site);
  const lockPath = path.join(site, "running.json.lock");
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 4242, hostname: os.hostname() }));
  let elapsed = Date.now();
  const ports = {
    ...createNodeDurableJsonPorts({}),
    clock: { nowMs: () => elapsed },
    sleep: { sleep: ({ durationMs }: { durationMs: number }) => { elapsed += durationMs; } },
    process: { pid: 4243, isAlive: ({ pid }: { pid: number }) => pid === 4243 },
  };
  const workspace = createNodeDirectoryWorkspace({
    homeDir: root, defaultFolder: "Sites", envName: "SITES_HOME", settingsFile: path.join(root, "settings.json"),
    registryName: "sites.json", runningName: "running.json",
  }, { env: {}, ports });
  const claimed = workspace.claim({ path: site, app: "Web", port: 3000 });
  expect(claimed).toMatchObject({ acquired: true, record: { pid: 4243, port: 3000 } });
  expect(workspace.running({ path: site }).peek({})?.token).toBe(claimed.record.token);
  expect(fs.existsSync(lockPath)).toBe(false);
  workspace.running({ path: site }).release({ token: claimed.record.token });
  expect(fs.existsSync(path.join(site, "running.json"))).toBe(false);
});
