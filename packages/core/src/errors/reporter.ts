/**
 * @file The one incident path. A boundary (route, tool, job, IPC handler, run) hands a caught value
 * to the reporter. A refusal (an error the scope's catalog bindings name) becomes its code and
 * words, with no incident. Anything else is an incident: one error ID, one host record, one tracker
 * report, and the caller gets the boundary's own fallback words with the ID.
 *
 * Stateless. Every dependency is a port the host passes; there is no optional sink, so an incident
 * cannot be dropped for lack of wiring. Nothing here throws: a failing ID, clock, catalog, logger or
 * tracker port must not replace the failure being reported.
 */
import { ClientFacingError } from '../contracts/server/json-route.js';
import { statusForError, type ServerApiError } from '../contracts/server/api-error.js';
import { createErrorDescriber, describeErrorForLog, describeErrorParts, type ErrorDescriber } from '../model-facing-tool-errors.js';
import type { IdGenerator } from '../primitives/ids.js';
import type { Logger } from '../primitives/logger.js';
import { toIsoDateTime, type Clock } from '../primitives/time.js';
import { redactSecrets, type SecretRedactionOptions } from '../redact.js';
import type { UserFacingError } from '../user-facing-error.js';
import type { ApprovedCause } from './approved-cause.js';
import type { ErrorCatalog, ErrorMatch } from './catalog.js';
import { discloseIncident, type ErrorAudience } from './disclosure.js';
import { describeThrownValue } from './incident-text.js';
import { interpolateSentence } from './sentences.js';

/** One report to the host's tracker. Structurally what `ObservabilityPort.reportError` takes; core does not import diagnostics. */
export interface IncidentTrackerReport {
  readonly error: unknown;
  readonly context: { readonly operation: string; readonly level?: 'warning' | 'error'; readonly attributes?: Readonly<Record<string, string | number>> };
}
export interface ErrorReporterPorts {
  /** Returns a finished error ID. Hosts mint `ERR-XXXX-XXXX-XXXX-XXXX`, the one shape a reader can recover from plain text. */
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** Receives the operator-only incident record. */
  readonly logger: Pick<Logger, 'warn' | 'error'>;
  readonly tracker: { reportError(report: IncidentTrackerReport): unknown };
  readonly catalog: ErrorCatalog;
  readonly versions: { readonly app: string; readonly jini: string };
}
/** Options of {@link createErrorReporter}. */
export interface ErrorReporterOptions {
  /** The host's redaction policy and standing exact secrets, applied to every record. */
  readonly redaction?: SecretRedactionOptions;
}
export interface DescribeFailureOptions {
  /** Reuse an ID the boundary already minted, so one failure keeps one ID. */
  readonly errorId?: string;
  /** Defaults to `'anonymous'`. Set it only after authentication (and, for `'authorized'`, this operation's permission check) has passed. */
  readonly audience?: ErrorAudience;
  readonly approvedCause?: ApprovedCause;
  /** Secrets known to this call (a token the request carried), blanked wherever they appear. */
  readonly exactSecrets?: readonly string[];
}
export interface RecordFailureOptions {
  readonly errorId?: string;
  readonly level?: 'warning' | 'error';
  readonly exactSecrets?: readonly string[];
  /** `'skip'` is for a failure the caller caused and was told about (a rate-limit refusal on an
   *  anonymous surface): without it, unauthenticated requests could drive unbounded third-party
   *  reports. The host record is still written. Its callers are a reviewed list in
   *  `scripts/check-error-disclosure-callers.ts` (run by `pnpm guard`); a host keeps its own. */
  readonly tracker?: 'report' | 'skip';
}
export interface DescribedFailure {
  readonly kind: 'refusal' | 'incident';
  readonly status: number;
  readonly error: ServerApiError;
  /** An incident's Copy-details block, for a signed-in caller only. */
  readonly failure?: UserFacingError;
}
export interface ErrorReporter {
  /** Refusal → its code and words. Anything else → an incident: one ID, one host record, one tracker report. Never throws. */
  describe(required: { error: unknown; step: string; scope: string; fallback: { readonly message: string; readonly action: string } }, optional?: DescribeFailureOptions): DescribedFailure;
  /** A failure nobody is shown (job, cleanup, IPC handler): host record and tracker only. Never throws. */
  record(required: { error: unknown; step: string }, optional?: RecordFailureOptions): { errorId: string };
}

/** Stands in when the host's ID port itself fails, so the record and the caller still agree on one value. */
export const UNAVAILABLE_ERROR_ID = 'ERR-0000-0000-0000-0000';
const MAX_RECORD_TEXT = 8192;
const MAX_PARAM_TEXT = 128;
const MAX_CAUSES = 3;

