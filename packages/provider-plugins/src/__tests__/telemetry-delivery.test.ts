import { expect, it } from "vitest";
import { createTransport } from "@sentry/node";
import { createTracker } from "@jini-ai/diagnostics/observability/node";
import type { ProviderTelemetryReport } from "@jini-ai/diagnostics/observability";
import { createProviderTelemetryReporter } from "../telemetry-reporter.js";
import { createReportingSpanExporter, createOtelObservabilityAdapter } from "../observability-opentelemetry/opentelemetry.js";
import { createOpenTelemetryProvider } from "../observability-opentelemetry/index.js";
import { createSentryProvider } from "../observability-sentry/index.js";

it("reports actual exporter callbacks, sanitizes all failures, and protects the SDK diagnostic path", async () => {
  const reports: ProviderTelemetryReport[] = [];
  const secret = ["private", "diagnostic", "token"].join("-");
  const failure = Object.assign(new Error(`https://user:${secret}@collector.test/${secret}?token=${secret}`), { name: secret, code: 401, headers: { authorization: secret } });
  let reject = true;
  const exporter = createReportingSpanExporter({
    reporter: createProviderTelemetryReporter({ endpoint: `https://user:${secret}@collector.test/${secret}?token=${secret}` }, { reportTelemetry: report => { reports.push(report); } }),
    exporter: { export(_spans, callback) { callback(reject ? { code: 1, error: failure } : { code: 0 }); }, forceFlush: async () => {}, shutdown: async () => {} },
  });
  const results: unknown[] = [];
  exporter.export([], result => { results.push({ code: result.code, message: result.error?.message }); });
  reject = false;
  exporter.export([], result => { results.push({ code: result.code }); });
  expect(reports).toEqual([
    { phase: "export", outcome: "failed", host: "collector.test", errorClass: "Error", statusCode: 401 },
    { phase: "export", outcome: "ok", host: "collector.test" },
  ]);
  expect(results).toEqual([{ code: 1, message: "OpenTelemetry export failed" }, { code: 0 }]);
  expect(JSON.stringify(reports)).not.toContain(secret);
  await exporter.forceFlush(); await exporter.shutdown();
});

it("reports synchronous export and shutdown failures without throwing from adapter disposal", async () => {
  const reports: ProviderTelemetryReport[] = [];
  const reporter = createProviderTelemetryReporter({ endpoint: "https://collector.test/private/path" }, { reportTelemetry: report => { reports.push(report); } });
  const exporter = createReportingSpanExporter({ reporter, exporter: {
    export() { throw new TypeError("private transport detail"); }, forceFlush: async () => {}, shutdown: async () => {},
  } });
  exporter.export([], () => {});
  const adapter = createOtelObservabilityAdapter({ config: { enabled: true, serviceName: "test", tracerName: "test", endpoint: "https://collector.test/private/path" } }, {
    reportTelemetry: report => { reports.push(report); },
    spanProcessors: [{ onStart() {}, onEnd() {}, forceFlush: async () => {}, shutdown: async () => { throw new RangeError("private shutdown detail"); } }],
  });
  await expect(adapter.dispose()).resolves.toBeUndefined();
  expect(reports).toEqual([
    { phase: "export", outcome: "failed", host: "collector.test", errorClass: "TypeError" },
    { phase: "shutdown", outcome: "failed", host: "collector.test", errorClass: "RangeError" },
  ]);
});

it("provider factory options reach both sanitized initialization logs exactly once", async () => {
  const logs: string[] = [];
  const info = (message: string) => { logs.push(message); };
  const secret = ["private", "diagnostic", "token"].join("-");
  const otel = createOpenTelemetryProvider({ serviceName: "test", endpoint: `https://collector.test/${secret}?token=${secret}` }, { info, spanProcessors: [] });
  const sentry = createSentryProvider({ dsn: `https://${["public", "test"].join("")}@sentry.test/123` }, { info,
    client: { close: async () => true, getOptions: () => ({}) } });
  expect(logs).toEqual(["observability: OpenTelemetry exporting to collector.test", "observability: Sentry reporting to sentry.test"]);
  await otel.dispose({}); await sentry.dispose({});
  const broken = createProviderTelemetryReporter({ endpoint: "https://collector.test/private" }, { reportTelemetry() { throw new Error("sink failed"); }, info() { throw new Error("sink failed"); } });
  expect(() => broken.initialized({ message: "OpenTelemetry exporting" })).not.toThrow();
  expect(() => broken.result({ phase: "export", outcome: "failed", error: new Error("private") })).not.toThrow();
});

it("the default Sentry provider sends the actual fixed diagnostic exception with traces at zero", async () => {
  const items: { type: string; payload: { exception?: { values: { value: string }[] } } }[] = [];
  const transport = (options: Parameters<typeof createTransport>[0]) => createTransport(options, async request => {
    const lines = String(request.body).split("\n").filter(Boolean);
    for (let i = 1; i + 1 < lines.length; i += 2) items.push({ type: JSON.parse(lines[i]!).type, payload: JSON.parse(lines[i + 1]!) });
    return { statusCode: 200 };
  });
  const resource = createSentryProvider({ dsn: `https://${["public", "test"].join("")}@sentry.test/123` }, { transport });
  const tracker = createTracker({ observability: resource.port });
  await tracker.trace("telemetry.test", async () => tracker.error(new Error("Tovu test error — safe to ignore"), { operation: "telemetry.test" }));
  await resource.dispose({});
  expect(items.map(item => item.type)).toEqual(["event"]);
  expect(items[0]!.payload.exception!.values.map(value => value.value)).toEqual(["Tovu test error — safe to ignore"]);
});

it.each([200, 401, 429])("Sentry export reports the actual HTTP %i without endpoint credentials", async statusCode => {
  const reports: ProviderTelemetryReport[] = [];
  const resource = createSentryProvider({ dsn: `https://${['public', 'fixture'].join('')}@sentry.test/123` }, {
    reportTelemetry: (report: ProviderTelemetryReport) => { reports.push(report); },
    transport: (options: Parameters<typeof createTransport>[0]) => createTransport(options, async () => ({ statusCode })),
  });
  resource.port.reportError({ error: new Error("fixed diagnostic"), context: { operation: "telemetry.test" } });
  await resource.dispose({});
  expect(reports).toEqual([{ phase: 'export', outcome: statusCode === 200 ? 'ok' : 'failed', host: 'sentry.test',
    ...(statusCode === 200 ? {} : { errorClass: 'Error', statusCode }) }]);
});

it("Sentry reports a rejected transport using safe error labels only", async () => {
  const reports: ProviderTelemetryReport[] = [];
  const resource = createSentryProvider({ dsn: `https://${['public', 'fixture'].join('')}@sentry.test/123` }, {
    reportTelemetry: (report: ProviderTelemetryReport) => { reports.push(report); },
    transport: () => ({ send: async () => { throw new TypeError('private endpoint detail'); }, flush: async () => true }),
  });
  resource.port.reportError({ error: new Error("fixed diagnostic"), context: { operation: "telemetry.test" } });
  await resource.dispose({});
  expect(reports).toEqual([{ phase: 'export', outcome: 'failed', host: 'sentry.test', errorClass: 'TypeError' }]);
});
