/** R12c: observability providers take diagnostics' helpers from the host (`optional.context`), never from an import. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { createAsyncLocalSpanScope } from "@jini-ai/diagnostics/observability/node";
import { observabilityProviderContract } from "@jini-ai/diagnostics/observability";
import { createProviderTelemetryReporter } from "../telemetry-reporter.js";
import { readOpenTelemetryHost, OpenTelemetryProviderConfigError } from "../observability-opentelemetry/configuration.js";
import { readSentryContext, SentryProviderConfigError } from "../observability-sentry/configuration.js";
import { readPostHogTelemetry, PostHogProviderConfigError } from "../analytics-posthog/configuration.js";
import { createOtelObservabilityAdapter } from "../observability-opentelemetry/opentelemetry.js";

const REAL = observabilityProviderContract.context;
const TAG = { redacted_by: "fake" } as const;
/** Tags everything it returns, so an attribute set that bypassed redaction is visible in the export. */
const taggingContext = (seen: Array<Readonly<Record<string, string | number>>>) => ({
  ...REAL,
  redactOperationAttributes: ({ attributes }: { attributes: Readonly<Record<string, string | number>> }) => { seen.push(attributes); return { ...attributes, ...TAG }; },
});
const CONFIG = { enabled: true as const, serviceName: "fixture", tracerName: "fixture", endpoint: "http://collector.invalid/v1/traces" };

test("the telemetry reporter describes a failure with the helper it was handed", () => {
  const reports: unknown[] = [];
  const reporter = createProviderTelemetryReporter({ endpoint: "https://collector.invalid", describeTelemetryFailure: () => ({ errorClass: "FromHost", statusCode: 418 }) },
    { reportTelemetry: report => { reports.push(report); } });
  reporter.result({ phase: "export", outcome: "failed", error: new Error("boom") });
  assert.deepEqual(reports, [{ phase: "export", outcome: "failed", host: "collector.invalid", errorClass: "FromHost", statusCode: 418 }]);
});

test("every provider reader names each missing helper and refuses at initialize", () => {
  assert.throws(() => readOpenTelemetryHost({ context: undefined, scope: undefined }), (error: unknown) =>
    error instanceof OpenTelemetryProviderConfigError && error.code === "observability_opentelemetry_context_missing" && error.details.includes("redactOperationAttributes") && error.details.includes("scope"));
  assert.throws(() => readOpenTelemetryHost({ context: { ...REAL, errorType: 1 }, scope: createAsyncLocalSpanScope({}) }), (error: unknown) =>
    error instanceof OpenTelemetryProviderConfigError && error.details.includes("errorType") && !error.details.includes("redactLabel"));
  assert.throws(() => readSentryContext({ context: {} }), (error: unknown) => error instanceof SentryProviderConfigError && error.code === "observability_sentry_context_missing");
  assert.throws(() => readPostHogTelemetry({ describeTelemetryFailure: undefined }), (error: unknown) => error instanceof PostHogProviderConfigError && error.code === "analytics_posthog_context_missing");
});

test("the readers return the host's helpers by reference", () => {
  const scope = createAsyncLocalSpanScope({});
  const host = readOpenTelemetryHost({ context: REAL, scope });
  assert.equal(host.context.redactOperationAttributes, REAL.redactOperationAttributes);
  assert.equal(host.scope, scope);
  assert.equal(readSentryContext({ context: REAL }).describeReportedError, REAL.describeReportedError);
  assert.equal(readPostHogTelemetry({ describeTelemetryFailure: REAL.describeTelemetryFailure }), REAL.describeTelemetryFailure);
});

test('Sentry configuration reports only the missing callable helpers', () => {
  const missing = 'optional.context is missing: describeReportedError, describeTelemetryFailure';
  assert.throws(() => readSentryContext({
    context: { redactOperationAttributes: REAL.redactOperationAttributes, describeReportedError: 'not callable' },
  }), {
    name: 'SentryProviderConfigError', code: 'observability_sentry_context_missing', details: missing,
  });
  assert.throws(() => readSentryContext({ context: null }), {
    name: 'SentryProviderConfigError', code: 'observability_sentry_context_missing',
    details: 'optional.context is missing: redactOperationAttributes, describeReportedError, describeTelemetryFailure',
  });
});

test("OpenTelemetry span and metric attributes all pass through the host's redactor", async () => {
  const seen: Array<Readonly<Record<string, string | number>>> = [];
  const exporter = new InMemorySpanExporter();
  const metricAttributes: unknown[] = [];
  const { port, dispose } = createOtelObservabilityAdapter({ config: CONFIG, context: taggingContext(seen), scope: createAsyncLocalSpanScope({}) },
    { exportEnabled: true, spanProcessors: [new SimpleSpanProcessor(exporter)], metricReaders: [] });
  try {
    port.trackOperation({ name: "op", attributes: { a: "1" } }).end({ outcome: "ok", failed: false });
    port.reportError({ error: new Error("x"), context: { operation: "op", attributes: { b: "2" } } });
    await port.metric({ name: "m", value: 1 }, { attributes: { c: "3" } });
    metricAttributes.push(...seen.map(entry => Object.keys(entry)));
    const spans = exporter.getFinishedSpans();
    assert.ok(spans.length >= 1);
    for (const span of spans) assert.equal(span.attributes.redacted_by, "fake", `span ${span.name} bypassed redaction`);
    assert.deepEqual(metricAttributes.flat().filter(name => ["a", "b", "c"].includes(name as string)).sort(), ["a", "b", "c"]);
  } finally { await dispose(); }
});
