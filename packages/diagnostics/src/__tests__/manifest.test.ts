import { createNodeDiagnosticsPorts } from "../node-ports.js";
import { describe, expect, it } from "vitest";

import { buildManifest, buildMachineInfo, diagnosticsFileName, type DiagnosticsContext } from "../manifest.js";
import type { CollectedFile } from "../sources.js";

const ports = createNodeDiagnosticsPorts({});

describe("buildManifest", () => {
  const context: DiagnosticsContext = {
    app: { name: "jini-host", version: "1.0.0" },
    source: "daemon-http",
  };

  it("merges upstream warnings with per-file error warnings", () => {
    const files: CollectedFile[] = [
      { name: "ok.log", absolutePath: "/tmp/ok.log", content: "fine", bytes: 4 },
      { name: "bad.log", absolutePath: "/tmp/bad.log", content: null, bytes: 0, error: "ENOENT" },
    ];

    const manifest = buildManifest({ context: { ...context, warnings: ["upstream note"] }, files, clock: ports.clock });

    expect(manifest.warnings).toEqual(["upstream note", "bad.log: ENOENT"]);
    expect(manifest.files).toEqual([
      { name: "ok.log", absolutePath: "/tmp/ok.log", bytes: 4, error: undefined },
      { name: "bad.log", absolutePath: "/tmp/bad.log", bytes: 0, error: "ENOENT" },
    ]);
    expect(manifest.app).toEqual(context.app);
    expect(manifest.source).toBe("daemon-http");
    expect(typeof manifest.exportedAt).toBe("string");
  });

  it("defaults warnings to an empty array when the context has none", () => {
    const manifest = buildManifest({ context, files: [], clock: ports.clock });
    expect(manifest.warnings).toEqual([]);
    expect(manifest.namespace).toBeUndefined();
    expect(manifest.endpoint).toBeUndefined();
    expect(manifest.daemonReachable).toBeUndefined();
    expect(manifest.extra).toBeUndefined();
  });

  it("carries through namespace/endpoint/daemonReachable/extra when supplied", () => {
    const manifest = buildManifest({ context: {
        ...context,
        namespace: "ns-1",
        endpoint: "http://localhost:1234",
        daemonReachable: true,
        extra: { flag: true },
      }, files: [], clock: ports.clock });
    expect(manifest.namespace).toBe("ns-1");
    expect(manifest.endpoint).toBe("http://localhost:1234");
    expect(manifest.daemonReachable).toBe(true);
    expect(manifest.extra).toEqual({ flag: true });
  });
});

describe("buildMachineInfo", () => {
  it("reports real process/os fields and carries through the username", () => {
    const info = buildMachineInfo({ system: ports.system }, { username: "alice" });
    expect(info.username).toBe("alice");
    expect(info.pid).toBe(process.pid);
    expect(info.nodeVersion).toBe(process.version);
    expect(typeof info.hostname).toBe("string");
    expect(typeof info.totalMemoryBytes).toBe("number");
  });

  it("leaves username undefined when not supplied", () => {
    const info = buildMachineInfo({ system: ports.system });
    expect(info.username).toBeUndefined();
  });
});

describe("diagnosticsFileName", () => {
  it("formats prefix + a colon/dot-free ISO timestamp with milliseconds trimmed", () => {
    const name = diagnosticsFileName({ prefix: "myapp-diagnostics", clock: ports.clock }, { now: new Date("2024-01-02T03:04:05.678Z") });
    expect(name).toBe("myapp-diagnostics-2024-01-02T03-04-05Z.zip");
  });

  it("defaults to the current time when no date is given", () => {
    const name = diagnosticsFileName({ prefix: "myapp-diagnostics", clock: ports.clock });
    expect(name).toMatch(/^myapp-diagnostics-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.zip$/);
  });
});
