import type { SentryProviderContext } from "./contract.js";

const HELPERS = ["redactOperationAttributes", "describeReportedError", "describeTelemetryFailure"] as const;

/** A host registered the observability contract without the helpers the provider needs. Plain words; `details` is what Copy details shows. */
export class SentryProviderConfigError extends Error {
  readonly code = "observability_sentry_context_missing" as const;
  readonly details: string;
  constructor(required: { details: string }, _optional: Record<string, never> = {}) {
    super("The Sentry error reporter was started without the redaction helpers it needs, so it will not send anything. Restart the app; if this keeps happening, copy the details into a bug report.");
    this.name = "SentryProviderConfigError";
    this.details = required.details;
  }
}

/**
 * Reads diagnostics' helpers as `optional.context`, at initialize and never at the first error. A redaction helper is
 * required: a missing binding fails here instead of silently reporting unredacted data.
 * @returns The helpers, by reference.
 * @throws SentryProviderConfigError naming each helper that is absent or not a function.
 */
export function readSentryContext({ context }: { context: unknown }, _optional: Record<string, never> = {}): SentryProviderContext {
  const record = context !== null && typeof context === "object" ? context as Record<string, unknown> : {};
  const missing = HELPERS.filter(name => typeof record[name] !== "function");
  if (missing.length > 0) throw new SentryProviderConfigError({ details: `optional.context is missing: ${missing.join(", ")}` });
  return { redactOperationAttributes: record.redactOperationAttributes as SentryProviderContext["redactOperationAttributes"],
    describeReportedError: record.describeReportedError as SentryProviderContext["describeReportedError"],
    describeTelemetryFailure: record.describeTelemetryFailure as SentryProviderContext["describeTelemetryFailure"] };
}
