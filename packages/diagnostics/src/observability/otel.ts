import type { ObservabilityConfigEnabled } from './config.js';
import type { AgentRunStatus, ExporterFactory, TracerProviderFactory, ObservabilityPort, SpanScopePort, TraceSpanKind, TraceSpanPort, TracerPort } from './ports.js';
import { redactSecretShapes } from '../core/secrets-only.js';
export interface OtelAdapterDependencies {
 config: ObservabilityConfigEnabled; exporterFactory: ExporterFactory; tracerProviderFactory: TracerProviderFactory;
}
export interface OtelAdapterOptions { scope?: SpanScopePort; }
type Attributes = Record<string, string | number>;

/** A low-cardinality error label: a SCREAMING_CASE code (ECONNREFUSED, SQLITE_BUSY), else the class
 * name. Messages are never exported: they carry SQL fragments, hostnames, emails, even credentials.
 * Both `error.code` and `Error.name` are writable secret channels (review 2026-10-25 #2):
 * select the label, then redact and cap it
 * to {@link MAX_ERROR_TYPE} (redact first: a cut could leave a secret prefix too short to match). */
export function errorType(error: unknown): string {
 const code = (error as { code?: unknown } | null)?.code;
 const label = typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)
  ? code : error instanceof Error ? String(error.name) : typeof error;
 return redactLabel(label).slice(0, MAX_ERROR_TYPE) || 'Error';
}

const MAX_ERROR_TYPE = 64;
const MAX_ATTRIBUTE_TEXT = 256;

function redactLabel(text: string): string {
 return redactSecretShapes({ text, policy: {} }).text;
}

/** Feature attributes are documented as ids and fixed labels, but a caller can still hand over a
 * secret-shaped value (an unknown tool id straight from a request, review #1). Every string is
 * redacted and capped before any SDK sees it; numbers pass. Every adapter applies this, so one careless
 * call site cannot leak through one vendor.
 * @param required The caller's attributes. @returns A fresh, redacted copy. @complexity O(total text). */
export function redactOperationAttributes({ attributes }: { attributes: Readonly<Record<string, string | number>> }): Attributes {
 const safe: Attributes = {};
 for (const [name, value] of Object.entries(attributes)) safe[name] = typeof value === 'string' ? redactLabel(value).slice(0, MAX_ATTRIBUTE_TEXT) : value;
 return safe;
}

/** Query and fragment are dropped (tokens ride there most often); secret-shaped path values are
 * blanked. Ids stay: an operator searches by them, and a route pattern alone cannot name a record. */