interface ReporterContext { readonly ports: ErrorReporterPorts; readonly redaction: SecretRedactionOptions; readonly describer: ErrorDescriber }
interface Incident { readonly errorId: string; readonly label: string; readonly time?: string }

function redactionFor({ context, exactSecrets }: { context: ReporterContext; exactSecrets?: readonly string[] | undefined }): SecretRedactionOptions {
  // Whole fields are redacted before they are cut. PII stays readable in the operator record unless the host asks otherwise.
  return { redactPii: false, ...context.redaction, exactSecrets: [...(context.redaction.exactSecrets ?? []), ...(exactSecrets ?? [])] };
}

function attempt<Value>({ read, fallback }: { read: () => Value; fallback: Value }): Value {
  try { return read(); } catch { return fallback; }
}

/** Labels of up to three causes, nearest first: class and listed code only. */
function causeLabels({ error, describer }: { error: unknown; describer: ErrorDescriber }): string[] {
  const labels: string[] = [];
  let current: unknown = error;
  while (labels.length < MAX_CAUSES && current instanceof Error && current.cause !== undefined) {
    current = current.cause;
    const parts = describer.describeErrorParts({ err: current });
    labels.push(parts.code === undefined ? parts.label : `${parts.label}(${parts.code})`);
  }
  return labels;
}

function headLabel({ error, describer }: { error: unknown; describer: ErrorDescriber }): string {
  const parts = describer.describeErrorParts({ err: error });
  return parts.code === undefined ? parts.label : `${parts.label}(${parts.code})`;
}

/** The record text travels as the tracker's error, so the tracker never holds the unredacted original. */
function trackerCarrier({ label, diagnostic }: { label: string; diagnostic: string }): Error {
  const carrier = new Error(diagnostic.split('\n', 1)[0] ?? label);
  carrier.name = label;
  carrier.stack = diagnostic;
  return carrier;
}

function reportToTracker(required: { context: ReporterContext; incident: Incident; step: string; diagnostic: string; level: 'warning' | 'error' }): void {
  const { context, incident, step, diagnostic, level } = required;
  const failed = (trackerError: unknown): void => {
    // The host record above already holds the incident; say that the tracker copy is missing.
    attempt({ fallback: undefined, read: () => context.ports.logger.warn(
      { message: `[incident] the tracker did not accept the report for error ${incident.errorId}` },
      { meta: { errorId: incident.errorId, tracker: describeErrorForLog({ err: trackerError }) } }) });
  };
  try {
    const sent = context.ports.tracker.reportError({
      error: trackerCarrier({ label: incident.label, diagnostic }),
      context: { operation: step, level, attributes: { errorId: incident.errorId, label: incident.label } },
    });
    if (sent instanceof Promise) sent.then(undefined, failed);
  } catch (trackerError) {
    failed(trackerError);
  }
}

/** Mints the ID, writes the one host record and (unless skipped) the one tracker report. */
function recordIncident(required: { context: ReporterContext; error: unknown; step: string }, optional: RecordFailureOptions = {}): Incident {
  const { context, error } = required;
  const { ports, describer } = context;
  const redaction = redactionFor({ context, exactSecrets: optional.exactSecrets });
  const errorId = optional.errorId ?? attempt({ read: () => ports.ids.newId(), fallback: UNAVAILABLE_ERROR_ID });
  const time = attempt<string | undefined>({ read: () => toIsoDateTime({ epochMs: ports.clock.nowMs() }), fallback: undefined });
  const step = redactSecrets({ input: required.step }, redaction).slice(0, 512);
  const label = attempt({ read: () => headLabel({ error, describer }), fallback: 'Error' });
  const diagnostic = redactSecrets({ input: describeThrownValue({ value: error }) }, redaction).slice(0, MAX_RECORD_TEXT);
  const incident: Incident = { errorId, label, ...(time === undefined ? {} : { time }) };
  const level = optional.level ?? 'error';
  const meta = {
    errorId, step, label, causes: attempt({ read: () => causeLabels({ error, describer }), fallback: [] }),
    appVersion: ports.versions.app, jiniVersion: ports.versions.jini, ...(time === undefined ? {} : { time }), diagnostic,
  };
  // `diagnostic` is the operator-only record: message and stack with secrets blanked. `error` is the
  // original, which only a host diagnostics sink receives.
  attempt({ fallback: undefined, read: () => ports.logger[level === 'warning' ? 'warn' : 'error']({ message: `[incident] ${step} failed (error ${errorId})` }, { meta, error }) });
  if (optional.tracker !== 'skip') reportToTracker({ context, incident, step, diagnostic, level });
  return incident;
}

function redactedParams({ params, redaction }: { params: Readonly<Record<string, string | number>>; redaction: SecretRedactionOptions }): Record<string, string | number> {
  return Object.fromEntries(Object.entries(params).map(([name, value]) =>
    [name, typeof value === 'number' ? value : redactSecrets({ input: value }, redaction).slice(0, MAX_PARAM_TEXT)]));
}

