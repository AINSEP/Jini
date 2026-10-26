import { describeTelemetryFailure, type ProviderTelemetryReport } from "@jini-ai/diagnostics/observability";

export interface ProviderTelemetryOptions {
  reportTelemetry?: ((report: ProviderTelemetryReport) => void) | undefined;
  info?: ((message: string) => void) | undefined;
}
export interface ProviderTelemetryReporter {
  initialized(required: { message: string }, optional?: Record<string, never>): void;
  result(required: { phase: ProviderTelemetryReport["phase"]; outcome: ProviderTelemetryReport["outcome"]; error?: unknown }, optional?: Record<string, never>): void;
}

/** Adapter-edge sanitizer; a host receives the endpoint hostname only, never SDK error text.
 * @param required Configured destination; parsed once without logging its value.
 * @param optional Borrowed host reporter and info log. Their failures cannot break telemetry.
 * @returns Safe lifecycle reporting callbacks. @complexity O(1) per report.
 */
export function createProviderTelemetryReporter(
  { endpoint }: { endpoint: string }, optional: ProviderTelemetryOptions = {},
): ProviderTelemetryReporter {
  const host = new URL(endpoint).hostname;
  return {
    initialized({ message }: { message: string }, _options = {}): void {
      try { optional.info?.(`observability: ${message} to ${host}`); } catch { /* Logging is borrowed. */ }
    },
    result({ phase, outcome, error }: { phase: ProviderTelemetryReport["phase"]; outcome: ProviderTelemetryReport["outcome"]; error?: unknown }, _options = {}): void {
      try { optional.reportTelemetry?.({ phase, outcome, host, ...(outcome === "failed" ? describeTelemetryFailure({ error }) : {}) }); }
      catch { /* Diagnostics must never break export callbacks or application shutdown. */ }
    },
  };
}
