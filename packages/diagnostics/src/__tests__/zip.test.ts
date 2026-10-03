import { createNodeDiagnosticsPorts } from "../node-ports.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildDiagnosticsZip } from "../zip.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "diagnostics-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("buildDiagnosticsZip", () => {
  it("packages logs with redacted manifest and machine info", async () => {
    const logPath = join(tempDir, "daemon.log");
    await writeFile(logPath, "GET /api?token=abc123 ok\n", "utf8");

    const result = await buildDiagnosticsZip({ context: {
        app: { name: "jini-host", version: "1.2.3", packaged: false },
        source: "test",
        namespace: "default",
      }, sources: [{ name: "logs/daemon/latest.log", absolutePath: logPath, kind: "text" }], ...createNodeDiagnosticsPorts({}) }, { redaction: { username: "alice" } });

    const zip = await JSZip.loadAsync(result.zip);
    const log = await zip.file("logs/daemon/latest.log")!.async("string");
    expect(log).toContain("token=[REDACTED]");

    const manifest = JSON.parse(await zip.file("summary/manifest.json")!.async("string"));
    expect(manifest.app.name).toBe("jini-host");
    expect(manifest.namespace).toBe("default");
    expect(manifest.files[0].name).toBe("logs/daemon/latest.log");
    expect(manifest.warnings).toEqual([]);

    const machine = JSON.parse(await zip.file("summary/machine-info.json")!.async("string"));
    expect(typeof machine.platform).toBe("string");
  });

  it("appends matching macOS crash reports when crashReports lookup is provided", async () => {
    const crashPath = join(tempDir, "MyApp-2024-01-01-crash.crash");
    await writeFile(crashPath, "crash body", "utf8");

    const result = await buildDiagnosticsZip({ context: { app: { name: "jini-host" }, source: "test" }, sources: [], ...createNodeDiagnosticsPorts({}), system: { ...createNodeDiagnosticsPorts({}).system, platform: () => "darwin" } }, { crashReports: { matchSubstrings: ["MyApp"] }, crashReportOptions: { searchDirs: [tempDir] } });

    const zip = await JSZip.loadAsync(result.zip);
    expect(zip.file("crash-reports/MyApp-2024-01-01-crash.crash")).not.toBeNull();
    expect(result.manifest.files.some((file) => file.name === "crash-reports/MyApp-2024-01-01-crash.crash")).toBe(true);

  });

  it("records a warning placeholder when a file cannot be read", async () => {
    const result = await buildDiagnosticsZip({ context: {
        app: { name: "jini-host" },
        source: "test",
      }, sources: [{ name: "logs/missing.log", absolutePath: join(tempDir, "no-such.log"), kind: "text" }], ...createNodeDiagnosticsPorts({}) });

    const zip = await JSZip.loadAsync(result.zip);
    const placeholder = await zip.file("logs/missing.log")!.async("string");
    expect(placeholder).toContain("file unavailable");
    expect(result.manifest.warnings.length).toBe(1);
  });
});
