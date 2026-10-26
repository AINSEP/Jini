/**
 * @file The OpenTelemetry SDK adapter for diagnostics' `ObservabilityPort`, shipped as the
 * `observability-opentelemetry` provider plugin. Moved out of the first host application's core
 * (its `platform/observability/otel.ts`) and then out of `@jini-ai/diagnostics`
 * (its former `./observability/opentelemetry` subpath) by owner decision 2026-10-25 ("it should be
 * a provider plugin … we're gonna want to use it for other projects"); behavior unchanged.
 * Diagnostics' `otel.ts` (SDK-free lifecycle and redaction) explains why the port itself must never
 * mention OTel, so a future adapter for a different instrumentation system can satisfy it without
 * this file changing at all.
 *
 * Loaded only when selected: a host imports this plugin only when it is installed, enabled and
 * configured, so the OTel SDK is never loaded into a process whose operator hasn't configured an
 * OTLP endpoint. That is a real resource-budget concern, not tidiness: the groundwork survey this
 * was built from (that host's 2026-08-28 observability groundwork survey, §5.5) flags that the host
 * ships to small, single-process VPS instances, and an always-loaded SDK would
 * be dead weight for every operator who never configures an exporter (measured 2026-10-25: ~155 ms,
 * +21 MB RSS). The former synchronous `require()` loading is gone: provider plugins initialize
 * asynchronously (awaited, bounded) before the host admits application work.
 *
 * One `NodeTracerProvider` per adapter, and it is never registered globally
 * (`trace.setGlobalTracerProvider`/`provider.register()`). This adapter takes its `Tracer` directly
 * off the provider instance instead (`NodeTracerProvider#getTracer()` — the OTel 2.x-documented way
 * to obtain a `Tracer` without a global registration), so constructing this adapter can never
 * silently take over `@opentelemetry/api`'s process-wide tracer registration from some other part
 * of the process that also touches it. {@link createOtelObservabilityAdapter} also returns `dispose`
 * (provider shutdown: flushes the batch queue, stops its timer) for the host's teardown.
 */
