/** What a real host binds for the observability providers: diagnostics' own helpers, exactly as its provider contract registers them. */
import { observabilityProviderContract } from "@jini-ai/diagnostics/observability";
import { createAsyncLocalSpanScope } from "@jini-ai/diagnostics/observability/node";

export const OBSERVABILITY_CONTEXT = observabilityProviderContract.context;
export const hostScope = () => createAsyncLocalSpanScope({});
export const describeTelemetryFailure = OBSERVABILITY_CONTEXT.describeTelemetryFailure;

/** The factory's `optional` argument as a real host builds it: the domain's context, the span scope and the telemetry classifier, then the test's own options. */
export const withHost = (optional: Readonly<Record<string, unknown>> = {}): Record<string, unknown> =>
  ({ context: OBSERVABILITY_CONTEXT, scope: hostScope(), describeTelemetryFailure, ...optional });
