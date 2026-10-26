import { describe, expect, it } from "vitest";
import { createTelemetryDeliveryMonitor, describeTelemetryFailure } from "../delivery.js";

describe("provider delivery evidence", () => {
  it("logs a recurring outage after recovery without resetting another provider's dedupe", () => {
    const warnings: string[] = [];
    const monitor = createTelemetryDeliveryMonitor({ warn: message => { warnings.push(message); } });
    const report = { phase: "export" as const, outcome: "failed" as const, host: "collector.test", statusCode: 429 };
    for (const providerId of ["a", "a", "b"]) monitor.report({ providerId, report });
    monitor.report({ providerId: "a", report: { ...report, outcome: "ok" } });
    for (const providerId of ["a", "a", "b"]) monitor.report({ providerId, report });
    expect(warnings).toEqual([
      "observability: a export failed (Error, HTTP 429, host collector.test)",
      "observability: b export failed (Error, HTTP 429, host collector.test)",
      "observability: a export failed (Error, HTTP 429, host collector.test)",
    ]);
  });
  it("records every result with time, logs each distinct failure once, and preserves recovery", () => {
    const warnings: string[] = [];
    let at = "2026-10-26T01:00:00.000Z";
    const monitor = createTelemetryDeliveryMonitor({ warn: message => { warnings.push(message); } }, { now: () => at });
    monitor.register({ providerId: "trace" });
    expect(monitor.read({})).toEqual([{ providerId: "trace", lastExport: null, lastShutdown: null }]);
    const report = { phase: "export" as const, outcome: "failed" as const, host: "collector.test", errorClass: "Error", statusCode: 401 };
    monitor.report({ providerId: "trace", report });
    monitor.report({ providerId: "trace", report });
    expect(warnings).toEqual(["observability: trace export failed (Error, HTTP 401, host collector.test)"]);
    at = "2026-10-26T01:00:01.000Z";
    monitor.report({ providerId: "trace", report: { phase: "export", outcome: "ok", host: "collector.test" } });
    expect(monitor.read({})).toEqual([{ providerId: "trace", lastExport: { phase: "export", outcome: "ok", host: "collector.test", at }, lastShutdown: null }]);
    monitor.report({ providerId: "trace", report: { ...report, statusCode: 403 } });
    monitor.report({ providerId: "trace", report: { ...report, phase: "shutdown" } });
    expect(warnings).toEqual([
      "observability: trace export failed (Error, HTTP 401, host collector.test)",
      "observability: trace export failed (Error, HTTP 403, host collector.test)",
      "observability: trace shutdown failed (Error, HTTP 401, host collector.test)",
    ]);
    const rows = monitor.read({});
    rows[0]!.lastExport!.host = "changed.test";
    expect(monitor.read({})[0]!.lastExport!.host).toBe("collector.test");
  });

  it("does not expose arbitrary names, messages, status text, or hostile getters", () => {
    const secret = ["private", "test", "credential"].join("-");
    const error = Object.assign(new Error(`https://collector.test/${secret}`), { name: secret, statusCode: 503, headers: { authorization: secret } });
    expect(describeTelemetryFailure({ error })).toEqual({ errorClass: "Error", statusCode: 503 });
    expect(describeTelemetryFailure({ error: { statusCode: "401", name: "TypeError" } })).toEqual({ errorClass: "TypeError" });
    expect(describeTelemetryFailure({ error: { statusCode: 999 } })).toEqual({ errorClass: "Error" });
    expect(describeTelemetryFailure({ error: { get name() { throw error; } } })).toEqual({ errorClass: "Error" });
    const monitor = createTelemetryDeliveryMonitor({ warn: () => { throw error; } });
    expect(() => monitor.report({ providerId: "trace", report: { phase: "shutdown", outcome: "failed", host: "collector.test" } })).not.toThrow();
  });
});
