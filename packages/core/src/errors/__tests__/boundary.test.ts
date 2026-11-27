/**
 * @file The operation lifecycle around a boundary: one tracker start, one end outside the work's
 * catch, a verdict for every way the work settles, and no telemetry failure that changes the answer.
 */
import { describe, expect, test, vi } from 'vitest';
import type { OperationTracker } from '../../contracts/observability.js';
import { ClientFacingError } from '../../contracts/server/client-facing-error.js';
import { endOnce, NOOP_OPERATION_TRACKER, runOperation, startOperation, UNAVAILABLE_ERROR_ID, type ErrorReporter, type OperationRunResult } from '../reporter.js';
import { createRecordingReporter } from '../testing.js';

const ID = 'ERR-1111-2222-3333-4444';
const fallback = { message: 'The site export could not be completed.', action: 'Try the export again.' };
const base = { operation: 'site.export', scope: 'sites', step: 'Export site', fallback } as const;
const trackerWith = (end: OperationTracker['end']) => ({ trackOperation: (): OperationTracker => ({ run: <T>(fn: () => T) => fn(), end }) });
const boom = (): never => { throw new Error('tracker down'); };

/** Narrows to the described-failure arm, so a test cannot read `failure` off a cancellation by accident. */
function failureOf<T>(result: OperationRunResult<T>) {
  if (result.ok || 'cancelled' in result) throw new Error(`expected a described failure, got ${JSON.stringify(result)}`);
  return result;
}

describe('runOperation settles', () => {
  test('an incident is reported once, ends failed and returns safe words with the action and ID', async () => {
    const { reporter, reports } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
    const end = vi.fn();
    const result = await runOperation({ deps: { observability: trackerWith(end), reporter }, ...base,
      work: async () => { throw new Error('secret canary-XYZ'); },
    });
    expect(reports, 'one thrown incident sends one report').toHaveLength(1);
    expect(end.mock.calls, 'the incident ends once with a failed outcome').toEqual([[{ outcome: 'failed', failed: true }]]);
    expect(failureOf(result), 'incident words include the operation action and shared error ID').toEqual({ ok: false,
      failure: { kind: 'incident', status: 500, error: {
        code: 'INTERNAL_ERROR', message: `${fallback.message} ${fallback.action} (error ${ID})`, requestId: ID,
      } },
      verdict: { outcome: 'failed', failed: true },
    });
    expect(JSON.stringify(result), 'secret error text never enters the returned failure').not.toContain('canary-XYZ');
  });

  test('a refusal sends no report and ends refused without marking a failure', async () => {
    const { reporter, reports } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
    const end = vi.fn();
    const result = await runOperation({ deps: { observability: trackerWith(end), reporter }, ...base,
      work: async () => { throw new ClientFacingError({ apiError: { code: 'FORBIDDEN', message: 'Ask an owner for export access.' } }); },
    });
    expect(reports, 'refusals send no incident report').toHaveLength(0);
    expect(end.mock.calls, 'the refusal ends once without a failed flag').toEqual([[{ outcome: 'refused', failed: false }]]);
    expect(failureOf(result), 'the boundary returns the classified refusal').toEqual({ ok: false,
      failure: { kind: 'refusal', status: 403, error: { code: 'FORBIDDEN', message: 'Ask an owner for export access.' } },
      verdict: { outcome: 'refused', failed: false },
    });
  });

  test('successful work returns its value and ends completed without marking a failure', async () => {
    const { reporter } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
    const end = vi.fn();
    const result = await runOperation({ deps: { observability: trackerWith(end), reporter }, ...base, work: async () => 'exported' });
    expect(end.mock.calls, 'success ends once with a completed outcome').toEqual([[{ outcome: 'completed', failed: false }]]);
    expect(result, 'the boundary returns the successful work value').toEqual({ ok: true, value: 'exported', verdict: { outcome: 'completed', failed: false } });
  });

  test('classify decides a resolved value: a returned refusal ends refused, a returned producer-reported failure ends failed, neither reports', async () => {
    const { reporter, reports, entries } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
    const end = vi.fn();
    const classify = (value: { status: number }) => value.status === 500 ? { outcome: 'failed' as const, failed: true } : { outcome: 'refused' as const, failed: false };
    const refused = await runOperation({ deps: { observability: trackerWith(end), reporter }, ...base, classify, work: async () => ({ status: 413 }) });
    const failed = await runOperation({ deps: { observability: trackerWith(end), reporter }, ...base, classify, work: async () => ({ status: 500 }) });
    expect([refused.verdict, failed.verdict]).toEqual([{ outcome: 'refused', failed: false }, { outcome: 'failed', failed: true }]);
    expect(refused.ok && failed.ok, 'a returned value stays the value').toBe(true);
    expect(end.mock.calls).toEqual([[{ outcome: 'refused', failed: false }], [{ outcome: 'failed', failed: true }]]);
    expect([reports, entries], 'the producer owns its report; the classifier records nothing').toEqual([[], []]);
  });

  test('settle claiming cancellation returns the cancelled arm, ends cancelled and reports nothing', async () => {
    const { reporter, reports, entries } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
    const end = vi.fn();
    const result = await runOperation({ deps: { observability: trackerWith(end), reporter }, ...base,
      settle: error => error instanceof DOMException && error.name === 'AbortError' ? { outcome: 'cancelled', failed: false } : undefined,
      work: async () => { throw new DOMException('client went away', 'AbortError'); },
    });
    expect(result).toEqual({ ok: false, cancelled: true, verdict: { outcome: 'cancelled', failed: false } });
    expect(end.mock.calls).toEqual([[{ outcome: 'cancelled', failed: false }]]);
    expect([reports, entries]).toEqual([[], []]);
  });

  test('settle answering anything but cancelled cannot hide an incident', async () => {
    const { reporter, reports } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
    const result = await runOperation({ deps: { reporter }, ...base,
      settle: () => ({ outcome: 'refused', failed: false }), work: async () => { throw new Error('real failure'); } });
    expect(failureOf(result).failure.kind).toBe('incident');
    expect(reports).toHaveLength(1);
  });

  test('the operation attributes reach the incident record when the call gives none of its own', async () => {
    const { reporter, reports, entries } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
    await runOperation({ deps: { reporter }, ...base, attributes: { 'http.route': '/runs/:id' }, work: async () => { throw new Error('x'); } });
    expect(entries[0]!.meta!.attributes).toEqual({ 'http.route': '/runs/:id' });
    expect(reports[0]!.context.attributes).toEqual({ 'http.route': '/runs/:id' });
  });
});

