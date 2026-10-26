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
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Meter, type Span, type Tracer } from "@opentelemetry/api";
import { getSharedConfigurationDefaults, OTLPExporterBase } from "@opentelemetry/otlp-exporter-base";
import { createOtlpHttpExportDelegate, httpAgentFactoryFromOptions } from "@opentelemetry/otlp-exporter-base/node-http";
import { JsonTraceSerializer, TraceExporterMetricsHelper, JsonMetricsSerializer, MetricsExporterMetricsHelper, type ISerializer, type IExporterMetricsHelper } from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { BatchSpanProcessor, ParentBasedSampler, AlwaysOnSampler, type ReadableSpan, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { MeterProvider, PeriodicExportingMetricReader, type IMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { createOtelObservabilityPort, redactOperationAttributes, type MetricInput, type MetricOptions, type ExporterFactory, type ObservabilityAdapter, type ObservabilityConfigEnabled, type TraceSpanKind, type TraceSpanPort, type TracerPort, type TracerProviderFactory } from "@jini-ai/diagnostics/observability";
import { createAsyncLocalSpanScope } from "@jini-ai/diagnostics/observability/node";
import { createProviderTelemetryReporter, type ProviderTelemetryOptions } from "../telemetry-reporter.js";

export interface OtelAdapterOptions extends ProviderTelemetryOptions {
  /** OTLP/HTTP request headers (e.g. a collector's `Authorization`); any OTLP endpoint, no vendor-specific code. */
  headers?: Readonly<Record<string, string>>;
  /** Test seam: replace the OTLP batch pipeline with explicit SDK span processors. */
  spanProcessors?: SpanProcessor[];
  /** Test seam: explicit readers suppress the OTLP metrics pipeline, including an empty array. */
  metricReaders?: IMetricReader[] | undefined;
  /** Shared collector base; metrics keep their own route when tracing has an override. */
  endpoint?: string | undefined;
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
const LIMITS = { attributeValueLengthLimit: 1024, attributeCountLimit: 64 };
const SPAN_LIMITS = { ...LIMITS, linkCountLimit: 128, eventCountLimit: 128, attributePerEventCountLimit: 64, attributePerLinkCountLimit: 64 };

/** Shared SDK transport owner for both signals: explicit settings only, no OTEL_* credentials.
 * @returns An OTLP/HTTP JSON exporter. @complexity O(h) request headers, bounded SDK queue/timeout.
 */
function createInjectedOtlpExporter<T, Response>(
  { url, serializer, component, helper }: { url: string; serializer: ISerializer<T, Response>; component: string; helper: IExporterMetricsHelper<T> },
  { headers }: { headers?: Readonly<Record<string, string>> } = {},
): OTLPExporterBase<T> {
  const requestHeaders = { "Content-Type": "application/json", ...headers };
  return new OTLPExporterBase(createOtlpHttpExportDelegate({
    ...getSharedConfigurationDefaults(), url, headers: async () => ({ ...requestHeaders }),
    agentFactory: httpAgentFactoryFromOptions({ keepAlive: true }),
  }, serializer, component, helper, undefined));
}

/** OTLP/HTTP JSON trace exporter from injected settings only. */
export function createInjectedOtlpTraceExporter({ url }: { url: string }, options: { headers?: Readonly<Record<string, string>> } = {}): OTLPExporterBase<ReadableSpan[]> {
  return createInjectedOtlpExporter({ url, serializer: JsonTraceSerializer, component: OTLP_SPAN_EXPORTER_COMPONENT, helper: TraceExporterMetricsHelper }, options);
}

type SignalExporter<T> = Pick<OTLPExporterBase<T>, "export" | "shutdown" | "forceFlush">;
/** Observe the real trace/metric export callback before the SDK consumes failures for diagnostics.
 * @returns The same SDK exporter protocol; credentials and raw errors stay at the adapter edge.
 * @complexity O(1) around an export, independent of the batch size.
 */
export function createReportingExporter<T>(
  { exporter, reporter }: { exporter: SignalExporter<T>; reporter: ReturnType<typeof createProviderTelemetryReporter> }, _options = {},
): SignalExporter<T> {
  return {
    export(signal, callback) {
      let completed = false;
      try {
        exporter.export(signal, (result) => {
          completed = true;
          reporter.result({ phase: "export", outcome: result.code === 0 ? "ok" : "failed", error: result.error });
          // BatchSpanProcessor also forwards failures to the process-wide OTel diagnostic logger.
          // Keep the raw transport error out of that second, host-controlled reporting path too.
          callback(result.code === 0 ? result : { code: result.code, error: new Error("OpenTelemetry export failed") });
        });
      } catch (error) {
        if (completed) throw error;
        reporter.result({ phase: "export", outcome: "failed", error });
        // The batch processor's diagnostics may have a logger elsewhere in the host. Do not hand
        // that global path the raw transport error (which can contain the destination and headers).
        callback({ code: 1, error: new Error("OpenTelemetry export failed") });
      }
    },
    forceFlush: () => exporter.forceFlush(),
    shutdown: () => exporter.shutdown(),
  };
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
 * @param required The injected SDK tracer. @returns A structural tracer with explicit root/parent context.
 * @complexity O(1) per span.
 */
export function adaptTracer({ tracer }: { tracer: Tracer }, _options = {}): TracerPort {
  return {
    startSpan: ({ name, kind, attributes }, { parent } = {}) => {
      const parentSpan = parent ? sdkSpans.get(parent) : undefined;
      const context = parentSpan ? trace.setSpan(ROOT_CONTEXT, parentSpan) : ROOT_CONTEXT;
      return adaptSpan({ span: tracer.startSpan(name, { kind: SDK_SPAN_KINDS[kind], attributes }, context) });
    },
  };
}

/**
 * Creates structural SDK factories; no provider, exporter or background timer starts until invoked.
 * A host constructs its port once at boot, not per request.
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
  const exporterPipelines = new WeakMap<object, SignalExporter<ReadableSpan[]>>();
  return {
    shutdown: async () => { await Promise.all(providers.map((provider) => provider.shutdown())); },
    exporterFactory: {
      create: ({ endpoint }) => {
        if (options.spanProcessors !== undefined) return undefined;
        const exporter = createInjectedOtlpTraceExporter({ url: endpoint }, options);
        exporterPipelines.set(exporter, createReportingExporter({ exporter,
          reporter: createProviderTelemetryReporter({ endpoint }, options) }));
        return exporter;
      },
    },
    tracerProviderFactory: {
      create: ({ serviceName, exporter }) => {
        let spanProcessors = options.spanProcessors;
        if (spanProcessors === undefined) {
          // The diagnostics port treats exporters as opaque. Narrow at the SDK boundary rather
          // than casting an arbitrary port value into a live processor's exporter dependency.
          if (!(exporter instanceof OTLPExporterBase)) throw new TypeError("OpenTelemetry requires an OTLP trace exporter");
          // Factory callers can construct several exporters; retain each endpoint's own reporter.
          spanProcessors = [new BatchSpanProcessor(exporterPipelines.get(exporter) ?? exporter as OTLPExporterBase<ReadableSpan[]>, BATCH_DEFAULTS)];
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

/** Resolve the metrics signal independently of a trace-only route override.
 * @param required The resolved trace URL; the standard suffix preserves collector path prefixes.
 * @param options Shared collector base, when configured.
 * @returns The OTLP metrics URL; custom trace-only routes fall back to the origin's standard route.
 * @throws TypeError for an invalid fallback trace URL. @complexity O(u) URL length.
 */
export function resolveMetricsEndpoint(
  { tracesEndpoint }: { tracesEndpoint: string },
  { endpoint }: { endpoint?: string | undefined } = {},
): string {
  if (endpoint?.trim()) return `${endpoint.trim().replace(/\/+$/, "")}/v1/metrics`;
  if (/\/v1\/traces(?=[?#]|$)/.test(tracesEndpoint)) return tracesEndpoint.replace(/\/v1\/traces(?=[?#]|$)/, "/v1/metrics");
  return new URL("/v1/metrics", tracesEndpoint).href;
}

/** Creates the SDK-owned aggregation and periodic OTLP export pipeline from injected config only.
 * @returns A private provider; its shutdown flushes the reader and stops its timer.
 * @complexity O(h + r) headers and resource attributes at setup; SDK bounds series per instrument.
 */
function createMetricProvider({ config }: { config: ObservabilityConfigEnabled }, options: OtelAdapterOptions = {}): MeterProvider {
  const endpoint = resolveMetricsEndpoint({ tracesEndpoint: config.endpoint }, options);
  const readers = options.metricReaders ?? [new PeriodicExportingMetricReader({
    exporter: createReportingExporter({
      exporter: createInjectedOtlpExporter({
        url: endpoint, serializer: JsonMetricsSerializer, component: "otlp_http_metric_exporter", helper: MetricsExporterMetricsHelper,
      }, options),
      reporter: createProviderTelemetryReporter({ endpoint }, options),
    }),
    exportIntervalMillis: 60_000, exportTimeoutMillis: 30_000,
  })];
  return new MeterProvider({ resource: resourceFromAttributes({ ...options.resourceAttributes, [ATTR_SERVICE_NAME]: config.serviceName }), readers });
}

type Measurement = { meter: Meter; name: string; value: number; settings: { unit?: string }; attributes: ReturnType<typeof redactOperationAttributes> };
/** One recorder per kind (a table keeps `metric` under the complexity ceiling); the SDK returns the
 * instrument already registered under the same name. An unknown kind from an untyped caller throws,
 * which the fan-out contains. */
const RECORD_METRIC: Readonly<Record<NonNullable<MetricOptions["kind"]>, (measurement: Measurement) => void>> = {
  counter: ({ meter, name, value, settings, attributes }) => meter.createCounter(name, settings).add(value, attributes),
  gauge: ({ meter, name, value, settings, attributes }) => meter.createGauge(name, settings).record(value, attributes),
  histogram: ({ meter, name, value, settings, attributes }) => meter.createHistogram(name, settings).record(value, attributes),
};

/** Lazily owns one private SDK meter; the SDK reuses instruments and bounds attribute cardinality.
 * No global provider registration. Readers export cumulative counter sums, last-value gauges and histograms.
 * @param required Configured service identity and trace route.
 * @param options Same injected headers/resource as tracing; readers replace all metrics network I/O.
 * @returns A metric port and shutdown hook; no pipeline starts until the first measurement.
 * @complexity O(a) per measurement for a attribute text; storage belongs to SDK instruments/readers.
 */
function createMetrics({ config }: { config: ObservabilityConfigEnabled }, options: OtelAdapterOptions = {}): {
  metric: ObservabilityAdapter["port"]["metric"]; shutdown(): Promise<void>;
} {
  let provider: MeterProvider | undefined;
  let closed = false;
  return {
    metric({ name, value }: MetricInput, { kind = "gauge", unit, attributes = {} }: MetricOptions = {}) {
      if (closed || !Number.isFinite(value)) return;
      // Reject rather than truncate: distinct dynamic names must never alias one instrument.
      if (name.length > 255) return;
      provider ??= createMetricProvider({ config }, options);
      RECORD_METRIC[kind]({ meter: provider.getMeter(config.tracerName), name, value,
        settings: unit === undefined ? {} : { unit }, attributes: redactOperationAttributes({ attributes }) });
    },
    async shutdown() { closed = true; await provider?.shutdown(); },
  };
}

/**
 * The adapter plus its lifecycle (review 2026-10-25 #6): the host registers `dispose` with its own
 * teardown, so a closed site flushes and stops its provider.
 * @returns `{ port, dispose }`; `dispose` never throws.
 * @complexity O(1) setup.
 */
export function createOtelObservabilityAdapter({ config }: { config: ObservabilityConfigEnabled }, options: OtelAdapterOptions = {}): ObservabilityAdapter {
  const reporter = createProviderTelemetryReporter({ endpoint: config.endpoint }, options);
  const { shutdown, ...factories } = createOtelFactories({}, options);
  const metrics = createMetrics({ config }, options);
  const port = { ...createOtelObservabilityPort({ config, ...factories }, { scope: createAsyncLocalSpanScope({}) }), metric: metrics.metric, supportsMetric: true };
  reporter.initialized({ message: "OpenTelemetry exporting" });
  return { port, dispose: async () => {
    try { await Promise.all([shutdown(), metrics.shutdown()]); reporter.result({ phase: "shutdown", outcome: "ok" }); }
    catch (error) { reporter.result({ phase: "shutdown", outcome: "failed", error }); /* teardown is best-effort */ }
  } };
}
