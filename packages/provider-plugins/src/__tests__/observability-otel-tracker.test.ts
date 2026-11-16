import { describe, expect, it, vi } from "vitest";
import { createTracker } from "@jini-ai/diagnostics/observability/node";
import { InMemorySpanExporter, createAsyncScope, createPort } from "./otel-fakes.js";
import { observabilityProviderContract } from "@jini-ai/diagnostics/observability";
import { createOtelObservabilityPort } from "../observability-opentelemetry/otel-port.js";
import type { TraceSpanPort } from "@jini-ai/diagnostics/observability";

describe("tracker over the OpenTelemetry adapter", () => {
  it("P29: preserves the reported exception type and emits one exception per failed trace", async () => {
    const exporter = new InMemorySpanExporter();
    const observability = createPort({
      enabled: true, serviceName: "svc", tracerName: "svc.tracer", endpoint: "http://collector/v1/traces",
    }, exporter, { scope: createAsyncScope() });
    const tracker = createTracker({ observability });
    const failure = new TypeError("publish failed");

    await expect(tracker.trace({ name: "site.publish", run: () => { throw failure; } })).rejects.toBe(failure);
    await expect(tracker.trace({ name: "assistant.run", run: () => { throw failure; } }, {
      agent: { runId: "run-1" },
    })).rejects.toBe(failure);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    expect(Object.fromEntries(spans.map(span => [span.name, {
      errorType: span.attributes["error.type"], status: span.status, events: span.events,
    }]))).toEqual({
      "site.publish": {
        errorType: "TypeError",
        status: { code: "error", description: "TypeError" },
        events: [{ name: "exception", attributes: { "exception.type": "TypeError", "operation.name": "site.publish" } }],
      },
      invoke_agent: {
        errorType: "TypeError",
        status: { code: "error", description: "TypeError" },
        events: [{ name: "exception", attributes: { "exception.type": "TypeError", "operation.name": "assistant.run" } }],
      },
    });
  });
});

const helpers = observabilityProviderContract.context;

it('OTel reports active IDs only when the host supplies them and keeps metrics inert', () => {
  const ids = { traceId: 'trace', spanId: 'span' };
  const span: TraceSpanPort = { ids: () => ids, updateName() {}, setAttribute() {}, setStatus() {}, addEvent() {}, end() {} };
  const startSpan = vi.fn(() => span);
  const deps = { config: { enabled: true as const, serviceName: 's', tracerName: 't', endpoint: 'https://collector/' },
    exporterFactory: { create: () => ({}) }, tracerProviderFactory: { create: () => ({ getTracer: () => ({ startSpan }) }) } };
  const scoped = createOtelObservabilityPort(deps, { helpers, scope: { active: () => span, run: ({ fn }) => fn() } });
  expect(scoped.activeTraceIds!()).toBe(ids);
  scoped.metric({ name: 'work', value: 1 }); expect(startSpan).not.toHaveBeenCalled();
  const { ids: _ids, ...legacySpan } = span;
  const legacy = createOtelObservabilityPort(deps, { helpers, scope: { active: () => legacySpan, run: ({ fn }) => fn() } });
  expect(legacy.activeTraceIds!()).toBeUndefined();
  const error = new Error('safe'); error.name = '';
  expect(errorType({ error })).toBe('Error');
});
