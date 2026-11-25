/**
 * @file The one incident path and its disclosure rule. The canaries are ordinary private prose, not
 * token shapes, because the rule under test is "redaction is not permission": no redactor recognises
 * a draft line or a customer note, so they must stay out of every caller-visible field by policy.
 */
import { describe, expect, test } from 'vitest';
import { ClientFacingError } from '../../contracts/server/json-route.js';
import { approveCause, type ApprovedCause } from '../approved-cause.js';
import { defineErrorScope } from '../bindings.js';
import { createErrorCatalog } from '../catalog.js';
import { INCIDENT_CAUSE_SENTENCE, type ErrorAudience } from '../disclosure.js';
import { createErrorReporter, UNAVAILABLE_ERROR_ID, type ErrorReporterPorts } from '../reporter.js';
import { defineErrorSentences } from '../sentences.js';
import { createFixedClock, createRecordingLogger, createRecordingReporter, createRecordingObservability, createSequenceIds } from '../testing.js';

const ID = 'ERR-0123-4567-89AB-CDEF';
const NOW = '2026-02-21T12:00:00.000Z';
const STEP = 'Export site';
const OPERATION = 'site.export';
const trace = { traceId: 'test-trace', spanId: 'test-span' };
const tracker = createRecordingObservability().observability.trackOperation({ name: OPERATION });
const fallback = { message: 'The site export could not be completed.', action: 'Try the export again.' };
const CANARIES = [
  'Private draft body: Acme merger closes Friday',
  'customer memo: violet-unlisted-passphrase',
  'https://internal.example/reports?customer=acme-holdings&quarter=q3',
];

class MemberNotFoundError extends Error {}
class SealerError extends Error {}
class QuotaError extends Error {}
class StaffOnlyError extends Error {}
class StaffWorkspaceError extends Error {}
const catalog = createErrorCatalog({
  sentences: [defineErrorSentences({ domain: 'MEMBERS', codes: {
    MEMBERS_NOT_FOUND: { status: 404, retryable: false, message: 'That member does not exist.', action: 'Check the member list.', audience: 'anyone' },
    MEMBERS_QUOTA: { status: 429, retryable: true, message: 'You have used {used} of {limit} seats for {plan}.', action: 'Remove a member or upgrade.', audience: 'anyone' },
    MEMBERS_STAFF_ONLY: { status: 403, retryable: false, message: 'Only staff of the billing workspace may do this.', action: 'Ask an owner.', audience: 'authorized' },
    MEMBERS_STAFF_WORKSPACE: { status: 403, retryable: false, message: 'Workspace {workspace} is restricted to staff.', action: 'Ask an owner.', audience: 'authorized' },
  } })],
  scopes: [defineErrorScope({ scope: 'members', bindings: [
    { error: MemberNotFoundError, code: 'MEMBERS_NOT_FOUND', text: { mode: 'own-message' }, label: 'MemberNotFoundError' },
    { error: SealerError, code: 'MEMBERS_SEAL_FAILED', text: { mode: 'fixed', text: 'The member record could not be sealed.' } },
    { error: QuotaError, code: 'MEMBERS_QUOTA', text: { mode: 'sentence', params: () => ({ used: 12, limit: 10, plan: `team ${'x'.repeat(200)}` }) } },
    { error: StaffOnlyError, code: 'MEMBERS_STAFF_ONLY', text: { mode: 'own-message' } },
    { error: StaffWorkspaceError, code: 'MEMBERS_STAFF_WORKSPACE', text: { mode: 'sentence', params: () => ({ workspace: 'billing-emea' }) } },
  ] })],
});
const build = (optional: Parameters<typeof createRecordingReporter>[1] = {}) => createRecordingReporter({ ids: [ID, 'ERR-0000-0000-0000-0002'], iso: NOW }, { catalog, versions: { app: '4.2.0', jini: '0.7.2' }, ...optional });
const describeIncident = (error: unknown, optional: { audience?: ErrorAudience; approvedCause?: ApprovedCause } = {}) => {
  const built = build();
  return { ...built, described: built.reporter.describe({ error, step: STEP, operation: OPERATION, tracker, scope: 'members', fallback }, optional) };
};

