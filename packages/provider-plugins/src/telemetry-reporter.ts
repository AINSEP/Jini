/** Structural copy of diagnostics' `ProviderTelemetryReport`; a plugin cannot import the domain, so the host
 * hands `describeTelemetryFailure` in and the drift guard (`__tests__/observability-contract-drift.typecheck.ts`) proves the fit. */
export interface ProviderTelemetryReport {
  phase: "export" | "shutdown";
  outcome: "ok" | "failed";
  host: string;
  errorClass?: string;
  statusCode?: number;
}
/** The failure classifier the host binds (diagnostics' `describeTelemetryFailure`): only the class and an HTTP status survive. */
export type DescribeTelemetryFailure = (required: { error: unknown }, optional?: object) => Pick<ProviderTelemetryReport, "errorClass" | "statusCode">;

export interface ProviderTelemetryOptions {
  /** Host retirement drops queued exports before SDK shutdown flushes a revoked credential. */
  signal?: AbortSignal | undefined;
  reportTelemetry?: ((report: ProviderTelemetryReport) => void) | undefined;
  info?: ((message: string) => void) | undefined;
}
export interface ProviderTelemetryReporter {
  initialized(required: { message: string }, optional?: Record<string, never>): void;
  result(required: { phase: ProviderTelemetryReport["phase"]; outcome: ProviderTelemetryReport["outcome"]; error?: unknown }, optional?: Record<string, never>): void;
}

/** Adapter-edge sanitizer; a host receives the endpoint hostname only, never SDK error text.
 * @param required Configured destination and the host's failure classifier (required: a missing one fails at construction); parsed once without logging its value. Malformed URLs
 *   report the fixed `invalid-endpoint` label so borrowed clients remain usable.
 * @param optional Borrowed host reporter and info log. Their failures cannot break telemetry.
 * @returns Safe lifecycle reporting callbacks. @complexity O(1) per report.
 */
export function createProviderTelemetryReporter(
  { endpoint, describeTelemetryFailure }: { endpoint: string; describeTelemetryFailure: DescribeTelemetryFailure }, optional: ProviderTelemetryOptions = {},
): ProviderTelemetryReporter {
  const host = URL.canParse(endpoint) ? new URL(endpoint).hostname : 'invalid-endpoint';
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
