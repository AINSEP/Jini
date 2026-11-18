import type { DescribeTelemetryFailure } from "../telemetry-reporter.js";

/** A host initialized the provider without the failure classifier it needs. Plain words; `details` is what Copy details shows. */
export class PostHogProviderConfigError extends Error {
  readonly code = "analytics_posthog_context_missing" as const;
  readonly details: string;
  constructor(required: { details: string }, _optional: Record<string, never> = {}) {
    super("The PostHog analytics provider was started without the telemetry helper it needs, so it will not send anything. Restart the app; if this keeps happening, copy the details into a bug report.");
    this.name = "PostHogProviderConfigError";
    this.details = required.details;
  }
}

/**
 * Reads the failure classifier the host binds (diagnostics' `describeTelemetryFailure`) as an initialize option,
 * at initialize and never at the first delivery report.
 * @returns The classifier, by reference.
 * @throws PostHogProviderConfigError when it is absent or not a function.
 */
export function readPostHogTelemetry({ describeTelemetryFailure }: { describeTelemetryFailure: unknown }, _optional: Record<string, never> = {}): DescribeTelemetryFailure {
  if (typeof describeTelemetryFailure !== "function") throw new PostHogProviderConfigError({ details: "optional.describeTelemetryFailure is missing" });
  return describeTelemetryFailure as DescribeTelemetryFailure;
}