// Span lifecycle rationale: @jini-ai/diagnostics src/observability/otel.ts.
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";
import { getSharedConfigurationDefaults, OTLPExporterBase } from "@opentelemetry/otlp-exporter-base";
import { createOtlpHttpExportDelegate, httpAgentFactoryFromOptions } from "@opentelemetry/otlp-exporter-base/node-http";
import { JsonTraceSerializer, TraceExporterMetricsHelper } from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { BatchSpanProcessor, ParentBasedSampler, AlwaysOnSampler, type ReadableSpan, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { createOtelObservabilityPort, type ExporterFactory, type ObservabilityAdapter, type ObservabilityConfigEnabled, type TraceSpanKind, type TraceSpanPort, type TracerPort, type TracerProviderFactory } from "@jini-ai/diagnostics/observability";
import { createAsyncLocalSpanScope } from "@jini-ai/diagnostics/observability/node";

export interface OtelAdapterOptions {
  /** OTLP/HTTP request headers (e.g. a collector's `Authorization`); any OTLP endpoint, no vendor-specific code. */
  headers?: Readonly<Record<string, string>>;
  /** Test seam: replace the OTLP batch pipeline with explicit SDK span processors. */
  spanProcessors?: SpanProcessor[];
  /** Host attribution (e.g. which site sent the span), added to the resource; `service.name` stays the host's. */
  resourceAttributes?: Readonly<Record<string, string>>;
}

/**
 * Injected configuration only (Codex wave-2 HIGH, 2026-10-25): the SDK's convenience
 * `OTLPTraceExporter` merges `OTEL_EXPORTER_OTLP_*` variables (headers, endpoint, compression,
 * timeout) under the given options, so credentials an operator left in the environment would ride
 * every export to whichever collector a site's settings card names. The exporter is assembled from
 * the SDK's own OTLP/HTTP parts with every option stated, and the provider below states the sampler,
 * span limits and batch settings the SDK would otherwise default from `OTEL_*` variables.
 */
const OTLP_SPAN_EXPORTER_COMPONENT = "otlp_http_span_exporter";
const BATCH_DEFAULTS = { maxExportBatchSize: 512, maxQueueSize: 2048, scheduledDelayMillis: 5000, exportTimeoutMillis: 30_000 };
const LIMITS = { attributeValueLengthLimit: Infinity, attributeCountLimit: 128 };
const SPAN_LIMITS = { ...LIMITS, linkCountLimit: 128, eventCountLimit: 128, attributePerEventCountLimit: 128, attributePerLinkCountLimit: 128 };

/** OTLP/HTTP JSON trace exporter from injected `url` + `headers` only; never reads the environment. */
export function createInjectedOtlpTraceExporter({ url, headers }: { url: string; headers?: Readonly<Record<string, string>> }): OTLPExporterBase<ReadableSpan[]> {
  const requestHeaders = { "Content-Type": "application/json", ...headers };
  return new OTLPExporterBase(createOtlpHttpExportDelegate({
    ...getSharedConfigurationDefaults(), url, headers: async () => ({ ...requestHeaders }),
    agentFactory: httpAgentFactoryFromOptions({ keepAlive: true }),
  }, JsonTraceSerializer, OTLP_SPAN_EXPORTER_COMPONENT, TraceExporterMetricsHelper, undefined));
}

const SDK_SPAN_KINDS: Record<TraceSpanKind, SpanKind> = { server: SpanKind.SERVER, client: SpanKind.CLIENT, internal: SpanKind.INTERNAL };

/** SDK span behind each port span this module handed out, so a port span can be named as a parent. */
const sdkSpans = new WeakMap<TraceSpanPort, Span>();

/** Translates object-shaped diagnostics span methods to SDK calls; no lifecycle policy here. */
function adaptSpan({ span }: { span: Span }): TraceSpanPort {
  const port: TraceSpanPort = {
    updateName: ({ name }) => { span.updateName(name); },
    setAttribute: ({ name, value }) => { span.setAttribute(name, value); },
    setStatus: ({ description }) => { span.setStatus({ code: SpanStatusCode.ERROR, ...(description ? { message: description } : {}) }); },
    addEvent: ({ name, attributes }) => { span.addEvent(name, attributes); },
    end: () => { span.end(); },
  };
  sdkSpans.set(port, span);
  return port;
}

/**
 * Starts an SDK span from Jini's structural input and returns its host adapter. The parent goes in
 * as an explicit context (`trace.setSpan(ROOT_CONTEXT, parent)`), not through a registered global
 * context manager — the same "never take over @opentelemetry/api's process-wide registration" rule
 * this file's header gives for the provider.
 */
function adaptTracer({ tracer }: { tracer: Tracer }): TracerPort {
  return {
    startSpan: ({ name, kind, attributes }, { parent } = {}) => {
      const parentSpan = parent ? sdkSpans.get(parent) : undefined;
      const context = parentSpan ? trace.setSpan(ROOT_CONTEXT, parentSpan) : undefined;
      return adaptSpan({ span: tracer.startSpan(name, { kind: SDK_SPAN_KINDS[kind], attributes }, context) });
    },
  };
}

/**
 * Creates structural SDK factories; no provider, exporter or background timer starts until invoked.
 * A host constructs its port once at boot, not per request.
 * @param _required Empty required object; all SDK overrides are optional.
 * @param options OTLP headers; optional test processors, which prevent constructing a real exporter.
 * @returns Factories which preserve service identity and do not register the provider globally.
 * @complexity O(1) setup cost (one provider, one span processor, one exporter); each tracked span is
 * O(1) — the SDK's real cost (the batching queue and its periodic HTTP export) lives in the span
 * processor's own background timer, not in any individual track/end call.
 */
export function createOtelFactories(_required: Record<string, never>, options: OtelAdapterOptions = {}): {
  exporterFactory: ExporterFactory;
  tracerProviderFactory: TracerProviderFactory;
  /** Shuts down every provider these factories built (flush + stop the batch timer). */
  shutdown: () => Promise<void>;
} {
  const providers: NodeTracerProvider[] = [];
  return {
    shutdown: async () => { await Promise.all(providers.map((provider) => provider.shutdown())); },
    exporterFactory: {
      create: ({ endpoint }) => {
        if (options.spanProcessors !== undefined) return undefined;
        return createInjectedOtlpTraceExporter({ url: endpoint, ...(options.headers ? { headers: options.headers } : {}) });
      },
    },
    tracerProviderFactory: {
      create: ({ serviceName, exporter }) => {
        let spanProcessors = options.spanProcessors;
        if (spanProcessors === undefined) {
          // The diagnostics port treats exporters as opaque. Narrow at the SDK boundary rather
          // than casting an arbitrary port value into a live processor's exporter dependency.
          if (!(exporter instanceof OTLPExporterBase)) throw new TypeError("OpenTelemetry requires an OTLP trace exporter");
          spanProcessors = [new BatchSpanProcessor(exporter as OTLPExporterBase<ReadableSpan[]>, BATCH_DEFAULTS)];
        }
        const provider = new NodeTracerProvider({
          resource: resourceFromAttributes({ ...options.resourceAttributes, [ATTR_SERVICE_NAME]: serviceName }), spanProcessors,
          sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }), generalLimits: LIMITS, spanLimits: SPAN_LIMITS,
        });
        providers.push(provider);
        return { getTracer: ({ name }) => adaptTracer({ tracer: provider.getTracer(name) }) };
      },
    },
  };
}

/**
 * The adapter plus its lifecycle (review 2026-10-25 #6): the host registers `dispose` with its own
 * teardown, so a closed site flushes and stops its provider.
 * @param required Enabled diagnostics configuration.
 * @param options OTLP headers; optional SDK test processors.
 * @returns `{ port, dispose }`; `dispose` never throws.
 * @complexity O(1) setup.
 */
export function createOtelObservabilityAdapter({ config }: { config: ObservabilityConfigEnabled }, options: OtelAdapterOptions = {}): ObservabilityAdapter {
  const { shutdown, ...factories } = createOtelFactories({}, options);
  const port = createOtelObservabilityPort({ config, ...factories }, { scope: createAsyncLocalSpanScope({}) });
  return { port, dispose: async () => { try { await shutdown(); } catch { /* teardown is best-effort */ } } };
}
