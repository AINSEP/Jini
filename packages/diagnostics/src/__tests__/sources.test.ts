import { createNodeDiagnosticsPorts } from "../node-ports.js";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectLogSource, collectLogSources, findMacOSCrashReports } from "../sources.js";

const ports = createNodeDiagnosticsPorts({});

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "diagnostics-sources-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("collectLogSource / collectLogSources", () => {
  it("reads the whole file when tailBytes is omitted", async () => {
    const filePath = join(tempDir, "whole.log");
    await writeFile(filePath, "hello world", "utf8");

    const collected = await collectLogSource({ source: { name: "whole.log", absolutePath: filePath, kind: "text" }, filesystem: ports.filesystem });

    expect(collected.content).toBe("hello world");
    expect(collected.bytes).toBe(11);
    expect(collected.error).toBeUndefined();
  });

  it("reads the whole file when tailBytes is zero or negative", async () => {
    const filePath = join(tempDir, "zero-tail.log");
    await writeFile(filePath, "full content", "utf8");

    const zero = await collectLogSource({ source: { name: "zero-tail.log", absolutePath: filePath, kind: "text", tailBytes: 0 }, filesystem: ports.filesystem });
    const negative = await collectLogSource({ source: {
      name: "zero-tail.log",
      absolutePath: filePath,
      kind: "text",
      tailBytes: -5,
    }, filesystem: ports.filesystem });

    expect(zero.content).toBe("full content");
    expect(negative.content).toBe("full content");
  });

  it("reads the whole file via the tail path when the file is not larger than tailBytes", async () => {
    const filePath = join(tempDir, "small.log");
    await writeFile(filePath, "short", "utf8");

    const collected = await collectLogSource({ source: { name: "small.log", absolutePath: filePath, kind: "text", tailBytes: 1024 }, filesystem: ports.filesystem });

    expect(collected.content).toBe("short");
    expect(collected.bytes).toBe(5);
  });

  it("reads only the trailing window for files larger than tailBytes", async () => {
    const filePath = join(tempDir, "big.log");
    const content = "0123456789".repeat(50); // 500 bytes
    await writeFile(filePath, content, "utf8");

    const collected = await collectLogSource({ source: { name: "big.log", absolutePath: filePath, kind: "text", tailBytes: 20 }, filesystem: ports.filesystem });

    expect(collected.content).toBe(content.slice(-20));
    expect(collected.bytes).toBe(20);
  });

  it("redacts JSON-kind sources through redactJsonText", async () => {
    const filePath = join(tempDir, "data.json");
    await writeFile(filePath, JSON.stringify({ token: "shh", note: "ok" }), "utf8");

    const collected = await collectLogSource({ source: { name: "data.json", absolutePath: filePath, kind: "json" }, filesystem: ports.filesystem });

    const parsed = JSON.parse(collected.content ?? "{}");
    expect(parsed.token).toBe("[REDACTED]");
    expect(parsed.note).toBe("ok");
  });

  it("returns a null-content entry with the error message when the file cannot be read", async () => {
    const collected = await collectLogSource({ source: {
      name: "missing.log",
      absolutePath: join(tempDir, "does-not-exist.log"),
      kind: "text",
    }, filesystem: ports.filesystem });

    expect(collected.content).toBeNull();
    expect(collected.bytes).toBe(0);
    expect(collected.error).toMatch(/ENOENT/);
  });

  it("collects multiple sources concurrently", async () => {
    const a = join(tempDir, "a.log");
    const b = join(tempDir, "b.log");
    await writeFile(a, "a-content", "utf8");
    await writeFile(b, "b-content", "utf8");

    const collected = await collectLogSources({ sources: [
      { name: "a.log", absolutePath: a, kind: "text" },
      { name: "b.log", absolutePath: b, kind: "text" },
    ], filesystem: ports.filesystem });

    expect(collected.map((entry) => entry.content)).toEqual(["a-content", "b-content"]);
  });
});

describe("findMacOSCrashReports", () => {
  // Supply darwin through the system port for scan cases even on Linux CI. Otherwise the
  // platform guard returns [] before scanning, letting empty-result assertions pass vacuously.
  it("returns [] immediately on non-darwin platforms", async () => {
    const result = await findMacOSCrashReports({
      matchSubstrings: ["anything"], filesystem: ports.filesystem, clock: ports.clock,
      system: { ...ports.system, platform: () => "linux" },
    }, { searchDirs: [tempDir] });
    expect(result).toEqual([]);
  });

  it("filters by substring/recency/file-type, sorts newest first, and honors maxReports", async () => {
    const newest = join(tempDir, "MyApp-2024-report.crash");
    const older = join(tempDir, "myapp-older.crash");
    const stale = join(tempDir, "MyApp-too-old.crash");
    const unrelated = join(tempDir, "unrelated.log");
    const dirLikeMatch = join(tempDir, "MyApp-dir-report.crash");
    const brokenLink = join(tempDir, "MyApp-broken-link.crash");

    await writeFile(newest, "log", "utf8");
    await utimes(newest, new Date(), new Date());
    await writeFile(older, "log", "utf8");
    await utimes(older, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
    await writeFile(stale, "log", "utf8");
    await utimes(stale, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    await writeFile(unrelated, "log", "utf8");
    await mkdir(dirLikeMatch, { recursive: true });
    await symlink(join(tempDir, "does-not-exist-target"), brokenLink);

    const all = await findMacOSCrashReports({ matchSubstrings: ["MyApp"], filesystem: ports.filesystem, clock: ports.clock, system: { ...ports.system, platform: () => "darwin" } }, { searchDirs: [tempDir, join(tempDir, "does-not-exist-subdir")], withinDays: 7, maxReports: 5 });
    expect(all.map((entry) => entry.name)).toEqual([
      "crash-reports/MyApp-2024-report.crash",
      "crash-reports/myapp-older.crash",
    ]);
    expect(all[0]?.kind).toBe("text");

    const limited = await findMacOSCrashReports({ matchSubstrings: ["MyApp"], filesystem: ports.filesystem, clock: ports.clock, system: { ...ports.system, platform: () => "darwin" } }, { searchDirs: [tempDir], withinDays: 7, maxReports: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.name).toBe("crash-reports/MyApp-2024-report.crash");
  });

  it("derives ~/Library/Logs/DiagnosticReports from homeDir and uses default withinDays/maxReports", async () => {
    const homeDir = tempDir;
    const reportsDir = join(homeDir, "Library/Logs/DiagnosticReports");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(join(reportsDir, "HomeApp-crash.crash"), "log", "utf8");

    const result = await findMacOSCrashReports({ matchSubstrings: ["homeapp"], filesystem: ports.filesystem, clock: ports.clock, system: { ...ports.system, platform: () => "darwin" } }, { homeDir });

    expect(result).toHaveLength(1);
    expect(result[0]?.absolutePath).toBe(join(reportsDir, "HomeApp-crash.crash"));
  });

  it("uses only the built-in default darwin dirs when neither homeDir nor searchDirs is given", async () => {
    const result = await findMacOSCrashReports({ matchSubstrings: ["no-such-app-xyz-shouldnt-match"], filesystem: ports.filesystem, clock: ports.clock, system: { ...ports.system, platform: () => "darwin" } });
    expect(result).toEqual([]);
  });
});
