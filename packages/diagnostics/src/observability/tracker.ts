import { isNoopProductAnalytics } from "@jini-ai/analytics/product";
import type { AgentRunTrackingOutcome, OperationTrackingOutcome, RequestTrackingOutcome, TrackerScope } from "./ports.js";
import type { AgentSpanOptions, OperationSpanOptions, RequestSpanOptions, Tracker, TrackerErrorContext, TrackerOptions, TrackerProviders, TrackerSpan } from "./tracker-types.js";
import { createNoopTracker } from "./tracker-noop.js";
import { isNoopObservabilityPort } from "./noop.js";
import { combineObservabilityPorts } from "./fanout.js";
import { reportErrorOnce, redactedError } from "./report-error.js";

type SpanOutcome = OperationTrackingOutcome | RequestTrackingOutcome | AgentRunTrackingOutcome;
type SpanOptions = OperationSpanOptions | RequestSpanOptions | AgentSpanOptions;
type Lifecycle = Partial<TrackerScope> & { end(outcome: SpanOutcome): void };

/** Fixed diagnostic, once per facade; provider errors can contain credentials and are never logged.
 * @complexity O(1) time/space. */
export function createTrackerWarning(_required: Record<string, never>, { warn = (message) => console.warn(message) }: TrackerOptions = {}): () => void {
  let reported = false;
  return () => {
    if (reported) return;
    reported = true;
    try { warn("[tracker] a telemetry provider failed; application work continues"); } catch { /* Logging must not fail application work either. */ }
  };
}

/** Select the existing lifecycle owner; overloads keep request/agent outcomes typed at callers.
 * @complexity O(1) around the injected port. */
function startSpan({ observability, name, options }: { observability: NonNullable<TrackerProviders["observability"]>; name: string; options: SpanOptions }): Lifecycle {
  if ("request" in options) return observability.trackRequest({ method: options.request.method, path: options.request.path }, options.request.requestId === undefined ? {} : { requestId: options.request.requestId }) as Lifecycle;
  if ("agent" in options) return observability.trackAgentRun({ runId: options.agent.runId }, {
    ...(options.agent.conversationId === undefined ? {} : { conversationId: options.agent.conversationId }),
    ...(options.agent.agentName === undefined ? {} : { agentName: options.agent.agentName }),
  }) as Lifecycle;
  return observability.trackOperation({ name, ...(options.attributes ? { attributes: options.attributes } : {}) }) as Lifecycle;
}

/** Choose the lifecycle's typed default or failure outcome. @complexity O(1). */
function spanOutcome({ options, failure }: { options: SpanOptions; failure?: { error: unknown } }): SpanOutcome {
  if ("request" in options) return { statusCode: 500, routePattern: "unmatched" };
  if ("agent" in options) return failure ? { status: "failed", error: failure.error } : { status: "succeeded" };
  return { outcome: failure ? "error" : "completed", failed: failure !== undefined };
}

/** One facade over existing ports: consent/identity remain on the composed providers, error
 * deduplication/redaction stays with reportErrorOnce, scope containment stays with fanout.
 * Missing providers do nothing; spans still run work exactly once and preserve its result/error.
 * @param required Optional, already-composed providers; an empty object disables telemetry.
 * @param optional A warning sink, called once with a fixed message on any provider failure.
 * @complexity O(1) facade state; delivery/redaction costs remain with the existing ports.
 */
export function createTracker(required: TrackerProviders, optional: TrackerOptions = {}): Tracker {
  if ((!required.observability || isNoopObservabilityPort(required.observability)) && (!required.productAnalytics || isNoopProductAnalytics(required.productAnalytics))) return createNoopTracker({});
  const failed = createTrackerWarning({}, optional);
  const observability = combineObservabilityPorts({ ports: required.observability ? [required.observability] : [] }, { onFailure: failed });
  const error = (failure: Error, context: TrackerErrorContext = {}): void => {
    try {
      const attributes = context.route ? { ...context.attributes, route: context.route } : context.attributes;
      reportErrorOnce({ observability, error: failure, operation: context.operation ?? "application.error" }, {
        ...(attributes ? { attributes } : {}), exactSecrets: context.exactSecrets, level: context.level,
      });
    } catch { failed(); }
  };
  async function span<T>(name: string, work: (span: TrackerSpan<SpanOutcome>) => T | Promise<T>, options: SpanOptions = {}): Promise<T> {
    const lifecycle = startSpan({ observability, name, options });
    let outcome: SpanOutcome | undefined;
    const handle: TrackerSpan<SpanOutcome> = { setOutcome: (value) => { outcome ??= value; } };
    const run = <R>(fn: () => R): R => lifecycle.run ? lifecycle.run(fn) : fn();
    try {
      return await run(() => work(handle));
    } catch (failure) {
      run(() => error(failure instanceof Error ? failure : redactedError({ error: failure }), { operation: name }));
      outcome ??= spanOutcome({ options, failure: { error: failure } });
      throw failure;
    } finally {
      // Request callbacks normally settle with their response outcome, including disconnects.
      lifecycle.end(outcome ?? spanOutcome({ options }));
    }
  }
  return {
    capture(event) { try { return Promise.resolve(required.productAnalytics?.capture(event)).catch(failed); } catch { failed(); } },
    error,
    span: span as Tracker["span"],
  };
}
