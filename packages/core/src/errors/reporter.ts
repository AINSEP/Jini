/**
 * @file The one incident path. A boundary (route, tool, job, IPC handler, run) hands a caught value
 * to the reporter. A refusal (an error the scope's catalog bindings name) becomes its code and
 * words, with no incident. Anything else is an incident: one error ID, one host record, one tracker
 * report, and the caller gets the boundary's own fallback words with the ID.
 *
 * Stateless apart from one per-reporter mark of the error objects it already recorded, so a failure
 * that crosses two boundaries keeps one ID. Every dependency is a port the host passes; there is no
 * optional sink, so an incident cannot be dropped for lack of wiring. Nothing here throws: a failing ID, clock, catalog, logger or
 * tracker port must not replace the failure being reported; its adapter blanks secrets before anything leaves the process.
 */
import { ClientFacingError } from '../contracts/server/client-facing-error.js';
import type { ObservabilityPort, OperationAttributes, OperationTracker, OperationTrackingOutcome } from '../contracts/observability.js';
import { statusForError, type ServerApiError } from '../contracts/server/api-error.js';
import { createErrorDescriber, describeErrorForLog, describeErrorParts, type ErrorDescriber } from '../model-facing-tool-errors.js';
import type { IdGenerator } from '../primitives/ids.js';
import type { Logger } from '../primitives/logger.js';
import { toIsoDateTime, type Clock } from '../primitives/time.js';
import { redactSecrets } from '../redact.js';
import { type SecretRedactionOptions } from '../redaction-patterns.js';
import type { UserFacingError } from '../user-facing-error.js';
import type { ApprovedCause } from './approved-cause.js';
import type { ErrorCatalog, ErrorMatch } from './catalog.js';
import { discloseIncident, type ErrorAudience } from './disclosure.js';
import { describeThrownValue } from './incident-text.js';
import { interpolateSentence } from './sentences.js';

export interface ErrorReporterPorts {
  /** Returns a finished error ID. Hosts mint `ERR-XXXX-XXXX-XXXX-XXXX`, the one shape a reader can recover from plain text. */
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** Receives the operator-only incident record. */
  readonly logger: Pick<Logger, 'warn' | 'error'>;
  readonly observability: Pick<ObservabilityPort, 'reportError'>;
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
  /** Fixed labels for the incident record and report (`http.route: '/runs/:id'`). Values that are not short fixed-shape labels are dropped. */
  readonly attributes?: OperationAttributes;
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
  /** Fixed labels for the record and report; see {@link DescribeFailureOptions.attributes}. */
  readonly attributes?: OperationAttributes;
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
  describe(required: { error: unknown; step: string; scope: string; fallback: { readonly message: string; readonly action: string }; operation: string; tracker: OperationTracker }, optional?: DescribeFailureOptions): DescribedFailure;
  /** A failure nobody is shown (job, cleanup, IPC handler): host record and tracker only. Never throws. */
  record(required: { error: unknown; step: string; operation: string; tracker?: OperationTracker }, optional?: RecordFailureOptions): { errorId: string };
}

/** Stands in when the host's ID port itself fails, so the record and the caller still agree on one value. */
export const UNAVAILABLE_ERROR_ID = 'ERR-0000-0000-0000-0000';
const MAX_RECORD_TEXT = 8192;
const MAX_PARAM_TEXT = 128;
const MAX_CAUSES = 3;
/** One short fixed-shape label: route patterns, dotted names, ids. `?`, `=`, `&`, spaces and quotes are
 * outside it, so a raw URL with a query, a body field or free text cannot pass. It does not redact. */
const ATTRIBUTE_VALUE = /^[\w.:/-]{1,128}$/;
const ATTRIBUTE_NAME = /^[\w.-]{1,64}$/;
// Attributes become provider-side indexed fields; a bounded count keeps one incident from fanning out.
const MAX_ATTRIBUTES = 16;

interface ReporterContext {
  readonly ports: ErrorReporterPorts; readonly redaction: SecretRedactionOptions; readonly describer: ErrorDescriber;
  /** Error object → the ID it was first recorded under, by this reporter only. Weak, so a request's errors are freed with it. */
  readonly reported: WeakMap<object, string>;
}
interface Incident { readonly errorId: string; readonly label: string; readonly time?: string }

