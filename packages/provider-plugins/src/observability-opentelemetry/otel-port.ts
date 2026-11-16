/** The OpenTelemetry semantic-convention mapping for the observability port: spans, attributes and
 * exception events over injected, OTel-shaped factory ports. Vendor code lives in its provider, so the
 * vendor-neutral port package never names OTel. */
import type {
 AgentRunStatus, ExporterFactory, ObservabilityConfigEnabled, ObservabilityHelpers, ObservabilityPort, SpanScopePort,
 TraceSpanKind, TraceSpanPort, TracerPort, TracerProviderFactory,
} from './contract.js';


export type { ExporterFactory, TraceSpanKind, TracerPort, TracerProviderFactory } from './contract.js';
export interface OtelAdapterDependencies {
 config: ObservabilityConfigEnabled; exporterFactory: ExporterFactory; tracerProviderFactory: TracerProviderFactory;
}
export interface OtelAdapterOptions { scope?: SpanScopePort; helpers: ObservabilityHelpers; }
type Attributes = Record<string, string | number>;

/** Decode before classifying; malformed encodings and non-label segments fail closed.
 * Only short alphabetic route words survive; ids, emails and opaque tokens become placeholders.
 * @returns A safe path segment. @complexity O(s) segment text.
 */
function safePathSegment({ segment }: { segment: string }, _options = {}): string {
 let decoded: string;
 try { decoded = decodeURIComponent(segment); } catch { return ':param'; }
 if (decoded === '') return '';
 if (!/^[a-zA-Z-]{1,24}$/.test(decoded)) return ':param';
 if (/^[a-fA-F]{8,}$/.test(decoded) || decoded.length >= 16) return ':param';
 return decoded;
}

/** Prefer a router-owned template. Otherwise drop query/fragment and replace sensitive-looking
 * segments; raw ids no longer cross the export boundary (correlation belongs on explicit ids).
 * @returns A bounded request target. @complexity O(p) path text.
 */
