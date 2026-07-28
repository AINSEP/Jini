import { describe, expect, it } from "vitest";

// Every other test file in this package imports straight from the sibling
// source files (./sources.js, ./zip.js, ...), so nothing ever actually
// imports the package's own barrel — v8 marks both index.ts and the
// re-exported-only contract.ts as 0% covered even though their content is
// exercised transitively. This test imports the public surface through
// ./index.js itself (mirroring the barrel-completeness smoke test already
// used elsewhere in this repo) so the barrel module — and the pure-constant
// contract.ts module it re-exports — are both actually loaded, and asserts
// every documented export is present with the right shape.
import * as diagnostics from "../index.js";

describe("@injini/diagnostics barrel", () => {
  it("re-exports the contract constants verbatim", () => {
    expect(diagnostics.DIAGNOSTICS_EXPORT_PATH).toBe("/api/diagnostics/export");
    expect(diagnostics.DIAGNOSTICS_FILENAME_PREFIX).toBe("jini-diagnostics");
    expect(diagnostics.DIAGNOSTICS_CONTENT_TYPE).toBe("application/zip");
  });

  it("re-exports every redaction function", () => {
    expect(typeof diagnostics.redactJsonValue).toBe("function");
    expect(typeof diagnostics.redactJsonText).toBe("function");
    expect(typeof diagnostics.redactText).toBe("function");
  });

  it("re-exports every log-source function", () => {
    expect(typeof diagnostics.collectLogSource).toBe("function");
    expect(typeof diagnostics.collectLogSources).toBe("function");
    expect(typeof diagnostics.findMacOSCrashReports).toBe("function");
  });

  it("re-exports every manifest function", () => {
    expect(typeof diagnostics.buildManifest).toBe("function");
    expect(typeof diagnostics.buildMachineInfo).toBe("function");
    expect(typeof diagnostics.diagnosticsFileName).toBe("function");
  });

  it("re-exports the zip builder", () => {
    expect(typeof diagnostics.buildDiagnosticsZip).toBe("function");
  });

  it("re-exports every agent-log function", () => {
    expect(typeof diagnostics.buildRunEventLogSources).toBe("function");
    expect(typeof diagnostics.buildAgentCliLogSources).toBe("function");
  });
});
