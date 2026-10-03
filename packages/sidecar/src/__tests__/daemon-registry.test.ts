import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isProcessAlive,
  readLiveDaemonRegistryRecord,
  removeDaemonRegistryRecordIfCurrent,
  resolveDaemonRegistryPath,
  writeDaemonRegistryRecord,
  type LocalDaemonRegistryRecord,
} from "../daemon-registry.js";
import { readJsonFile } from "../json-file.js";

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jini-sidecar-daemon-registry-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

/** Spawns a real short-lived child process and resolves once it has actually exited, for a
 * deterministic "this pid used to exist, and definitely does not anymore" fixture — the
 * real-world "stale record from a crashed daemon" scenario, not a mocked stand-in for it. */
async function spawnAndAwaitExit(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const pid = child.pid;
  if (pid == null) throw new Error("failed to spawn probe child process");
  await new Promise<void>((resolveExit, rejectExit) => {
    child.once("exit", () => resolveExit());
    child.once("error", rejectExit);
  });
  return pid;
}

function makeRecord(overrides: Partial<LocalDaemonRegistryRecord> = {}): LocalDaemonRegistryRecord {
  return {
    url: "http://127.0.0.1:54213",
    host: "127.0.0.1",
    port: 54213,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("resolveDaemonRegistryPath", () => {
  it("resolves <dataDir>/daemon.json by default", () => {
    expect(resolveDaemonRegistryPath({ dataDir: "/tmp/some-data-dir" })).toBe(join("/tmp/some-data-dir", "daemon.json"));
  });

  it("honors a custom file name", () => {
    expect(resolveDaemonRegistryPath({ dataDir: "/tmp/some-data-dir" }, { fileName: "custom.json" })).toBe(join("/tmp/some-data-dir", "custom.json"));
  });

  it("throws on a non-string/empty dataDir", () => {
    expect(() => resolveDaemonRegistryPath({ dataDir: "" })).toThrow(/dataDir must be a non-empty string/);
    expect(() => resolveDaemonRegistryPath({ dataDir: "   " })).toThrow(/dataDir must be a non-empty string/);
    // @ts-expect-error deliberate runtime-only misuse proof
    expect(() => resolveDaemonRegistryPath({ dataDir: undefined })).toThrow(/dataDir must be a non-empty string/);
  });

  it("scopes two different dataDirs to two different, non-colliding paths (the multi-daemon-per-machine case)", () => {
    const a = resolveDaemonRegistryPath({ dataDir: "/tmp/daemon-a" });
    const b = resolveDaemonRegistryPath({ dataDir: "/tmp/daemon-b" });
    expect(a).not.toBe(b);
  });
});

describe("writeDaemonRegistryRecord / readLiveDaemonRegistryRecord", () => {
  it("round-trips a record written for the current (definitely alive) process", async () => {
    const dir = await makeTempDir();
    const registryPath = resolveDaemonRegistryPath({ dataDir: dir });
    const record = makeRecord({ pid: process.pid });

    await writeDaemonRegistryRecord({ registryPath, record });

    await expect(readJsonFile({ filePath: registryPath })).resolves.toEqual(record);
    await expect(readLiveDaemonRegistryRecord({ registryPath })).resolves.toEqual(record);
  });

  it("returns null when no record file exists", async () => {
    const dir = await makeTempDir();
    await expect(readLiveDaemonRegistryRecord({ registryPath: resolveDaemonRegistryPath({ dataDir: dir }) })).resolves.toBeNull();
  });

  it("returns null for a malformed/foreign JSON record (missing required fields)", async () => {
    const dir = await makeTempDir();
    const registryPath = resolveDaemonRegistryPath({ dataDir: dir });
    await writeFile(registryPath, JSON.stringify({ notADaemonRecord: true }), "utf8");

    await expect(readLiveDaemonRegistryRecord({ registryPath })).resolves.toBeNull();
  });

  it("returns null for a record whose pid is out of range (0/negative/non-integer)", async () => {
    const dir = await makeTempDir();
    const registryPath = resolveDaemonRegistryPath({ dataDir: dir });
    await writeDaemonRegistryRecord({ registryPath, record: makeRecord({ pid: -1 }) });
    await expect(readLiveDaemonRegistryRecord({ registryPath })).resolves.toBeNull();
  });

  it("treats a stale record from a crashed process (pid no longer alive) as absent, not trusted — the core edge case this module exists for", async () => {
    const dir = await makeTempDir();
    const registryPath = resolveDaemonRegistryPath({ dataDir: dir });
    const deadPid = await spawnAndAwaitExit();

    await writeDaemonRegistryRecord({ registryPath, record: makeRecord({ pid: deadPid }) });

    // The file is real and well-formed — a naive reader that skipped the liveness check would
    // hand this URL back to a caller as if the daemon were still reachable.
    await expect(readJsonFile({ filePath: registryPath })).resolves.toMatchObject({ pid: deadPid });
    await expect(readLiveDaemonRegistryRecord({ registryPath })).resolves.toBeNull();
  });

  it("a later write to the same path fully replaces the earlier one — no merged/torn record, matching json-file.ts's atomic temp-file-rename writer", async () => {
    const dir = await makeTempDir();
    const registryPath = resolveDaemonRegistryPath({ dataDir: dir });
    const first = makeRecord({ url: "http://127.0.0.1:1111", port: 1111 });
    const second = makeRecord({ url: "http://127.0.0.1:2222", port: 2222 });

    await writeDaemonRegistryRecord({ registryPath, record: first });
    await writeDaemonRegistryRecord({ registryPath, record: second });

    // A reader observing mid-sequence would see exactly `first` or exactly `second` — this
    // module writes through `writeJsonFile`'s platform-backed atomic writer (json-file.ts), which is
    // what actually provides that guarantee; this asserts the end state a repeated-restart /
    // multiple-writer sequence converges to, not a torn/merged mix of both records.
    await expect(readJsonFile({ filePath: registryPath })).resolves.toEqual(second);
  });
});

describe("removeDaemonRegistryRecordIfCurrent", () => {
  it("removes the record when its pid matches", async () => {
    const dir = await makeTempDir();
    const registryPath = resolveDaemonRegistryPath({ dataDir: dir });
    await writeDaemonRegistryRecord({ registryPath, record: makeRecord({ pid: process.pid }) });

    await removeDaemonRegistryRecordIfCurrent({ registryPath, pid: process.pid });

    await expect(readJsonFile({ filePath: registryPath })).resolves.toBeNull();
  });

  it("leaves the record alone when its pid does not match (guards a fast crash-restart race on a reused dataDir)", async () => {
    const dir = await makeTempDir();
    const registryPath = resolveDaemonRegistryPath({ dataDir: dir });
    const record = makeRecord({ pid: process.pid });
    await writeDaemonRegistryRecord({ registryPath, record });

    await removeDaemonRegistryRecordIfCurrent({ registryPath, pid: process.pid + 1 });

    await expect(readJsonFile({ filePath: registryPath })).resolves.toEqual(record);
  });

  it("is a no-op when no record file exists", async () => {
    const dir = await makeTempDir();
    await expect(removeDaemonRegistryRecordIfCurrent({ registryPath: resolveDaemonRegistryPath({ dataDir: dir }), pid: process.pid })).resolves.toBeUndefined();
  });
});

describe("isProcessAlive", () => {
  it("returns true for the current process (a real, definitely-alive pid)", () => {
    expect(isProcessAlive({ pid: process.pid })).toBe(true);
  });

  it("returns false for a pid that has actually exited (real OS-level liveness check, not mocked)", async () => {
    const deadPid = await spawnAndAwaitExit();
    expect(isProcessAlive({ pid: deadPid })).toBe(false);
  });

  it("returns false for non-integer, zero, and negative pids without probing the OS", () => {
    const killSpy = vi.spyOn(process, "kill");
    expect(isProcessAlive({ pid: 1.5 })).toBe(false);
    expect(isProcessAlive({ pid: 0 })).toBe(false);
    expect(isProcessAlive({ pid: -5 })).toBe(false);
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it("returns true when the signal probe throws EPERM (process exists, not permitted to signal it)", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const error = new Error("EPERM") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    });
    expect(isProcessAlive({ pid: 123 })).toBe(true);
    killSpy.mockRestore();
  });

  it("returns false when the signal probe throws ESRCH (no such process)", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const error = new Error("ESRCH") as NodeJS.ErrnoException;
      error.code = "ESRCH";
      throw error;
    });
    expect(isProcessAlive({ pid: 123 })).toBe(false);
    killSpy.mockRestore();
  });

  it("returns false when the signal probe throws something with no recognizable code", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("unexpected");
    });
    expect(isProcessAlive({ pid: 123 })).toBe(false);
    killSpy.mockRestore();
  });
});
