/**
 * @file The Sentry adapter for diagnostics' `ObservabilityPort`, shipped as the
 * `observability-sentry` provider plugin — the only module in this distribution's Sentry artifact
 * that imports `@sentry/*` (bundled; no runtime peer). Moved out of the first host application's
 * core (its `platform/observability/sentry.ts`) and then out of `@jini-ai/diagnostics`
 * (its former `./observability/sentry` subpath) on 2026-10-25 by owner decision, the same as the
 * OpenTelemetry plugin, and selected the same way (see its header): a host loads this plugin only
 * when it is installed, enabled and configured with a DSN, so an install without Sentry never loads
 * the SDK (measured 2026-10-25: ~465 ms, +40 MB RSS when loaded).
 *
 * Sentry is an error tracker, not a tracing backend: this adapter maps the two feature-level signals
 * (`trackOperation` → a Sentry span, a transaction when it is a root; `reportError` →
 * `captureException`) and leaves request/DB/outbound/agent-run signals to the OpenTelemetry adapter
 * (no-op here). When both are configured, the host fans out to both (diagnostics' fan-out).
 *
 * PROCESS-WIDE STATE IS THE HOST'S, never this adapter's (review 2026-10-25 #5):
 * - Never `Sentry.init()`: init installs a process-wide client and default integrations (global
 *   handlers, auto-instrumentation) — the same "never take over process-wide registration" rule
 *   the OpenTelemetry plugin follows for the tracer provider.
 * - Never `NodeClient#init()` either: in @sentry/node 11.6.0 it selects Sentry's AsyncLocalStorage
 *   (or OTel) async-context strategy for the WHOLE process, which would replace a strategy a host
 *   that already uses Sentry chose. Without it the client still sends (measured: transactions and
 *   exception events reach the transport); scopes fall back to whatever strategy the host set, and
 *   this adapter carries its own parent span in its own AsyncLocalStorage.
 * - `enableRuntimeChannelInjection: false`: the NodeClient constructor otherwise registers
 *   diagnostics-channel hooks for auto-instrumentation, process-wide.
 * - A host that already initialized Sentry passes its own client (`options.client`): it is reused,
 *   never re-configured, and `dispose` leaves it open (the host owns it).
 *
 * Independent operations start a FRESH trace (review #4): a root operation runs inside
 * `startNewTrace`, so two unrelated tool calls never share the ambient scope's trace id; a nested
 * operation is parented explicitly on its enclosing operation's span.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { NodeClient, captureException, defaultStackParser, makeNodeTransport, startInactiveSpan, startNewTrace, withActiveSpan, withScope, type NodeOptions, type Span } from "@sentry/node";
import { createNoopObservabilityPort, describeReportedError, redactOperationAttributes, type ObservabilityAdapter } from "@jini-ai/diagnostics/observability";

export interface SentryConfigEnabled {
  enabled: true; dsn: string; environment?: string; tracesSampleRate: number;
  /** Set on the scope of every signal (exceptions and transactions): the host's site attribution. */
  tags?: Readonly<Record<string, string>>;
}

/** The client slice this adapter uses; a host's own `NodeClient` satisfies it. */
export type SentryClient = Pick<NodeClient, "close" | "getOptions">;

export interface SentryAdapterOptions {
  /** Test seam: a transport that records envelopes instead of sending them. */
  transport?: NodeOptions["transport"];
  /** A client the host already initialized: reused as-is, never closed by `dispose`. */
  client?: SentryClient;
}

// Sentry span status codes: 1 ok, 2 error (`@sentry/core` SPAN_STATUS_*).
const SPAN_STATUS_OK = 1;
const SPAN_STATUS_ERROR = 2;

/** The redacted error an error tracker may see: type, capped message and stack with secret shapes blanked. */
function sanitizedError(error: unknown): Error {
  const { type, message, stack } = describeReportedError({ error });
  const sanitized = new Error(message);
  sanitized.name = type;
  sanitized.stack = stack ?? `${type}: ${message}`;
  return sanitized;
}

function privateClient({ config }: { config: SentryConfigEnabled }, { transport }: { transport?: NodeOptions["transport"] | undefined }): NodeClient {
  return new NodeClient({
    dsn: config.dsn, environment: config.environment, tracesSampleRate: config.tracesSampleRate,
    // No default integrations: they patch globals. Collect nothing personal (Sentry 11's successor to
    // sendDefaultPii): no user/IP, cookies, headers, query strings, bodies or local variable values.
    integrations: [], stackParser: defaultStackParser, transport: transport ?? makeNodeTransport,
    enableRuntimeChannelInjection: false,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false, httpBodies: [], stackFrameVariables: false },
  });
}

/**
 * Builds the Sentry-backed port over one client, plus its teardown.
 * @param required Enabled Sentry configuration (DSN, environment, traces sample rate).
 * @param options Optional transport override for tests; optional host-owned client to reuse.
 * @returns `{ port, dispose }`: operations become Sentry spans and error reports become events;
 *   `dispose` closes a private client (removing the SDK's `beforeExit` listeners) and never throws.
 * @throws SDK construction errors (an invalid DSN) during setup.
 * @complexity O(1) per signal, excluding the SDK's own buffered send.
 */
export function createSentryObservabilityAdapter({ config }: { config: SentryConfigEnabled }, options: SentryAdapterOptions = {}): ObservabilityAdapter {
  const owned = options.client === undefined;
  const client = (options.client ?? privateClient({ config }, { transport: options.transport })) as NodeClient;
  const active = new AsyncLocalStorage<Span>();
  // A span keeps the scope it started in, so tags set here reach its transaction as well as exceptions.
  const inClient = <T>(fn: () => T): T => withScope((scope) => { scope.setClient(client); scope.setTags(config.tags ?? {}); return fn(); });
  const port: ObservabilityAdapter["port"] = {
    ...createNoopObservabilityPort({}),
    trackOperation({ name, attributes = {} }) {
      const parentSpan = active.getStore();
      const safe = redactOperationAttributes({ attributes });
      const span = inClient(() => (parentSpan
        ? startInactiveSpan({ name, op: name, attributes: safe, parentSpan })
        : startNewTrace(() => startInactiveSpan({ name, op: name, attributes: safe, forceTransaction: true }))));
      let ended = false;
      return {
        run: (fn) => active.run(span, fn),
        end({ outcome, failed, attributes: settled = {} }) {
          if (ended) return; ended = true;
          span.setAttributes(redactOperationAttributes({ attributes: { ...settled, "operation.outcome": outcome } }));
          span.setStatus(failed ? { code: SPAN_STATUS_ERROR, message: outcome } : { code: SPAN_STATUS_OK });
          span.end();
        },
      };
    },
    reportError({ error, context }) {
      try {
        const span = active.getStore();
        const capture = () => captureException(sanitizedError(error), { tags: { operation: context.operation }, contexts: { operation: redactOperationAttributes({ attributes: context.attributes ?? {} }) } });
        inClient(() => (span ? withActiveSpan(span, capture) : capture()));
      } catch {
        // Best-effort, as in every adapter: a broken SDK must not turn a handled failure into a crash.
      }
    },
  };
  return { port, dispose: async () => { if (!owned) return; try { await client.close(2_000); } catch { /* best-effort */ } } };
}
