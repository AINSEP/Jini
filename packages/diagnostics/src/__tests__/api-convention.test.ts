import { describe, expect, expectTypeOf, it } from "vitest";
import { buildManifest, buildMachineInfo, diagnosticsFileName, redactJsonValue, collectLogSources, buildDiagnosticsZip } from "../index.js";
import type { DiagnosticsFilesystemPort, DiagnosticsSystemPort } from "../ports.js";

const clock = { nowMs: () => Date.parse("2024-01-02T03:04:05.678Z") };
const system: DiagnosticsSystemPort = {
  platform: () => "darwin",
  machineInfo: () => ({ hostname: "host", platform: "darwin", release: "1", arch: "arm64", type: "Darwin", totalMemoryBytes: 1024, nodeVersion: "v22", pid: 1, ppid: 0, cwd: "/workspace" }),
};
const filesystem: DiagnosticsFilesystemPort = {
  readFile: async ({ absolutePath }) => {
    if (absolutePath === "/missing") throw "unavailable";
    const content = Buffer.from("token=secret");
    return content;
  },
  readDirectory: async () => [],
  stat: async () => ({ isFile: true, mtimeMs: clock.nowMs() }),
};

describe("object arguments and host ports", () => {
  it("requires object inputs and keeps optional settings in parameter two", () => {
    expectTypeOf(redactJsonValue).parameter(0).toEqualTypeOf<{ value: unknown }>();
    expectTypeOf(diagnosticsFileName).parameter(0).toEqualTypeOf<{ prefix: string; clock: typeof clock }>();
    expectTypeOf(buildMachineInfo).parameter(0).toEqualTypeOf<{ system: DiagnosticsSystemPort }>();
  });
  it("uses the supplied clock and machine snapshot", () => {
    expect(buildManifest({ context: { app: { name: "host" }, source: "test" }, files: [], clock }).exportedAt).toBe("2024-01-02T03:04:05.678Z");
    expect(diagnosticsFileName({ prefix: "host", clock })).toBe("host-2024-01-02T03-04-05Z.zip");
    expect(buildMachineInfo({ system }, { username: "alice" })).toEqual({ ...system.machineInfo({}), username: "alice" });
  });

  it("preserves input order when some sources fail", async () => {
    const files = await collectLogSources({ filesystem, sources: [
      { name: "bad", absolutePath: "/missing", kind: "text" },
      { name: "good", absolutePath: "/good", kind: "text" },
    ] });
    expect(files.map(({ name, content, error }) => ({ name, content, error }))).toEqual([
      { name: "bad", content: null, error: "unavailable" },
      { name: "good", content: "token=[REDACTED]", error: undefined },
    ]);
  });

  it("uses a fresh injected archive and redacts summaries", async () => {
    const entries = new Map<string, string>();
    let creations = 0;
    const archiveFactory = { create: () => { creations++; return {
      file: ({ name, content }: { name: string; content: string }) => { entries.set(name, content); },
      generate: async () => Buffer.from("archive"),
    }; } };
    const result = await buildDiagnosticsZip({ filesystem, clock, system, archiveFactory,
      context: { app: { name: "host" }, source: "test", extra: { token: "private" } },
      sources: [{ name: "missing.log", absolutePath: "/missing", kind: "text" }],
    });
    expect(creations).toBe(1);
    expect(result.zip.toString()).toBe("archive");
    expect(entries.get("missing.log")).toBe("; file unavailable: unavailable\n");
    expect(JSON.parse(entries.get("summary/manifest.json")!).extra).toEqual({ token: "[REDACTED]" });
  });

  it("redacts nested arrays without mutating source values", () => {
    const value = [{ token: "first" }, { nested: [{ password: "second" }] }];
    expect(redactJsonValue({ value })).toEqual([{ token: "[REDACTED]" }, { nested: [{ password: "[REDACTED]" }] }]);
    expect(value[0]?.token).toBe("first");
  });
});
