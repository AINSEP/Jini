import { createOtelObservabilityPort } from "../observability/otel.js";
import type { ObservabilityConfigEnabled } from "../observability/config.js";
import { createAsyncLocalSpanScope } from "../observability/node.js";
import type { SpanScopePort, TraceSpanPort } from "../observability/ports.js";
export const SpanKind = { SERVER: "server", CLIENT: "client", INTERNAL: "internal" };
export const SpanStatusCode = { ERROR: "error", UNSET: "unset" };
export type FinishedSpan = {
 name: string; kind: string; attributes: Record<string, string | number>; status: { code: string; description?: string };
 events: { name: string; attributes: Record<string, string | number> }[]; parent?: FinishedSpan | undefined;
};
export class InMemorySpanExporter {
 readonly spans: FinishedSpan[] = [];
 getFinishedSpans() { return this.spans; }
}
/** The package's own Node scope, so parenting in these tests is the real mechanism. */
export function createAsyncScope(): SpanScopePort {
 return createAsyncLocalSpanScope({});
}
export function createPort(config: ObservabilityConfigEnabled, exporter: InMemorySpanExporter, options: { scope?: SpanScopePort } = {}) {
 const records = new WeakMap<TraceSpanPort, FinishedSpan>();
 return createOtelObservabilityPort({ config,
  exporterFactory: { create: () => exporter },
  tracerProviderFactory: { create: () => ({ getTracer: () => ({ startSpan: ({ name, kind, attributes }, { parent } = {}) => {
   const span: FinishedSpan = { name, kind, attributes: { ...attributes }, status: { code: "unset" }, events: [], ...(parent ? { parent: records.get(parent) } : {}) };
   const port: TraceSpanPort = {
    updateName: ({ name }) => { span.name = name; },
    setAttribute: ({ name, value }) => { span.attributes[name] = value; },
    setStatus: ({ code, description }) => { span.status = { code, ...(description ? { description } : {}) }; },
    addEvent: ({ name, attributes }) => { span.events.push({ name, attributes: { ...attributes } }); },
    end: () => { exporter.spans.push(span); },
   };
   records.set(port, span);
   return port;
  } }) }) },
 }, options);
}
