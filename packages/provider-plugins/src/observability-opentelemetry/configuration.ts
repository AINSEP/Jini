import type { SpanScopePort, ObservabilityProviderContext } from "./contract.js";

const HELPERS = ["redactOperationAttributes", "errorType", "redactLabel", "describeReportedError", "describeTelemetryFailure", "resolveObservabilityConfig"] as const;

/** A host registered the observability contract without what the provider needs. Plain words; `details` is what Copy details shows. */
export class OpenTelemetryProviderConfigError extends Error {
  readonly code = "observability_opentelemetry_context_missing" as const;
  readonly details: string;
  constructor(required: { details: string }, _optional: Record<string, never> = {}) {
    super("The OpenTelemetry exporter was started without the redaction helpers it needs, so it will not send anything. Restart the app; if this keeps happening, copy the details into a bug report.");
    this.name = "OpenTelemetryProviderConfigError";
    this.details = required.details;
  }
}

/**
 * Reads, at initialize and never at the first span, what the host binds: diagnostics' helpers as `optional.context`
 * and the active-span scope as `optional.scope`. A redaction helper is required: a missing binding fails here
 * instead of silently exporting unredacted attributes.
 * @returns The helpers and the scope, by reference.
 * @throws OpenTelemetryProviderConfigError naming each helper that is absent or not a function, and a missing scope.
 */
export function readOpenTelemetryHost({ context, scope }: { context: unknown; scope: unknown }, _optional: Record<string, never> = {}): { context: ObservabilityProviderContext; scope: SpanScopePort } {
  const record = context !== null && typeof context === "object" ? context as Record<string, unknown> : {};
  const missing: string[] = HELPERS.filter(name => typeof record[name] !== "function");
  const scopeRecord = scope !== null && typeof scope === "object" ? scope as Record<string, unknown> : {};
  if (typeof scopeRecord.active !== "function" || typeof scopeRecord.run !== "function") missing.push("scope");
  if (missing.length > 0) throw new OpenTelemetryProviderConfigError({ details: `optional.context / optional.scope is missing: ${missing.join(", ")}` });
  type Context = ObservabilityProviderContext;
  return { scope: scope as SpanScopePort, context: {
    redactOperationAttributes: record.redactOperationAttributes as Context["redactOperationAttributes"], errorType: record.errorType as Context["errorType"],
    redactLabel: record.redactLabel as Context["redactLabel"], describeReportedError: record.describeReportedError as Context["describeReportedError"],
    describeTelemetryFailure: record.describeTelemetryFailure as Context["describeTelemetryFailure"],
    resolveObservabilityConfig: record.resolveObservabilityConfig as Context["resolveObservabilityConfig"],
  } };
}