/** The wire error of a refusal. Words a sentence reserves for authorised callers are replaced by the boundary's fallback words. */
function refusalError(required: { match: ErrorMatch; fallback: { readonly message: string }; audience: ErrorAudience; redaction: SecretRedactionOptions }): ServerApiError {
  const { match, fallback, audience, redaction } = required;
  const { sentence } = match;
  const base = { code: match.code, ...(sentence === undefined ? {} : { retryable: sentence.retryable }) };
  if (sentence?.audience === 'authorized' && audience !== 'authorized') return { ...base, message: fallback.message };
  if (match.mode !== 'sentence') return { ...base, message: match.message ?? fallback.message };
  if (sentence === undefined) return { ...base, message: fallback.message };
  const params = redactedParams({ params: match.params ?? {}, redaction });
  const message = interpolateSentence({ text: sentence.message }, { params });
  return Object.keys(params).length === 0 ? { ...base, message } : { ...base, message, details: { params } };
}

function refusal(required: { context: ReporterContext; error: unknown; scope: string; fallback: { readonly message: string }; audience: ErrorAudience }): DescribedFailure | undefined {
  const { context, error } = required;
  const { catalog } = context.ports;
  // An already-classified carrier: our own code built it, naming the exact error it chose to disclose.
  if (error instanceof ClientFacingError) {
    const carried = error.apiError;
    return { kind: 'refusal', status: catalog.statusFor({ error: carried }) ?? statusForError({ error: carried }), error: carried };
  }
  const match = attempt<ErrorMatch | undefined>({ read: () => catalog.match({ error, scope: required.scope }), fallback: undefined });
  if (match === undefined) return undefined;
  const wire = refusalError({ match, fallback: required.fallback, audience: required.audience, redaction: redactionFor({ context }) });
  return { kind: 'refusal', status: match.sentence?.status ?? statusForError({ error: wire }), error: wire };
}

function describeFailure(
  required: { context: ReporterContext; error: unknown; step: string; scope: string; fallback: { readonly message: string; readonly action: string } },
  optional: DescribeFailureOptions = {},
): DescribedFailure {
  const { context } = required;
  const audience = optional.audience ?? 'anonymous';
  const refused = attempt({ read: () => refusal({ context, error: required.error, scope: required.scope, fallback: required.fallback, audience }), fallback: undefined });
  if (refused !== undefined) return refused;
  const incident = recordIncident({ context, error: required.error, step: required.step },
    { ...(optional.errorId === undefined ? {} : { errorId: optional.errorId }), ...(optional.exactSecrets === undefined ? {} : { exactSecrets: optional.exactSecrets }) });
  const failure = attempt({ fallback: undefined, read: () => discloseIncident(
    { audience, step: required.step, label: incident.label, errorId: incident.errorId, fallback: required.fallback, versions: context.ports.versions },
    { redaction: redactionFor({ context, exactSecrets: optional.exactSecrets }), ...(optional.approvedCause === undefined ? {} : { approvedCause: optional.approvedCause }), ...(incident.time === undefined ? {} : { time: incident.time }) }) });
  // The ID is part of the words, so it survives a consumer that keeps only a message string.
  const error: ServerApiError = { code: 'INTERNAL_ERROR', message: `${required.fallback.message} (error ${incident.errorId})`, requestId: incident.errorId };
  return { kind: 'incident', status: 500, error, ...(failure === undefined ? {} : { failure }) };
}

/**
 * Builds the host's reporter. `fallback` is required at every `describe` call, so the reporter has
 * no default sentence and cannot emit a generic one.
 * @example reporter.describe({ error, step: 'Export site', scope: 'site-export', fallback: { message: 'The site export could not be completed.', action: 'Try the export again.' } }, { audience: 'signed-in' })
 * @complexity O(bindings in the scope) for a refusal; O(size of the error text) for an incident (redaction).
 */
export function createErrorReporter(required: ErrorReporterPorts, optional: ErrorReporterOptions = {}): ErrorReporter {
  // The catalog's codes and labelled classes extend what a record may name; a catalog whose
  // vocabulary cannot be read still leaves the built-in describer.
  const describer = attempt<ErrorDescriber>({ read: () => createErrorDescriber(required.catalog.describerVocabulary()), fallback: { describeErrorParts, describeErrorForLog } });
  const context: ReporterContext = { ports: required, redaction: optional.redaction ?? {}, describer };
  return {
    describe: (args, options = {}) => describeFailure({ context, ...args }, options),
    record: (args, options = {}) => ({ errorId: recordIncident({ context, error: args.error, step: args.step }, options).errorId }),
  };
}