describe('incident', () => {
  test('an unknown error gets one ID from the ID port, the time from the clock, one host record and one tracker report', () => {
    const original = Object.assign(new Error('disk is full', { cause: Object.assign(new Error('write failed'), { code: 'ENOSPC' }) }), { code: 'SQLITE_FULL' });
    const { described, entries, reports } = describeIncident(original);
    expect(described, 'incident words include the fallback message, action and ID').toEqual({ kind: 'incident', status: 500, error: { code: 'INTERNAL_ERROR', message: `${fallback.message} ${fallback.action} (error ${ID})`, requestId: ID } });
    expect(entries).toHaveLength(1);
    expect(entries[0], 'the host record keeps incident metadata').toMatchObject({ level: 'error', message: `[incident] ${STEP} failed (error ${ID})`,
      meta: { errorId: ID, step: STEP, label: 'Error(SQLITE_FULL)', causes: ['Error(ENOSPC)'], appVersion: '4.2.0', jiniVersion: '0.7.2', time: NOW } });
    expect(String(entries[0]!.meta!.diagnostic)).toContain('Error: disk is full');
    expect(reports).toHaveLength(1);
    expect(reports[0]!.context, 'the report carries operation, incident label and explicit trace').toEqual({ operation: OPERATION, level: 'error', incidentId: ID, label: 'Error(SQLITE_FULL)', trace });
    expect(reports[0]!.error).toBe(original);
  });

  test('the boundary may pass an ID it already minted; the ID port is then not asked', () => {
    const built = build();
    const described = built.reporter.describe({ error: new Error('x'), step: STEP, operation: OPERATION, tracker, scope: 'members', fallback }, { errorId: 'ERR-AAAA-BBBB-CCCC-DDDD' });
    expect(described.error.requestId, 'the supplied ID is reused').toBe('ERR-AAAA-BBBB-CCCC-DDDD');
    expect(built.entries, 'an existing ID does not write another host record').toHaveLength(0);
    expect(built.reports, 'an existing ID does not send another report').toHaveLength(0);
    expect(built.reporter.record({ error: new Error('y'), step: STEP, operation: OPERATION }), 'describing an existing ID or refusal does not consume a new ID').toEqual({ errorId: ID });
  });

  test('the record keeps at most 30 stack lines and names at most three causes, nearest first', () => {
    const deep = new Error('top', { cause: new TypeError('one', { cause: new RangeError('two', { cause: new SyntaxError('three', { cause: new Error('four') }) }) }) });
    deep.stack = ['Error: top', ...Array.from({ length: 60 }, (_, index) => `    at frame${index}`)].join('\n');
    const { entries } = describeIncident(deep);
    expect(String(entries[0]!.meta!.diagnostic).split('\n')).toHaveLength(30);
    expect(entries[0]!.meta!.causes).toEqual(['TypeError', 'RangeError', 'SyntaxError']);
  });

  test('the logger gets only a redacted diagnostic and the report gets the original error and tracker IDs', () => {
    const built = build({ redaction: { exactSecrets: ['host-standing-secret'] } });
    const error = new Error('upstream said host-standing-secret and call-scoped-secret with Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345');
    const exactSecrets = ['call-scoped-secret'];
    built.reporter.describe({ error, step: STEP, operation: OPERATION, tracker, scope: 'members', fallback }, { audience: 'authorized', exactSecrets });
    const operatorText = String(built.entries[0]!.meta!.diagnostic);
    expect(built.reports[0]!.error).toBe(error);
    expect(built.entries[0], 'the logger must never receive the original error').not.toHaveProperty('error');
    expect(built.reports[0]!.context, 'the report uses fixed operation and explicit tracker IDs').toEqual({
      operation: OPERATION, level: 'error', incidentId: ID, label: 'Error', trace,
    });
    for (const secret of ['host-standing-secret', 'call-scoped-secret', 'abcdefghijklmnopqrstuvwxyz012345']) expect(operatorText).not.toContain(secret);
    expect(operatorText).toContain('upstream said');
  });

  test('a value that is not an Error is described from its own data: no getter, toJSON or inspector runs', () => {
    const calls: string[] = [];
    const thrown = {
      reason: 'upstream refused', nested: { attempts: 3, list: ['a', 7] },
      get owner(): string { calls.push('getter'); throw new Error('getter ran'); },
      toJSON(): unknown { calls.push('toJSON'); return {}; },
      [Symbol.for('nodejs.util.inspect.custom')](): string { calls.push('inspect'); return ''; },
      toString(): string { calls.push('toString'); return ''; },
    };
    const { described, entries } = describeIncident(thrown);
    expect(calls).toEqual([]);
    expect(described.kind).toBe('incident');
    expect(entries[0]!.meta).toMatchObject({ label: 'object', diagnostic: '{ reason: "upstream refused", nested: { attempts: 3, list: ["a", 7] }, owner: [getter], toJSON: [function], toString: [function] }' });
  });

  test('an Error with no stack is recorded by its message; one whose fields cannot be read is recorded as unreadable', () => {
    const bare = new Error('no stack here');
    bare.stack = '';
    expect(describeIncident(bare).entries[0]!.meta!.diagnostic).toBe('Error: no stack here');
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'stack', { get() { throw new Error('stack getter'); } });
    expect(describeIncident(hostile).entries[0]!.meta!.diagnostic).toBe('[unreadable]');
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(describeIncident(revoked.proxy).entries[0]!.meta!.diagnostic).toBe('[unreadable]');
  });

  test('a deep or wide thrown object is cut, not walked without bound', () => {
    const wide = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index}`, index]));
    const text = String(describeIncident({ a: { b: { c: { d: 1 } } }, wide, fn: () => 1, sym: Symbol('s'), big: 10n, none: null }).entries[0]!.meta!.diagnostic);
    expect(text).toContain('a: { b: { c: [nested too deep] } }');
    expect(text).toContain('k19: 19, … }');
    expect(text).toContain('fn: [function], sym: [symbol], big: 10, none: null');
  });

  test.each([['a string', 'plain text thrown', 'plain text thrown'], ['undefined', undefined, 'undefined'], ['a number', 42, '42']])('%s can be thrown and is recorded', (_label, thrown, text) => {
    const { entries } = describeIncident(thrown);
    expect(entries[0]!.meta!.diagnostic).toBe(text);
  });
});

describe('never throws', () => {
  const ports = (): ErrorReporterPorts & { entries: ReturnType<typeof createRecordingLogger>['entries']; reports: ReturnType<typeof createRecordingObservability>['reports'] } => {
    const { logger, entries } = createRecordingLogger();
    const { observability, reports } = createRecordingObservability();
    return { ids: createSequenceIds({ ids: [ID] }), clock: createFixedClock({ iso: NOW }), logger, observability, catalog, versions: { app: '4.2.0', jini: '0.7.2' }, entries, reports };
  };
  const boom = (): never => { throw new Error('port down'); };
  const run = (overrides: Partial<ErrorReporterPorts>) => {
    const base = ports();
    const described = createErrorReporter({ ...base, ...overrides }).describe({ error: new Error('x'), step: STEP, operation: OPERATION, tracker, scope: 'members', fallback }, { audience: 'signed-in' });
    return { described, entries: base.entries, reports: base.reports };
  };

  test('a throwing logger still answers and still reports to the tracker', () => {
    const { described, reports } = run({ logger: { warn: boom, error: boom } });
    expect(described.error, 'logger failure preserves fallback words and next action').toEqual({ code: 'INTERNAL_ERROR', message: `${fallback.message} ${fallback.action} (error ${ID})`, requestId: ID });
    expect(reports).toHaveLength(1);
  });

  test('a throwing tracker still answers, keeps the host record, and says the tracker copy is missing', () => {
    const { described, entries } = run({ observability: { reportError: boom } });
    expect(described.error.requestId).toBe(ID);
    expect(entries.map(entry => [entry.level, entry.message])).toEqual([
      ['error', `[incident] ${STEP} failed (error ${ID})`], ['warn', `[incident] the tracker did not accept the report for error ${ID}`]]);
  });

  test('a tracker whose promise rejects is observed, not left unhandled', async () => {
    const { entries } = run({ observability: { reportError: () => Promise.reject(new Error('tracker offline')) } });
    await Promise.resolve(); await Promise.resolve();
    expect(entries.map(entry => entry.message)).toContain(`[incident] the tracker did not accept the report for error ${ID}`);
  });

  test('a failing ID port answers with the stand-in ID in the words, the wire field and the record', () => {
    const { described, entries } = run({ ids: { newId: boom } });
    expect(described.error, 'ID-port failure preserves fallback words and next action').toMatchObject({ message: `${fallback.message} ${fallback.action} (error ${UNAVAILABLE_ERROR_ID})`, requestId: UNAVAILABLE_ERROR_ID });
    expect(entries[0]!.meta!.errorId).toBe(UNAVAILABLE_ERROR_ID);
  });

  test('a failing clock leaves the time out', () => {
    const { described, entries } = run({ clock: { nowMs: boom } });
    expect(described.failure?.time).toBeUndefined();
    expect(entries[0]!.meta).not.toHaveProperty('time');
  });

  test('a catalog whose lookup throws makes the failure an incident', () => {
    const { described } = run({ catalog: { ...catalog, match: boom } });
    expect(described.kind).toBe('incident');
  });

  test('a catalog whose vocabulary cannot be read leaves the built-in labels', () => {
    const { entries } = run({ catalog: { ...catalog, describerVocabulary: boom } });
    expect(entries[0]!.meta!.label).toBe('Error');
  });
});

describe('disclosure: redaction is not permission', () => {
  const visible = (error: unknown, optional: { audience?: ErrorAudience; approvedCause?: ApprovedCause } = {}): string => JSON.stringify(describeIncident(error, optional).described);
  const failing = (canary: string) => Object.assign(new Error(canary), { code: 'SQLITE_BUSY' });

  test.each(CANARIES)('private text in an error message reaches no caller without a matching approval: %s', canary => {
    const error = failing(canary);
    for (const audience of ['anonymous', 'signed-in', 'authorized'] as const) expect(visible(error, { audience })).not.toContain(canary);
    expect(visible(error)).not.toContain(canary);
    expect(visible(error, { audience: 'authorized', approvedCause: approveCause({ step: 'Import site', cause: error }) })).not.toContain(canary);
    expect(visible(error, { audience: 'signed-in', approvedCause: approveCause({ step: STEP, cause: error }) })).not.toContain(canary);
    expect(visible(error, { audience: 'anonymous', approvedCause: approveCause({ step: STEP, cause: error }) })).not.toContain(canary);
    expect(visible(error, { audience: 'authorized', approvedCause: { step: STEP, cause: error } as ApprovedCause })).not.toContain(canary);
    // The same text does reach the operator-only record, and the caller the operation's owner approved.
    expect(String(describeIncident(error).entries[0]!.meta!.diagnostic)).toContain(canary);
    expect(visible(error, { audience: 'authorized', approvedCause: approveCause({ step: STEP, cause: error }) })).toContain(canary);
  });

  test('anonymous: words and the ID only, no details block', () => {
    const { described } = describeIncident(failing(CANARIES[0]!));
    expect(described, 'incident words include the fallback message, action and ID').toEqual({ kind: 'incident', status: 500, error: { code: 'INTERNAL_ERROR', message: `${fallback.message} ${fallback.action} (error ${ID})`, requestId: ID } });
    expect(JSON.stringify(described)).not.toMatch(/4\.2\.0|0\.7\.2|Export site|SQLITE_BUSY/);
  });

  test('signed in: Copy details with the ID, step, versions, time and the fixed cause sentence; no class or code label', () => {
    const { described } = describeIncident(failing(CANARIES[0]!), { audience: 'signed-in' });
    expect(described.failure).toEqual({
      message: fallback.message, action: fallback.action, step: STEP, cause: INCIDENT_CAUSE_SENTENCE,
      errorId: ID, appVersion: '4.2.0', jiniVersion: '0.7.2', time: NOW,
      copyText: [`Message: ${fallback.message}`, `Next action: ${fallback.action}`, `Error ID: ${ID}`, `Step: ${STEP}`, `Cause: ${INCIDENT_CAUSE_SENTENCE}`,
        'App version: 4.2.0', 'Jini version: 0.7.2', `Time: ${NOW}`].join('\n'),
    });
    expect(described.error.message, 'signed-in incident words include the next action').toBe(`${fallback.message} ${fallback.action} (error ${ID})`);
    expect(JSON.stringify(described)).not.toContain('SQLITE_BUSY');
  });

  test('authorised for the operation: the cause also carries the listed class and code label, nothing else', () => {
    const { described } = describeIncident(failing(CANARIES[0]!), { audience: 'authorized' });
    expect(described.error.message, 'authorized incident words include the next action').toBe(`${fallback.message} ${fallback.action} (error ${ID})`);
    expect(described.failure?.cause).toBe(`${INCIDENT_CAUSE_SENTENCE} Failure class: Error(SQLITE_BUSY).`);
  });

  test('an approved cause for the same step replaces the fixed sentence, and is still redacted', () => {
    const cause = new Error(`${CANARIES[0]} with Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345`);
    const { described } = describeIncident(cause, { audience: 'authorized', approvedCause: approveCause({ step: STEP, cause }) });
    expect(described.failure?.cause).toContain(CANARIES[0]);
    expect(JSON.stringify(described)).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
  });
});

describe('refusal', () => {
  test('a bound error answers its code and words, with no host record, no tracker report and no ID', () => {
    const built = build();
    const described = built.reporter.describe({ error: new MemberNotFoundError("member 'm-9' was not found"), step: STEP, operation: OPERATION, tracker, scope: 'members', fallback });
    expect(described, 'own-message refusals publish fallback words').toEqual({ kind: 'refusal', status: 404, error: { code: 'MEMBERS_NOT_FOUND', retryable: false, message: fallback.message } });
    expect(built.entries).toEqual([]);
    expect(built.reports).toEqual([]);
    expect(built.reporter.record({ error: new Error('next'), step: STEP, operation: OPERATION }), 'describing an existing ID or refusal does not consume a new ID').toEqual({ errorId: ID });
  });

  test('the same error in a scope that does not bind it is an incident', () => {
    expect(build().reporter.describe({ error: new MemberNotFoundError('x'), step: STEP, operation: OPERATION, tracker, scope: 'pages', fallback }).kind, 'unbound errors remain incidents').toBe('incident');
  });

  test('a fixed text replaces the message; a code with no sentence takes its status from the generic table', () => {
    const described = build().reporter.describe({ error: new SealerError('plaintext: hunter2'), step: STEP, operation: OPERATION, tracker, scope: 'members', fallback });
    expect(described).toEqual({ kind: 'refusal', status: 500, error: { code: 'MEMBERS_SEAL_FAILED', message: 'The member record could not be sealed.' } });
  });

  test('a sentence is rendered in English and its values travel in details.params, each capped at 128 characters', () => {
    const described = build().reporter.describe({ error: new QuotaError('over'), step: STEP, operation: OPERATION, tracker, scope: 'members', fallback });
    const plan = `team ${'x'.repeat(200)}`.slice(0, 128);
    expect(described).toEqual({ kind: 'refusal', status: 429, error: { code: 'MEMBERS_QUOTA', retryable: true,
      message: `You have used 12 of 10 seats for ${plan}.`, details: { params: { used: 12, limit: 10, plan } } } });
  });

  test('a call-scoped exact secret in a sentence parameter is blanked', () => {
    const described = build().reporter.describe({ error: new QuotaError('over'), step: STEP,
      operation: OPERATION, tracker, scope: 'members', fallback }, { exactSecrets: ['team'] });
    expect(described.error.message, 'per-call secrets are redacted from rendered sentences').not.toContain('team');
    expect(described.error.details, 'per-call secrets are redacted from sentence parameters').toEqual({ params: {
      used: 12, limit: 10, plan: `[REDACTED:exact_secret] ${'x'.repeat(200)}`.slice(0, 128),
    } });
  });

  test("words a sentence reserves for authorised callers are replaced by the boundary's fallback words for everyone else", () => {
    const error = new StaffOnlyError('workspace billing-emea is restricted to staff');
    const wire = (audience: ErrorAudience) => build().reporter.describe({ error, step: STEP, operation: OPERATION, tracker, scope: 'members', fallback }, { audience });
    expect(wire('anonymous')).toEqual({ kind: 'refusal', status: 403, error: { code: 'MEMBERS_STAFF_ONLY', retryable: false, message: fallback.message } });
    expect(wire('signed-in').error.message).toBe(fallback.message);
    expect(wire('authorized').error.message, 'own-message text is not published to authorized callers').toBe(fallback.message);
  });

  test('a sentence reserved for authorised callers is rendered with its params only for them; everyone else gets the fallback words and no params', () => {
    const error = new StaffWorkspaceError('workspace billing-emea is restricted to staff');
    const wire = (audience: ErrorAudience) => build().reporter.describe({ error, step: STEP, operation: OPERATION, tracker, scope: 'members', fallback }, { audience });
    expect(wire('authorized'), 'authorized callers see the rendered sentence and its params').toEqual({ kind: 'refusal', status: 403, error: {
      code: 'MEMBERS_STAFF_WORKSPACE', retryable: false, message: 'Workspace billing-emea is restricted to staff.', details: { params: { workspace: 'billing-emea' } } } });
    for (const audience of ['anonymous', 'signed-in'] as const) {
      expect(wire(audience), `${audience} callers get only the fallback words`).toEqual({ kind: 'refusal', status: 403, error: { code: 'MEMBERS_STAFF_WORKSPACE', retryable: false, message: fallback.message } });
      expect(JSON.stringify(wire(audience)), `${audience} callers never see the reserved param`).not.toContain('billing-emea');
    }
  });

  test('an already-classified carrier is answered as built, with the catalog status when the code has a sentence', () => {
    const built = build();
    const carried = (code: string) => built.reporter.describe({ error: new ClientFacingError({ apiError: { code, message: 'chosen words' } }), step: STEP, operation: OPERATION, tracker, scope: 'pages', fallback });
    expect(carried('MEMBERS_NOT_FOUND')).toEqual({ kind: 'refusal', status: 404, error: { code: 'MEMBERS_NOT_FOUND', message: 'chosen words' } });
    expect(carried('RATE_LIMITED').status).toBe(429);
    expect(built.entries).toEqual([]);
  });
});

describe('record', () => {
  test('a failure nobody is shown gets a host record and a tracker report under one ID', () => {
    const built = build();
    expect(built.reporter.record({ error: new TypeError('cleanup failed'), step: 'Close export stream', operation: 'export.close' }), 'recording returns the one incident ID').toEqual({ errorId: ID });
    expect(built.entries.map(entry => [entry.level, entry.message])).toEqual([['error', `[incident] Close export stream failed (error ${ID})`]]);
    expect(built.reports.map(report => report.context), 'recording reports the fixed operation and incident tag').toEqual([{ operation: 'export.close', level: 'error', incidentId: ID, label: 'TypeError' }]);
  });

  test("tracker: 'skip' still writes the host record, at the asked level, and sends nothing to the tracker", () => {
    const built = build();
    const recorded = built.reporter.record({ error: new Error('rate limit reached'), step: 'Site assistant reply', operation: 'assistant.reply' }, { level: 'warning', tracker: 'skip', exactSecrets: ['visitor-token-123'] });
    expect(recorded).toEqual({ errorId: ID });
    expect(built.entries.map(entry => entry.level)).toEqual(['warn']);
    expect(built.reports).toEqual([]);
  });

  test('a warning that is reported reaches the tracker as a warning', () => {
    const built = build();
    built.reporter.record({ error: new Error('slow'), step: 'Probe', operation: 'probe.run' }, { level: 'warning' });
    expect(built.reports[0]!.context.level).toBe('warning');
  });
});
