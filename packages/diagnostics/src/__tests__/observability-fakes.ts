import { createOtelObservabilityPort } from "../observability/otel.js";
import type { ObservabilityConfigEnabled } from "../observability/config.js";
export const SpanKind = { SERVER: "server" };
export const SpanStatusCode = { ERROR: "error", UNSET: "unset" };
type FinishedSpan = { name: string; kind: string; attributes: Record<string, string | number>; status: { code: string } };
export class InMemorySpanExporter {
 readonly spans: FinishedSpan[] = [];
 getFinishedSpans() { return this.spans; }
}
export function createPort(config: ObservabilityConfigEnabled, exporter: InMemorySpanExporter) {
 return createOtelObservabilityPort({ config,
  exporterFactory: { create: () => exporter },
  tracerProviderFactory: { create: () => ({ getTracer: () => ({ startSpan: ({ name, kind, attributes }) => {
   const span: FinishedSpan = { name, kind, attributes: { ...attributes }, status: { code: "unset" } };
   return { updateName: ({ name }) => { span.name = name; }, setAttribute: ({ name, value }) => { span.attributes[name] = value; }, setStatus: ({ code }) => { span.status.code = code; }, end: () => { exporter.spans.push(span); } };
  } }) }) },
 });
}
