/**
 * @file Recording fakes of the reporter's ports, for tests in any package: a fake of an interface,
 * never a mock of another package's internals.
 */
import type { IdGenerator } from '../primitives/ids.js';
import type { ErrorReport, ObservabilityPort } from '../contracts/observability.js';
import type { LogDiagnosticRecord, Logger } from '../primitives/logger.js';
import type { Clock } from '../primitives/time.js';
import { createErrorCatalog, type ErrorCatalog } from './catalog.js';
import { createErrorReporter, type ErrorReporter, type ErrorReporterOptions } from './reporter.js';

/** A logger that keeps every call exactly as made, original error objects included. */
export function createRecordingLogger(): { readonly logger: Logger; readonly entries: LogDiagnosticRecord[] } {
  const entries: LogDiagnosticRecord[] = [];
  const write = (level: LogDiagnosticRecord['level']) => (required: { message: string }, optional: { meta?: Record<string, unknown>; error?: unknown } = {}): void => {
    entries.push({ level, message: required.message, ...optional });
  };
  return { logger: { info: write('info'), warn: write('warn'), error: write('error') }, entries };
}

/** A tracker that keeps every report. */
export function createRecordingObservability(): { readonly observability: Pick<ObservabilityPort, 'reportError' | 'trackOperation'>; readonly reports: ErrorReport[] } {
  const reports: ErrorReport[] = [];
  return { observability: {
    reportError: report => { reports.push(report); },
    trackOperation: () => ({ run: fn => fn(), end() {}, traceIds: () => ({ traceId: 'test-trace', spanId: 'test-span' }) }),
  }, reports };
}

/** Hands out the given IDs in order; throws when a test asks for more than it listed. */
export function createSequenceIds(required: { ids: readonly string[] }): IdGenerator {
  let next = 0;
  return {
    newId: () => {
      const id = required.ids[next];
      if (id === undefined) throw new RangeError(`createSequenceIds: the test asked for ID ${next + 1} but listed ${required.ids.length}.`);
      next += 1;
      return id;
    },
  };
}

/** A clock fixed at one instant. */
export function createFixedClock(required: { iso: string }): Clock {
  return { nowMs: () => Date.parse(required.iso) };
}

/** Options of {@link createRecordingReporter}. */
export interface RecordingReporterOptions extends ErrorReporterOptions {
  readonly catalog?: ErrorCatalog;
  readonly versions?: { readonly app: string; readonly jini: string };
}

/**
 * A real reporter over recording ports, for a test that needs to see what an incident wrote.
 * @example const { reporter, entries, reports } = createRecordingReporter({ ids: ['ERR-0000-0000-0000-0001'], iso: '2026-01-01T00:00:00.000Z' });
 */
export function createRecordingReporter(required: { ids: readonly string[]; iso: string }, optional: RecordingReporterOptions = {}): {
  readonly reporter: ErrorReporter; readonly entries: LogDiagnosticRecord[]; readonly reports: ErrorReport[];
} {
  const { logger, entries } = createRecordingLogger();
  const { observability, reports } = createRecordingObservability();
  const { catalog = createErrorCatalog({ sentences: [], scopes: [] }), versions = { app: '0.0.0-test', jini: '0.0.0-test' }, ...reporterOptions } = optional;
  const reporter = createErrorReporter({ ids: createSequenceIds({ ids: required.ids }), clock: createFixedClock({ iso: required.iso }), logger, observability, catalog, versions }, reporterOptions);
  return { reporter, entries, reports };
}
