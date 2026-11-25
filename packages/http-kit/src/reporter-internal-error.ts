import type { ReportRouteInternalError, ServerApiError } from '@jini-ai/core/contracts/server';
import type { ErrorReporter } from '@jini-ai/core/errors/reporter';

/** Route fields that are fixed, low-cardinality labels and may become record attributes. Anything
 *  else a route put on its report (a request body, a path, a user name) stays out of telemetry. */
const BOUNDED_REPORT_FIELDS = ['runId', 'batchId', 'source', 'provider', 'operation'] as const;

/** Copies only the allow-listed fields whose value is a string; the reporter further drops any
 *  value that is not a short fixed-shape label. */
function boundedReportAttributes({ report }: { readonly report: object }): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const field of BOUNDED_REPORT_FIELDS) {
    const value = (report as Record<string, unknown>)[field];
    if (typeof value === 'string') attributes[field] = value;
  }
  return attributes;
}

/**
 * The reporter-mode `reportInternalError` an in-route caller uses for an incident it handles itself
 * (it returns `err(...)` instead of throwing). The host's reporter owns the one record and tracker
 * report under one error ID; the caller gets its plain words with that ID appended and as
 * `requestId`. The boundary then classifies the returned `INTERNAL_ERROR` as `failed` without
 * reporting it again.
 *
 * The legacy `onInternalError` sink in the compatibility second argument is ignored on purpose:
 * a host in reporter mode must never get both a sink call and a record for one failure.
 * @param required.reporter The host's one reporter; only `record` is used.
 * @returns A `ReportRouteInternalError` with the same call shape as the legacy reporter.
 * @complexity O(1) per call besides the reporter.
 */
export function createReporterRouteInternalError(
  { reporter }: { readonly reporter: Pick<ErrorReporter, 'record'> },
  _optional: Record<string, never> = {},
): ReportRouteInternalError {
  return ({ report, logSource, message }): ServerApiError => {
    const { errorId } = reporter.record(
      { error: report.error, step: logSource, operation: 'http.route' },
      { attributes: boundedReportAttributes({ report }) },
    );
    return { code: 'INTERNAL_ERROR', message: `${message} (error ${errorId})`, requestId: errorId };
  };
}