export function redactRequestTarget(path: string): string {
 return redactSecretShapes({ text: path.replace(/[?#][\s\S]*$/, ''), policy: {} }).text;
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
 return (outcome) => { if (ended) return; ended = true; handler(outcome); };
}

/** Sets attributes, then the error label, status and exception event (type only), then ends. */
function finish({ span, attributes }: { span: TraceSpanPort; attributes: Attributes }, { failure, error }: { failure?: string; error?: unknown } = {}): void {
 for (const [name, value] of Object.entries(attributes)) span.setAttribute({ name, value });
 if (failure !== undefined) {
  span.setAttribute({ name: 'error.type', value: failure });
  span.setStatus({ code: 'error', description: failure });
  if (error !== undefined) span.addEvent({ name: 'exception', attributes: { 'exception.type': failure } });
 }
 span.end({});
}

/** Builds request, DB, outbound, agent-run and operation spans, and exception events for reported errors, through injected provider/exporter factories.
 * @param required Explicit config and structural factories. Hosts wrap their SDK here.
 * @param options Optional host scope storage; with it, spans started inside a tracker's run() are its children.
 * @returns One adapter whose spans end once, with final names, redacted attributes and error status.
 * @throws Provider/exporter errors propagate during setup. No globals or SDK imports are used.
 */
export function createOtelObservabilityPort({ config, exporterFactory, tracerProviderFactory }: OtelAdapterDependencies, { scope }: OtelAdapterOptions = {}): ObservabilityPort {
 const exporter = exporterFactory.create({ endpoint: config.endpoint });
 const provider = tracerProviderFactory.create({ serviceName: config.serviceName, exporter });
 const tracer: TracerPort = provider.getTracer({ name: config.tracerName });

 function start({ name, kind, attributes }: { name: string; kind: TraceSpanKind; attributes: Attributes }, { root = false }: { root?: boolean } = {}): TraceSpanPort {
  const parent = root ? undefined : scope?.active();
  return tracer.startSpan({ name, kind, attributes }, parent ? { parent } : {});
 }
 function runIn(span: TraceSpanPort) {
  return <T>(fn: () => T): T => (scope ? scope.run({ span, fn }) : fn());
 }

 return {
  trackRequest(input, { requestId } = {}) {
   // The id the response echoes is recorded on the span, so a reported id finds its trace.
   const span = start({ name: input.method, kind: 'server', attributes: {
    'http.method': input.method, 'http.target': redactRequestTarget(input.path), ...(requestId ? { 'http.request.id': requestId } : {}),
   } });
   return { ...(requestId ? { requestId } : {}), run: runIn(span), end: once((outcome) => {
    // Routing finishes after startSpan, so open with a provisional name and assign the final
    // pattern at end. The consumer port needs no separate rename operation to express that timing.
    span.updateName({ name: `${input.method} ${outcome.routePattern}` });
    span.setAttribute({ name: 'http.route', value: outcome.routePattern });
    span.setAttribute({ name: 'http.status_code', value: outcome.statusCode });
    if (outcome.statusCode >= 500) span.setStatus({ code: 'error' });
    span.end({});
   }) };
  },
  trackDbQuery({ system }) {
   const span = start({ name: 'db', kind: 'client', attributes: { 'db.system.name': system } });
   return { run: runIn(span), end: once(({ operation, table, error }) => {
    // Same provisional-name timing as requests: the query is built inside the tracked body.
    const op = operation.toUpperCase();
    span.updateName({ name: table ? `${op} ${table}` : op });
    finish({ span, attributes: { 'db.operation.name': op, ...(table ? { 'db.collection.name': table } : {}) } },
     error !== undefined ? { failure: errorType(error), error } : {});
   }) };
  },
  trackOutboundCall({ method, url }) {
   const target = outboundTargetAttributes(url);
   const span = start({ name: `${method} ${target['server.address']}`, kind: 'client', attributes: { 'http.request.method': method, ...target } });
   return { run: runIn(span), end: once(({ statusCode, error }) => {
    const attributes = statusCode !== undefined ? { 'http.response.status_code': statusCode } : {};
    if (error !== undefined) return finish({ span, attributes }, { failure: errorType(error), error });
    // Client-span semantics: a 4xx is this caller's failure, unlike a server span's 4xx.
    finish({ span, attributes }, statusCode !== undefined && statusCode >= 400 ? { failure: String(statusCode) } : {});
   }) };
  },
  trackOperation({ name, attributes = {} }) {
   const span = start({ name, kind: 'internal', attributes: redactOperationAttributes({ attributes }) });
   return { run: runIn(span), end: once(({ outcome, failed, attributes: settled = {} }) => {
    // The feature decides what counts as failure; its outcome label doubles as the error type.
    finish({ span, attributes: redactOperationAttributes({ attributes: { ...settled, 'operation.outcome': outcome } }) }, failed ? { failure: redactLabel(outcome) } : {});
   }) };
  },
  reportError({ error, context }) {
   try {
    // Inside a tracker's run() the exception lands on that tracker's span; elsewhere it is its own
    // short root span. Type only, never the message: the same export rule errorType documents.
    const active = scope?.active();
    const span = active ?? start({ name: `error ${context.operation}`, kind: 'internal', attributes: redactOperationAttributes({ attributes: context.attributes ?? {} }) }, { root: true });
    const type = errorType(error);
    span.addEvent({ name: 'exception', attributes: { 'exception.type': type, 'operation.name': context.operation } });
    span.setStatus({ code: 'error', description: type });
    if (!active) span.end({});
   } catch {
    // Reporting is best-effort: a broken exporter must not turn an already-handled failure into a crash.
   }
  },
  trackAgentRun({ runId }, { conversationId, agentName } = {}) {
   // A run outlives the request that started it, so it is its own trace rather than a long child.
   const span = start({ name: agentName ? `invoke_agent ${agentName}` : 'invoke_agent', kind: 'internal', attributes: {
    'gen_ai.operation.name': 'invoke_agent', ...(agentName ? { 'gen_ai.agent.name': agentName } : {}),
    ...(conversationId ? { 'gen_ai.conversation.id': conversationId } : {}), 'agent.run.id': runId,
   } }, { root: true });
   return { run: runIn(span), end: once(({ status, error }) => {
    const attributes = { 'agent.run.status': status };
    if (error !== undefined) return finish({ span, attributes }, { failure: errorType(error), error });
    finish({ span, attributes }, FAILED_RUN_STATUSES.has(status) ? { failure: status } : {});
   }) };
  },
 };
}