describe('runOperation contains broken telemetry', () => {
  test('a tracker whose end throws leaves a success successful with zero reports and zero records', async () => {
    const { reporter, reports, entries } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
    const result = await runOperation({ deps: { observability: trackerWith(boom), reporter }, ...base, work: async () => 'exported' });
    expect(result).toEqual({ ok: true, value: 'exported', verdict: { outcome: 'completed', failed: false } });
    expect([reports, entries]).toEqual([[], []]);
  });

  test('a tracker whose end throws after an incident still returns that one incident', async () => {
    const { reporter, reports } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
    const result = await runOperation({ deps: { observability: trackerWith(boom), reporter }, ...base, work: async () => { throw new Error('x'); } });
    expect(failureOf(result).failure.error.requestId).toBe(ID);
    expect(reports).toHaveLength(1);
  });

  test('a throwing trackOperation runs the work once without a tracker and answers', async () => {
    const { reporter, reports } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
    const work = vi.fn(async () => 'exported');
    const result = await runOperation({ deps: { observability: { trackOperation: boom }, reporter }, ...base, work });
    expect(result.ok).toBe(true);
    expect(work, 'a tracker failure never retries the work').toHaveBeenCalledTimes(1);
    expect(reports).toHaveLength(0);
  });

  test('a trackOperation that hands back a rejecting promise falls back to the noop tracker, observed', async () => {
    const { reporter } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const rejecting = { trackOperation: () => Promise.reject(new Error('tracker offline')) as unknown as OperationTracker };
    const result = await runOperation({ deps: { observability: rejecting, reporter }, ...base, work: async () => 'exported' });
    await new Promise(resolve => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);
    expect(result.ok).toBe(true);
    expect(unhandled).not.toHaveBeenCalled();
  });

  test('with no observability the work runs under the noop tracker', async () => {
    const { reporter } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
    expect(await runOperation({ deps: { reporter }, ...base, work: async () => 7 })).toEqual({ ok: true, value: 7, verdict: { outcome: 'completed', failed: false } });
  });

  test('a throwing reporter gives the fixed fallback with the stand-in ID and writes to no console', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken: ErrorReporter = { describe: boom, record: boom };
    const result = await runOperation({ deps: { reporter: broken }, ...base, work: async () => { throw new Error('secret canary-XYZ'); } });
    expect(failureOf(result).failure).toEqual({ kind: 'incident', status: 500, error: {
      code: 'INTERNAL_ERROR', message: `${fallback.message} ${fallback.action} (error ${UNAVAILABLE_ERROR_ID})`, requestId: UNAVAILABLE_ERROR_ID } });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('startOperation and endOnce', () => {
  test('startOperation contains a throwing trackOperation and a non-tracker answer', () => {
    expect(startOperation({ observability: { trackOperation: boom }, name: 'tool.call' })).toBe(NOOP_OPERATION_TRACKER);
    expect(startOperation({ observability: { trackOperation: () => undefined as unknown as OperationTracker }, name: 'tool.call' })).toBe(NOOP_OPERATION_TRACKER);
    expect(startOperation({ name: 'tool.call' })).toBe(NOOP_OPERATION_TRACKER);
  });

  test('endOnce ends a tracker once, passes the feature outcome through, and contains a throwing end', () => {
    const end = vi.fn();
    const tracker: OperationTracker = { run: fn => fn(), end };
    endOnce({ tracker, verdict: { outcome: 'timed-out', failed: true } });
    endOnce({ tracker, verdict: { outcome: 'completed', failed: false } });
    expect(end.mock.calls).toEqual([[{ outcome: 'timed-out', failed: true }]]);
    expect(() => endOnce({ tracker: { run: fn => fn(), end: boom }, verdict: { outcome: 'failed', failed: true } })).not.toThrow();
  });

  test('the noop tracker is frozen and runs its function', () => {
    expect(Object.isFrozen(NOOP_OPERATION_TRACKER)).toBe(true);
    expect(NOOP_OPERATION_TRACKER.run(() => 3)).toBe(3);
  });
});

test('keeps the successful result when its classifier throws and records the classifier failure', async () => {
  const { reporter, reports, entries } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
  const end = vi.fn();
  const work = vi.fn(async () => 'exported');
  const error = new Error('classifier failed');
  const result = await runOperation({ deps: { observability: trackerWith(end), reporter }, ...base, work,
    classify: () => { throw error; },
  });
  expect(result).toEqual({ ok: true, value: 'exported', verdict: { outcome: 'completed', failed: false } });
  expect(work.mock.calls).toEqual([[]]);
  expect(end.mock.calls).toEqual([[{ outcome: 'completed', failed: false }]]);
  expect(entries).toMatchObject([{ meta: { errorId: ID, step: 'Export site (judge the result)' } }]);
  expect(reports).toMatchObject([{ context: { operation: 'site.export', incidentId: ID } }]);
  expect(reports[0]?.error).toBe(error);
});