/** Cuts at the first `?` or `#`, as /[?#][\s\S]*$/ did, without its backtracking. */
function withoutQueryOrFragment(target: string): string {
 const cut = target.search(/[?#]/);
 return cut === -1 ? target : target.slice(0, cut);
}
export function redactRequestTarget({ path }: { path: string }, { routePattern }: { routePattern?: string } = {}): string {
 if (routePattern && routePattern !== 'unmatched') return withoutQueryOrFragment(routePattern).slice(0, 1024);
 return withoutQueryOrFragment(path).split('/').map(segment => safePathSegment({ segment })).join('/').slice(0, 1024);
}

/** Scheme, host and explicit port only. Paths carry bot tokens and signed-URL keys; userinfo carries passwords. */
export function outboundTargetAttributes(url: string): Attributes {
 let parsed: URL;
 try { parsed = new URL(url); } catch { return { 'server.address': 'invalid-url' }; }
 return {
  'url.scheme': parsed.protocol.replace(/:$/, ''), 'server.address': parsed.hostname,
  ...(parsed.port ? { 'server.port': Number(parsed.port) } : {}),
 };
}

// Interrupted means the run died with its process; canceled and abandoned are not proven failures.
const FAILED_RUN_STATUSES: ReadonlySet<AgentRunStatus> = new Set(['failed', 'interrupted']);

/** Wraps an end handler so a second end() is ignored. */
function once<O>(handler: (outcome: O) => void): (outcome: O) => void {
 let ended = false;
 return (outcome) => {
  if (ended) return;
  ended = true;
  handler(outcome);
 };
}

interface OtelCtx {
 readonly tracer: TracerPort; readonly scope: SpanScopePort | undefined; readonly helpers: ObservabilityHelpers; readonly reportedSpans: WeakSet<TraceSpanPort>;
}

/** Sets final attributes and ends, preserving an exception already recorded by reportError.
 * Sink errors propagate to the caller. @complexity O(a) time/space for a attributes. */
function finish({ ctx, span, attributes }: { ctx: OtelCtx; span: TraceSpanPort; attributes: Attributes }, { failure, error }: { failure?: string; error?: unknown } = {}): void {
 for (const [name, value] of Object.entries(attributes)) span.setAttribute({ name, value });
 if (failure !== undefined && !ctx.reportedSpans.has(span)) {
  span.setAttribute({ name: 'error.type', value: failure });
  span.setStatus({ code: 'error', description: failure });
  if (error !== undefined) span.addEvent({ name: 'exception', attributes: { 'exception.type': failure } });
 }
 span.end({});
}

/** Finishes with the error's type when one is present, else with an optional soft failure label. */
function finishWithOutcome({ ctx, span, attributes }: { ctx: OtelCtx; span: TraceSpanPort; attributes: Attributes }, { error, softFailure }: { error?: unknown; softFailure?: string } = {}): void {
 if (error !== undefined) {
  finish({ ctx, span, attributes }, { failure: ctx.helpers.errorType({ error }), error });
  return;
 }
 finish({ ctx, span, attributes }, softFailure !== undefined ? { failure: softFailure } : {});
}

function start({ ctx, name, kind, attributes }: { ctx: OtelCtx; name: string; kind: TraceSpanKind; attributes: Attributes }, { root = false }: { root?: boolean } = {}): TraceSpanPort {
 const parent = root ? undefined : ctx.scope?.active();
 return ctx.tracer.startSpan({ name, kind, attributes }, parent ? { parent } : {});
}

function runIn({ ctx, span }: { ctx: OtelCtx; span: TraceSpanPort }) {
 return <T>(fn: () => T): T => (ctx.scope ? ctx.scope.run({ span, fn }) : fn());
}

type RequestInput = Parameters<ObservabilityPort['trackRequest']>[0];
type RequestEnd = Parameters<ReturnType<ObservabilityPort['trackRequest']>['end']>[0];

function trackRequest({ ctx, input, requestId }: { ctx: OtelCtx; input: RequestInput; requestId?: string }): ReturnType<ObservabilityPort['trackRequest']> {
 // The id the response echoes is recorded on the span, so a reported id finds its trace.
 const span = start({ ctx, name: input.method, kind: 'server', attributes: {
  'http.method': input.method, 'http.target': redactRequestTarget({ path: input.path }), ...(requestId ? { 'http.request.id': requestId } : {}),
 } });
 return { ...(requestId ? { requestId } : {}), run: runIn({ ctx, span }), end: once((outcome: RequestEnd) => {
  // Routing finishes after startSpan, so open with a provisional name and assign the final
  // pattern at end. The consumer port needs no separate rename operation to express that timing.
  span.updateName({ name: `${input.method} ${outcome.routePattern}` });
  span.setAttribute({ name: 'http.route', value: outcome.routePattern });
  span.setAttribute({ name: 'http.target', value: redactRequestTarget({ path: input.path }, { routePattern: outcome.routePattern }) });
  span.setAttribute({ name: 'http.status_code', value: outcome.statusCode });
  if (outcome.statusCode >= 500 && !ctx.reportedSpans.has(span)) span.setStatus({ code: 'error' });
  span.end({});
 }) };
}

function trackDbQuery({ ctx, system }: { ctx: OtelCtx; system: string }): ReturnType<ObservabilityPort['trackDbQuery']> {
 const span = start({ ctx, name: 'db', kind: 'client', attributes: { 'db.system.name': system } });
 return { run: runIn({ ctx, span }), end: once(({ operation, table, error }) => {
  // Same provisional-name timing as requests: the query is built inside the tracked body.
  const op = operation.toUpperCase();
  span.updateName({ name: table ? `${op} ${table}` : op });
  finishWithOutcome({ ctx, span, attributes: { 'db.operation.name': op, ...(table ? { 'db.collection.name': table } : {}) } }, { error });
 }) };
}

function trackOutboundCall({ ctx, method, url }: { ctx: OtelCtx; method: string; url: string }): ReturnType<ObservabilityPort['trackOutboundCall']> {
 const target = outboundTargetAttributes(url);
 const span = start({ ctx, name: `${method} ${target['server.address']}`, kind: 'client', attributes: { 'http.request.method': method, ...target } });
 return { run: runIn({ ctx, span }), end: once(({ statusCode, error }) => {
  const attributes = statusCode !== undefined ? { 'http.response.status_code': statusCode } : {};
  // Client-span semantics: a 4xx is this caller's failure, unlike a server span's 4xx.
  finishWithOutcome({ ctx, span, attributes }, { error, ...(statusCode !== undefined && statusCode >= 400 ? { softFailure: String(statusCode) } : {}) });
 }) };
}

function trackOperation({ ctx, name, attributes = {} }: { ctx: OtelCtx; name: string; attributes?: Attributes }): ReturnType<ObservabilityPort['trackOperation']> {
 const { redactOperationAttributes, redactLabel } = ctx.helpers;
 const span = start({ ctx, name, kind: 'internal', attributes: redactOperationAttributes({ attributes }) });
 return { run: runIn({ ctx, span }), end: once(({ outcome, failed, attributes: settled = {} }) => {
  // The feature decides what counts as failure; its outcome label doubles as the error type.
  finish({ ctx, span, attributes: redactOperationAttributes({ attributes: { ...settled, 'operation.outcome': outcome } }) }, failed ? { failure: redactLabel({ text: outcome }) } : {});
 }) };
}

function reportError({ ctx, error, context }: { ctx: OtelCtx; error: unknown; context: Parameters<ObservabilityPort['reportError']>[0]['context'] }): boolean {
 const { errorType, redactOperationAttributes } = ctx.helpers;
 try {
  // Inside a tracker's run() the exception lands on that tracker's span; elsewhere it is its own
  // short root span. Type only, never the message: the same export rule errorType documents.
  const active = ctx.scope?.active();
  const span = active ?? start({ ctx, name: `error ${context.operation}`, kind: 'internal', attributes: redactOperationAttributes({ attributes: context.attributes ?? {} }) }, { root: true });
  const type = errorType({ error });
  span.addEvent({ name: 'exception', attributes: { 'exception.type': type, 'operation.name': context.operation } });
  span.setAttribute({ name: 'error.type', value: type });
  span.setStatus({ code: 'error', description: type });
  ctx.reportedSpans.add(span);
  if (!active) span.end({});
  return true;
 } catch {
  // Reporting is best-effort: a broken exporter must not turn an already-handled failure into a crash.
  return false;
 }
}

function trackAgentRun({ ctx, runId, conversationId, agentName }: { ctx: OtelCtx; runId: string; conversationId?: string; agentName?: string }): ReturnType<ObservabilityPort['trackAgentRun']> {
 // A run outlives the request that started it, so it is its own trace rather than a long child.
 const span = start({ ctx, name: agentName ? `invoke_agent ${agentName}` : 'invoke_agent', kind: 'internal', attributes: {
  'gen_ai.operation.name': 'invoke_agent', ...(agentName ? { 'gen_ai.agent.name': agentName } : {}),
  ...(conversationId ? { 'gen_ai.conversation.id': conversationId } : {}), 'agent.run.id': runId,
 } }, { root: true });
 return { run: runIn({ ctx, span }), end: once(({ status, error }) => {
  finishWithOutcome({ ctx, span, attributes: { 'agent.run.status': status } }, { error, ...(FAILED_RUN_STATUSES.has(status) ? { softFailure: status } : {}) });
 }) };
}

/** Builds request, DB, outbound, agent-run and operation spans, and exception events for reported errors, through injected provider/exporter factories.
 * @param required Explicit config and structural factories. Hosts wrap their SDK here.
 * @param options Domain helpers (redaction and error labels, handed over as the factory context) and optional host scope storage; with it, spans started inside a tracker's run() are its children.
 * @returns One adapter whose spans end once, with final names, redacted attributes and error status.
 * @throws Provider/exporter errors propagate during setup. No globals or SDK imports are used.
 */
export function createOtelObservabilityPort({ config, exporterFactory, tracerProviderFactory }: OtelAdapterDependencies, { scope, helpers }: OtelAdapterOptions): ObservabilityPort {
 const exporter = exporterFactory.create({ endpoint: config.endpoint });
 const provider = tracerProviderFactory.create({ serviceName: config.serviceName, exporter });
 const ctx: OtelCtx = { tracer: provider.getTracer({ name: config.tracerName }), scope, helpers, reportedSpans: new WeakSet<TraceSpanPort>() };
 return {
  supportsMetric: false,
  activeTraceIds: (_required = {}, _optional = {}) => scope?.active()?.ids?.(),
  // This structural tracing adapter has no metrics exporter; the provider plugin supplies it.
  metric() {},
  trackRequest: (input, { requestId } = {}) => trackRequest({ ctx, input, ...(requestId ? { requestId } : {}) }),
  trackDbQuery: ({ system }) => trackDbQuery({ ctx, system }),
  trackOutboundCall: ({ method, url }) => trackOutboundCall({ ctx, method, url }),
  trackOperation: ({ name, attributes }) => trackOperation({ ctx, name, ...(attributes ? { attributes } : {}) }),
  reportError: ({ error, context }) => reportError({ ctx, error, context }),
  trackAgentRun: ({ runId }, { conversationId, agentName } = {}) => trackAgentRun({ ctx, runId, ...(conversationId ? { conversationId } : {}), ...(agentName ? { agentName } : {}) }),
 };
}