function redactionFor({ context, exactSecrets }: { context: ReporterContext; exactSecrets?: readonly string[] | undefined }): SecretRedactionOptions {
  // Whole fields are redacted before they are cut. PII stays readable in the operator record unless the host asks otherwise.
  return { redactPii: false, ...context.redaction, exactSecrets: [...(context.redaction.exactSecrets ?? []), ...(exactSecrets ?? [])] };
}

/** The non-empty exact secrets of a merged policy; the policy type admits blank entries a caller may pass. */
function knownSecrets({ redaction }: { redaction: SecretRedactionOptions }): string[] {
  return (redaction.exactSecrets ?? []).filter((secret): secret is string => typeof secret === 'string' && secret.length > 0);
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

function reportToTracker(required: {
  context: ReporterContext; incident: Incident; operation: string; tracker?: OperationTracker | undefined; error: unknown; level: 'warning' | 'error';
  exactSecrets: readonly string[]; attributes: OperationAttributes | undefined;
}): void {
  const { context, incident, operation, tracker, error, level, exactSecrets, attributes } = required;
  const failed = (trackerError: unknown): void => {
    // The host record above already holds the incident; say that the tracker copy is missing.
    attempt({ fallback: undefined, read: () => context.ports.logger.warn(
      { message: `[incident] the tracker did not accept the report for error ${incident.errorId}` },
      { meta: { errorId: incident.errorId, tracker: describeErrorForLog({ err: trackerError }) } }) });
  };
  try {
    const trace = tracker?.traceIds?.();
    const sent = context.ports.observability.reportError({
      error,
      // The original error goes to the adapter, so it also needs the exact values to blank; without
      // them a token the request carried would leave the process verbatim in message or stack.
      context: { operation, level, incidentId: incident.errorId, label: incident.label, ...(trace === undefined ? {} : { trace }),
        ...(attributes === undefined ? {} : { attributes }), ...(exactSecrets.length === 0 ? {} : { exactSecrets }) },
    });
    if (sent instanceof Promise) sent.then(undefined, failed);
  } catch (trackerError) {
    failed(trackerError);
  }
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function admissibleValue({ value, redaction, secrets }: { value: unknown; redaction: SecretRedactionOptions; secrets: readonly string[] }): boolean {
  // OperationAttributes admits strings and numbers only, so a boolean or object is dropped here too.
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string' || !ATTRIBUTE_VALUE.test(value)) return false;
  // The shape check does not redact: `[\w.:/-]` still fits a bearer token. A value holding a known
  // exact secret, or one the redactor would change (a recognised token shape), is dropped whole.
  // The redactor also blanks exact secrets; the explicit check states the rule without depending on
  // how the redactor matches them.
  return !secrets.some(secret => value.includes(secret)) && redactSecrets({ input: value }, redaction) === value;
}

/** The attributes allowed into a record and a report, or undefined so the field is omitted entirely. */
function admitAttributes({ attributes, redaction }: { attributes: OperationAttributes | undefined; redaction: SecretRedactionOptions }): OperationAttributes | undefined {
  if (attributes === undefined) return undefined;
  const secrets = knownSecrets({ redaction });
  const accepted: Array<[string, string | number]> = [];
  for (const [name, value] of attempt({ read: () => Object.entries(attributes), fallback: [] as Array<[string, unknown]> })) {
    if (accepted.length >= MAX_ATTRIBUTES) break;
    if (ATTRIBUTE_NAME.test(name) && admissibleValue({ value, redaction, secrets })) accepted.push([name, value as string | number]);
  }
  return accepted.length === 0 ? undefined : Object.freeze(Object.fromEntries(accepted));
}

/** The incident this reporter already wrote for this very error object, if any. Primitives are never
 * matched: two thrown equal strings are indistinguishable from two separate failures. */
function priorIncident({ context, error }: { context: ReporterContext; error: unknown }): Incident | undefined {
  const errorId = isObjectLike(error) ? context.reported.get(error) : undefined;
  if (errorId === undefined) return undefined;
  return { errorId, label: attempt({ read: () => headLabel({ error, describer: context.describer }), fallback: 'Error' }) };
}

function writeHostRecord(required: {
  context: ReporterContext; error: unknown; incident: Incident; step: string; level: 'warning' | 'error';
  redaction: SecretRedactionOptions; attributes: OperationAttributes | undefined;
}): void {
  const { context, error, incident, step, level, redaction, attributes } = required;
  const { ports, describer } = context;
  const { errorId, label, time } = incident;
  const diagnostic = redactSecrets({ input: describeThrownValue({ value: error }) }, redaction).slice(0, MAX_RECORD_TEXT);
  const meta = {
    errorId, step, label, causes: attempt({ read: () => causeLabels({ error, describer }), fallback: [] }),
    appVersion: ports.versions.app, jiniVersion: ports.versions.jini, ...(time === undefined ? {} : { time }), diagnostic,
    ...(attributes === undefined ? {} : { attributes }),
  };
  attempt({ fallback: undefined, read: () => ports.logger[level === 'warning' ? 'warn' : 'error']({ message: `[incident] ${step} failed (error ${errorId})` }, { meta }) });
}

/** Mints the ID, writes the one host record and (unless skipped) the one tracker report. The same
 * error object a second time returns the first ID and writes nothing: the dedupe check runs before
 * minting, so a second boundary cannot spend an ID or send a second report. */
function recordIncident(required: { context: ReporterContext; error: unknown; step: string; operation: string; tracker?: OperationTracker | undefined }, optional: RecordFailureOptions = {}): Incident {
  const { context, error } = required;
  const prior = priorIncident({ context, error });
  if (prior !== undefined) return prior;
  const redaction = redactionFor({ context, exactSecrets: optional.exactSecrets });
  const errorId = optional.errorId ?? attempt({ read: () => context.ports.ids.newId(), fallback: UNAVAILABLE_ERROR_ID });
  // Marked before any port is called, so a logger or tracker that re-enters this reporter with the same error finds the ID.
  if (isObjectLike(error)) context.reported.set(error, errorId);
  const time = attempt<string | undefined>({ read: () => toIsoDateTime({ epochMs: context.ports.clock.nowMs() }), fallback: undefined });
  const step = redactSecrets({ input: required.step }, redaction).slice(0, 512);
  const label = attempt({ read: () => headLabel({ error, describer: context.describer }), fallback: 'Error' });
  const incident: Incident = { errorId, label, ...(time === undefined ? {} : { time }) };
  const level = optional.level ?? 'error';
  const attributes = admitAttributes({ attributes: optional.attributes, redaction });
  // `diagnostic` is the operator-only record. The tracker gets the original `error` plus the standing and per-call
  // `exactSecrets` (on `ErrorReport.context`); the tracker adapter blanks them before anything leaves the process.
  writeHostRecord({ context, error, incident, step, level, redaction, attributes });
  if (optional.tracker !== 'skip') {
    reportToTracker({ context, incident, operation: required.operation, tracker: required.tracker, error, level, exactSecrets: knownSecrets({ redaction }), attributes });
  }
  return incident;
}

function redactedParams({ params, redaction }: { params: Readonly<Record<string, string | number>>; redaction: SecretRedactionOptions }): Record<string, string | number> {
  return Object.fromEntries(Object.entries(params).map(([name, value]) =>
    [name, typeof value === 'number' ? value : redactSecrets({ input: value }, redaction).slice(0, MAX_PARAM_TEXT)]));
}

function refusalMessage(
  required: { match: ErrorMatch; fallback: { message: string }; audience: ErrorAudience }, _optional: Record<string, never> = {},
): { kind: 'text'; message: string } | { kind: 'sentence'; sentence: NonNullable<ErrorMatch['sentence']> } {
  const { match, fallback, audience } = required;
  if (match.sentence?.audience === 'authorized' && audience !== 'authorized') return { kind: 'text', message: fallback.message };
  switch (match.mode) {
    case 'own-message':
      // Injected catalogs may supply the original exception text.
      return { kind: 'text', message: fallback.message };
    case 'fixed':
      return { kind: 'text', message: match.message ?? fallback.message };
    case 'sentence':
      return match.sentence === undefined ? { kind: 'text', message: fallback.message } : { kind: 'sentence', sentence: match.sentence };
  }
}

/** The wire error of a refusal. Words a sentence reserves for authorised callers are replaced by the boundary's fallback words. */
function refusalError(required: { match: ErrorMatch; fallback: { readonly message: string }; audience: ErrorAudience; redaction: SecretRedactionOptions }): ServerApiError {
  const { match, fallback, audience, redaction } = required;
  const { sentence } = match;
  const base = { code: match.code, ...(sentence === undefined ? {} : { retryable: sentence.retryable }) };
  const selected = refusalMessage({ match, fallback, audience });
  if (selected.kind === 'text') return { ...base, message: selected.message };
  const params = redactedParams({ params: match.params ?? {}, redaction });
  const message = interpolateSentence({ text: selected.sentence.message }, { params });
  return Object.keys(params).length === 0 ? { ...base, message } : { ...base, message, details: { params } };
}

function refusal(required: { context: ReporterContext; error: unknown; scope: string; fallback: { readonly message: string }; audience: ErrorAudience; exactSecrets?: readonly string[] | undefined }): DescribedFailure | undefined {
  const { context, error } = required;
  const { catalog } = context.ports;
  // An already-classified carrier: our own code built it, naming the exact error it chose to disclose.
  if (error instanceof ClientFacingError) {
    const carried = error.apiError;
    return { kind: 'refusal', status: catalog.statusFor({ error: carried }) ?? statusForError({ error: carried }), error: carried };
  }
  const match = attempt<ErrorMatch | undefined>({ read: () => catalog.match({ error, scope: required.scope }), fallback: undefined });
  if (match === undefined) return undefined;
  const wire = refusalError({ match, fallback: required.fallback, audience: required.audience, redaction: redactionFor({ context, exactSecrets: required.exactSecrets }) });
  return { kind: 'refusal', status: match.sentence?.status ?? statusForError({ error: wire }), error: wire };
}

function recordOptionsOf(optional: DescribeFailureOptions): RecordFailureOptions {
  return { ...(optional.exactSecrets === undefined ? {} : { exactSecrets: optional.exactSecrets }), ...(optional.attributes === undefined ? {} : { attributes: optional.attributes }) };
}

function describeFailure(
  required: { context: ReporterContext; error: unknown; step: string; scope: string; fallback: { readonly message: string; readonly action: string }; operation: string; tracker: OperationTracker },
  optional: DescribeFailureOptions = {},
): DescribedFailure {
  const { context } = required;
  const audience = optional.audience ?? 'anonymous';
  const refused = attempt({ read: () => refusal({ context, error: required.error, scope: required.scope, fallback: required.fallback, audience, exactSecrets: optional.exactSecrets }), fallback: undefined });
  if (refused !== undefined) return refused;
  // A supplied ID means another path already wrote this incident; otherwise recordIncident returns this
  // reporter's earlier ID for the same error object, or writes the one record.
  const incident: Incident = optional.errorId === undefined
    ? recordIncident({ context, error: required.error, step: required.step, operation: required.operation, tracker: required.tracker }, recordOptionsOf(optional))
    : { errorId: optional.errorId, label: attempt({ read: () => headLabel({ error: required.error, describer: context.describer }), fallback: 'Error' }) };
  const failure = attempt({ fallback: undefined, read: () => discloseIncident(
    { audience, step: required.step, label: incident.label, errorId: incident.errorId, fallback: required.fallback, versions: context.ports.versions },
    { redaction: redactionFor({ context, exactSecrets: optional.exactSecrets }), ...(optional.approvedCause === undefined ? {} : { approvedCause: optional.approvedCause }), ...(incident.time === undefined ? {} : { time: incident.time }) }) });
  // The ID is part of the words, so it survives a consumer that keeps only a message string.
  const error: ServerApiError = { code: 'INTERNAL_ERROR', message: `${required.fallback.message} ${required.fallback.action} (error ${incident.errorId})`, requestId: incident.errorId };
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
  // The dedupe mark is per reporter, never module-wide: two reporters (two hosts, two tests) share no hidden state.
  const context: ReporterContext = { ports: required, redaction: optional.redaction ?? {}, describer, reported: new WeakMap() };
  return {
    describe: (args, options = {}) => describeFailure({ context, ...args }, options),
    record: (args, options = {}) => ({ errorId: recordIncident({ context, ...args }, options).errorId }),
  };
}

/* ---------- the operation lifecycle ---------- */

/** How one operation ended: the fixed label, whether it counts as a failure, and fixed end labels. */
export type OperationVerdict = {
  readonly outcome: 'completed' | 'refused' | 'failed' | 'cancelled';
  readonly failed: boolean;
  readonly attributes?: OperationAttributes;
};
/** What {@link runOperation} returns: the value, a described failure, or a cancellation nobody is told about. */
export type OperationRunResult<T> =
  | { ok: true; value: T; verdict: OperationVerdict }
  | { ok: false; failure: DescribedFailure; verdict: OperationVerdict }
  | { ok: false; cancelled: true; verdict: OperationVerdict };

/** Stands in when no tracker is wired or the host's tracker could not start one. Shared and frozen: it holds nothing. */
export const NOOP_OPERATION_TRACKER: OperationTracker = Object.freeze({ run: <T>(fn: () => T): T => fn(), end: (): void => {} });
const COMPLETED: OperationVerdict = Object.freeze({ outcome: 'completed', failed: false });

/** Ports are typed synchronous, but an adapter may still hand back a promise; observe it so a rejection is never unhandled. */
function observe({ value }: { value: unknown }): void {
  if (value instanceof Promise) value.then(undefined, () => undefined);
}

function isTracker(value: unknown): value is OperationTracker {
  return isObjectLike(value) && typeof (value as OperationTracker).run === 'function' && typeof (value as OperationTracker).end === 'function';
}

/**
 * Starts one operation's tracker. A missing port, a throwing `trackOperation` or one that returns
 * something other than a tracker (a promise, nothing) gives the noop tracker: telemetry failing must
 * never stop the work it would have described. A pure helper, imported directly; not a port.
 * @example const tracker = startOperation({ observability, name: 'tool.call', attributes: { 'tool.id': id } });
 */
export function startOperation(
  required: { observability?: Pick<ObservabilityPort, 'trackOperation'> | undefined; name: string; attributes?: OperationAttributes | undefined },
  _optional: Record<string, never> = {},
): OperationTracker {
  const { observability, name, attributes } = required;
  if (observability === undefined) return NOOP_OPERATION_TRACKER;
  const started = attempt<unknown>({ fallback: undefined, read: () => observability.trackOperation({ name, ...(attributes === undefined ? {} : { attributes }) }) });
  observe({ value: started });
  return isTracker(started) ? started : NOOP_OPERATION_TRACKER;
}

// Trackers already ended. A tracker belongs to one operation, so "once per tracker" is "once per operation".
// Weak, so ended trackers are freed; the shared noop trackers end as no-ops, so marking them changes nothing.
const endedTrackers = new WeakSet<object>();

/**
 * Ends a tracker exactly once: a second call is a no-op, and a throwing `end` is contained, because
 * the operation's result is already decided and telemetry must not change it. Takes the core outcome
 * shape, so a feature's own labels (`timed-out`, `denied`) keep their names.
 * @example endOnce({ tracker, verdict: { outcome: 'timed-out', failed: true } });
 */
export function endOnce(required: { tracker: OperationTracker; verdict: OperationTrackingOutcome }, _optional: Record<string, never> = {}): void {
  const { tracker, verdict } = required;
  if (endedTrackers.has(tracker)) return;
  endedTrackers.add(tracker);
  attempt({ fallback: undefined, read: () => observe({ value: tracker.end(verdict) }) });
}

/** The words a caller gets when the reporter itself broke: fixed text and the stand-in ID, nothing from the error. */
function reporterBreach({ fallback }: { fallback: { readonly message: string; readonly action: string } }): DescribedFailure {
  return { kind: 'incident', status: 500, error: { code: 'INTERNAL_ERROR', message: `${fallback.message} ${fallback.action} (error ${UNAVAILABLE_ERROR_ID})`, requestId: UNAVAILABLE_ERROR_ID } };
}

interface RunOperationRequired<T> {
  deps: { reporter: ErrorReporter; observability?: Pick<ObservabilityPort, 'trackOperation'> | undefined };
  operation: string; scope: string; step: string; fallback: { readonly message: string; readonly action: string };
  work: () => Promise<T>; attributes?: OperationAttributes;
  /** Judges a resolved value (a returned refusal is not a completion). Defaults to `completed`. */
  classify?: (value: T) => OperationVerdict;
  /** Claims a thrown value as a cancellation (a client that went away). Only a `cancelled` answer is honoured. */
  settle?: (error: unknown) => OperationVerdict | undefined;
}

function settleThrown<T>(required: { run: RunOperationRequired<T>; tracker: OperationTracker; error: unknown }, optional: DescribeFailureOptions): OperationRunResult<T> {
  const { run, tracker, error } = required;
  const settled = attempt<OperationVerdict | undefined>({ fallback: undefined, read: () => run.settle?.(error) });
  // Only cancellation may skip the reporter. Any other answer is ignored, so a settle hook cannot
  // relabel an incident as a refusal and hide it from the host record.
  if (settled?.outcome === 'cancelled') return { ok: false, cancelled: true, verdict: settled };
  const { reporter } = run.deps;
  const options = optional.attributes === undefined && run.attributes !== undefined ? { ...optional, attributes: run.attributes } : optional;
  const failure = attempt({ fallback: reporterBreach({ fallback: run.fallback }),
    read: () => reporter.describe({ error, operation: run.operation, scope: run.scope, step: run.step, fallback: run.fallback, tracker }, options) });
  const failed = failure.kind === 'incident';
  return { ok: false, failure, verdict: { outcome: failed ? 'failed' : 'refused', failed } };
}

/** The verdict of a resolved value. A throwing classifier leaves the value standing (the work did
 * finish and must not be retried) and is itself recorded, so the bug is visible to the operator. */
function classifyValue<T>(required: { run: RunOperationRequired<T>; tracker: OperationTracker; value: T }): OperationVerdict {
  const { run, tracker, value } = required;
  if (run.classify === undefined) return COMPLETED;
  try {
    return run.classify(value);
  } catch (error) {
    attempt({ fallback: undefined, read: () => run.deps.reporter.record({ error, step: `${run.step} (judge the result)`, operation: run.operation, tracker }) });
    return COMPLETED;
  }
}

async function settleWork<T>(required: { run: RunOperationRequired<T>; tracker: OperationTracker }, optional: DescribeFailureOptions): Promise<OperationRunResult<T>> {
  const { run, tracker } = required;
  let value: T;
  try {
    // A throw from the tracker's own run() is indistinguishable from the work's, and is reported as it;
    // the work is never started a second time without the tracker.
    value = await tracker.run(run.work);
  } catch (error) {
    return settleThrown({ run, tracker, error }, optional);
  }
  return { ok: true, value, verdict: classifyValue({ run, tracker, value }) };
}

/**
 * Runs one feature operation under a tracker: the work's value, its refusal, its incident (one ID,
 * one record, one report), or a cancellation that reports nothing. The tracker ends exactly once,
 * after the result is settled and outside the work's catch, so a broken tracker can neither turn a
 * success into an incident nor reject this call.
 * @example const run = await runOperation({ deps: { reporter, observability }, operation: 'site.export', scope: 'sites', step: 'Export site', fallback, work });
 */
export async function runOperation<T>(required: RunOperationRequired<T>, optional: DescribeFailureOptions = {}): Promise<OperationRunResult<T>> {
  const { deps, operation, attributes } = required;
  const tracker = startOperation({ observability: deps.observability, name: operation, attributes });
  const result = await settleWork({ run: required, tracker }, optional);
  endOnce({ tracker, verdict: result.verdict });
  return result;
}
