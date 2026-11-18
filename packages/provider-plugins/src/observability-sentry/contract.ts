/** Structural copy of the members of diagnostics' observability provider `context` that this provider reads; the drift
 * guard proves the fit both ways. A provider cannot import the domain, and providers never import each other. */
import type { DescribeTelemetryFailure } from '../telemetry-reporter.js';

/** `describeReportedError`'s result: the redacted error an error tracker may see. */
export interface ReportedErrorDescription { type: string; message: string; stack?: string }
export interface SentryProviderContext {
  describeReportedError(required: { error: unknown }, optional?: { describer?: { describeErrorParts(required: { err: unknown }, optional?: Record<string, never>): { readonly label: string; readonly code?: string } } }): ReportedErrorDescription;
  describeTelemetryFailure: DescribeTelemetryFailure;
  redactOperationAttributes(required: { attributes: Readonly<Record<string, string | number>> }): Record<string, string | number>;
}
