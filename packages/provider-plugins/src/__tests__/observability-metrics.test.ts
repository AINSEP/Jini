/** Real SDK aggregation plus a loopback OTLP collector; no vendor SDK escapes its plugin. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "vitest";
import { metrics } from "@opentelemetry/api";
import { AggregationTemporality, DataPointType, InMemoryMetricExporter, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { createTracker } from "@jini-ai/diagnostics/observability/node";
import type { ProviderTelemetryReport } from "@jini-ai/diagnostics/observability";
import { createOpenTelemetryProvider } from "../observability-opentelemetry/index.js";

const CONFIG = { serviceName: "metric-test", tracerName: "metric-scope", endpoint: "https://collector.test/otlp", auth: "none" };

test("the SDK aggregates counter increments, defaults to last-value gauge, and exports histogram units and safe attributes", async () => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000, exportTimeoutMillis: 5000 });
  const before = metrics.getMeterProvider();
  const { port, dispose } = createOpenTelemetryProvider({ ...CONFIG, attribution: { attributes: { site_id: "site-1" }, groups: {} } }, { spanProcessors: [], metricReaders: [reader] });
  const tracker = createTracker({ observability: port });
  try {
    tracker.metric({ name: "jobs", value: 2 }, { kind: "counter", unit: "{job}" });
    tracker.metric({ name: "jobs", value: 3 }, { kind: "counter", unit: "{job}" });
    tracker.metric({ name: "queue", value: 7 });
    tracker.metric({ name: "queue", value: 4 });
    tracker.metric({ name: "latency", value: 10 }, { kind: "histogram", unit: "ms", attributes: { credential: "AKIA" + "A".repeat(16), queue: "publish" } });
    tracker.metric({ name: "latency", value: 30 }, { kind: "histogram", unit: "ms", attributes: { credential: "AKIA" + "A".repeat(16), queue: "publish" } });
    await reader.forceFlush();
    const [batch] = exporter.getMetrics();
    assert.ok(batch);
    assert.equal(batch.resource.attributes["service.name"], "metric-test");
    assert.equal(batch.resource.attributes.site_id, "site-1");
    const [scope] = batch.scopeMetrics;
    assert.equal(scope!.scope.name, "metric-scope");
    const byName = new Map(scope!.metrics.map(metric => [metric.descriptor.name, metric]));
    const jobs = byName.get("jobs")!, queue = byName.get("queue")!, latency = byName.get("latency")!;
    assert.equal(jobs.dataPointType, DataPointType.SUM);
    assert.equal(jobs.descriptor.unit, "{job}");
    assert.equal(jobs.dataPoints[0]!.value, 5);
    assert.equal(queue.dataPointType, DataPointType.GAUGE);
    assert.equal(queue.dataPoints[0]!.value, 4);
    assert.ok(latency.dataPointType === DataPointType.HISTOGRAM);
    assert.equal(latency.descriptor.unit, "ms");
    assert.deepEqual(latency.dataPoints[0]!.attributes, { credential: "[REDACTED:credential]", queue: "publish" });
    assert.equal(latency.dataPoints[0]!.value.count, 2);
    assert.equal(latency.dataPoints[0]!.value.sum, 40);
    assert.equal(metrics.getMeterProvider(), before);
  } finally { await dispose({}); }
  const count = exporter.getMetrics().length;
  tracker.metric({ name: "late", value: 1 });
  await dispose({});
  assert.equal(exporter.getMetrics().length, count);
  assert.equal(metrics.getMeterProvider(), before);
});

for (const override of [false, true]) {
  test(`metrics use the configured OTLP collector, auth and resource; signal override=${override}`, async () => {
    const requests: { url: string | undefined; authorization: string | undefined; contentType: string | undefined; leak: string | undefined; body: string }[] = [];
    const reports: ProviderTelemetryReport[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        requests.push({ url: req.url, authorization: req.headers.authorization, contentType: req.headers["content-type"], leak: req.headers["x-env-leak"] as string | undefined, body });
        res.writeHead(200, { "content-type": "application/json" }); res.end("{}");
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/collector`;
    const oldHeaders = process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS;
    process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS = "X-Env-Leak=must-not-be-sent";
    try {
      const token = ["fixture", "collector", "token"].join("-");
      const { port, dispose } = createOpenTelemetryProvider({
        serviceName: "wire-metrics", endpoint: base, tracesEndpoint: `${base}/trace-override`,
        ...(override ? { metricsEndpoint: `${base}/metric-override` } : {}), auth: "bearer", token,
      }, { spanProcessors: [], reportTelemetry: (report: ProviderTelemetryReport) => { reports.push(report); } });
      createTracker({ observability: port }).metric({ name: "jobs", value: 2 }, { kind: "counter", unit: "{job}" });
      await dispose({}); // Final collection exports pending measurements and stops the timer.
      assert.equal(requests.length, 1);
      const [request] = requests;
      assert.equal(request!.url, override ? "/collector/metric-override" : "/collector/v1/metrics");
      assert.equal(request!.authorization, `Bearer ${token}`);
      assert.equal(request!.contentType, "application/json");
      assert.equal(request!.leak, undefined);
      const payload = JSON.parse(request!.body);
      const [resource] = payload.resourceMetrics;
      assert.deepEqual(resource.resource.attributes.find((attribute: { key: string }) => attribute.key === "service.name").value, { stringValue: "wire-metrics" });
      const [metric] = resource.scopeMetrics[0].metrics;
      assert.equal(metric.name, "jobs");
      assert.equal(metric.unit, "{job}");
      assert.equal(metric.sum.isMonotonic, true);
      assert.equal(Number(metric.sum.dataPoints[0].asDouble ?? metric.sum.dataPoints[0].asInt), 2);
      assert.ok(reports.some(report => report.phase === "export" && report.outcome === "ok"));
    } finally {
      if (oldHeaders === undefined) delete process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS;
      else process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS = oldHeaders;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}

test("an explicit empty reader list disables metric export and invalid numeric input stays inert", async () => {
  const reports: ProviderTelemetryReport[] = [];
  const { port, dispose } = createOpenTelemetryProvider(CONFIG, { spanProcessors: [], metricReaders: [], reportTelemetry: (report: ProviderTelemetryReport) => { reports.push(report); } });
  port.metric({ name: "invalid", value: NaN });
  port.metric({ name: "invalid", value: Infinity });
  port.metric({ name: "disabled-export", value: 1 });
  await dispose({});
  assert.equal(reports.some(report => report.phase === "export"), false);
});

test("trace-only endpoints keep metrics on their own standard route", async () => {
  const { resolveMetricsEndpoint } = await import("../observability-opentelemetry/opentelemetry.js");
  assert.equal(resolveMetricsEndpoint({ tracesEndpoint: "https://collector.test/otlp/v1/traces" }), "https://collector.test/otlp/v1/metrics");
  assert.equal(resolveMetricsEndpoint({ tracesEndpoint: "https://collector.test/custom-traces" }), "https://collector.test/v1/metrics");
  assert.equal(resolveMetricsEndpoint({ tracesEndpoint: "https://collector.test/custom-traces" }, { endpoint: " https://collector.test/otlp/ " }), "https://collector.test/otlp/v1/metrics");
  assert.equal(resolveMetricsEndpoint({ tracesEndpoint: "https://collector.test/custom-traces" }, { endpoint: "https://ignored.test", metricsEndpoint: " https://collector.test/custom-metrics " }), "https://collector.test/custom-metrics");
});
