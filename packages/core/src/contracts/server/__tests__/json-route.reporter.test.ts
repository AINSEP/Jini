/**
 * Reporter mode of the Fetch `jsonRoute` (P4-J2a): one `http.route` operation per request, one
 * incident path, and the legacy SEC-005 sink only when the host passed no `errors`. Uses a real
 * reporter over recording ports, a recording `trackOperation`, and a legacy sink spy.
 *
 * Mutations these tests must catch (run by hand: edit, see red, revert):
 *   M drop-classify                         returned refusals end `completed`         → refusal row
 *   M record-returned-INTERNAL_ERROR        verdictFor records the producer's failure → reporter-backed INTERNAL_ERROR row
 *   M call-onInternalError-in-reporter-mode both sinks fire                           → "never called" row
 *   M url-not-pattern                       `http.route` = request URL               → pattern row
 *   M onError-after-reporter                reporter describes before host policy     → onError row
 *   M rethrow-policy-error                  policy error replaces the original        → throwing onError row
 *   M settle-ignores-abort-like             any throw after disconnect is cancelled   → non-abort row
 *   M second-describe                       a second boundary mints a second ID       → single-id row
 */
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../result.js';
import { ClientFacingError } from '../client-facing-error.js';
import { jsonRoute, type JsonRouteSpec, type ReportRouteInternalError, type RouteErrorPorts, type RouteHostContext } from '../json-route.js';
import { createInMemoryServer } from '../testing.js';
import { createLocalSameOriginPolicy } from '../origin.js';
import { createRecordingReporter } from '../../../errors/testing.js';
import { UNAVAILABLE_ERROR_ID, type ErrorReporter } from '../../../errors/reporter.js';
import type { OperationTracker, OperationTrackingInput, OperationTrackingOutcome } from '../../observability.js';

const IDS = ['ERR-AAAA-AAAA-AAAA-0001', 'ERR-AAAA-AAAA-AAAA-0002', 'ERR-AAAA-AAAA-AAAA-0003'];
const originPolicy = createLocalSameOriginPolicy({ port: () => 7000, env: {}, config: { allowedOriginsEnvVar: 'A', webPortEnvVar: 'W', bindHostEnvVar: 'B' } });
type Spec = JsonRouteSpec<unknown, unknown, null>;

interface HarnessOptions { readonly endThrows?: boolean; readonly trackThrows?: boolean; readonly reporterThrows?: boolean }

function harness(options: HarnessOptions = {}) {
  const log: string[] = [];
  const starts: OperationTrackingInput[] = [];
  const ends: OperationTrackingOutcome[] = [];
  const recording = createRecordingReporter({ ids: IDS, iso: '2026-01-01T00:00:00.000Z' });
  // Boundary calls (describe) are counted apart from the records a host policy or producer owns.
  const calls = { describe: 0, record: 0 };
  const reporter: ErrorReporter = {
    describe: (args, opts) => { calls.describe += 1; if (options.reporterThrows) throw new Error('reporter broke'); return recording.reporter.describe(args, opts); },
    record: (args, opts) => { calls.record += 1; return recording.reporter.record(args, opts); },
  };
  const tracker: OperationTracker = {
    run: fn => fn(),
    end: outcome => { log.push('end'); ends.push(outcome); if (options.endThrows) throw new Error('tracker end broke'); },
  };
  const errors: RouteErrorPorts = { reporter, observability: { trackOperation: input => {
    if (options.trackThrows) throw new Error('trackOperation broke');
    log.push('start'); starts.push(input); return tracker;
  } } };
  const onInternalError = vi.fn();
  const legacyReports: unknown[] = [];
  // Behaves like the host's legacy reporter: records, then forwards to the sink it was handed.
  const reportInternalError: ReportRouteInternalError = ({ report, message }, optional) => {
    legacyReports.push(report);
    optional?.onInternalError?.({ ...report, correlationId: 'req-legacy', logSource: 'legacy' });
    return { code: 'INTERNAL_ERROR', message, requestId: 'req-legacy' };
  };
  let handled = 0;
  const mount = (spec: Partial<Spec> = {}, { withErrors = true }: { withErrors?: boolean } = {}) => {
    const app = createInMemoryServer();
    const host: RouteHostContext = { originPolicy, onInternalError, ...(withErrors ? { errors } : {}) };
    const handle = spec.handle ?? (({ input }) => ok({ value: input }));
    app.server.route(jsonRoute({ deps: null, reportInternalError, spec: {
      method: 'post', path: '/r', parse: ({ body }) => ok({ value: body }), ...spec,
      handle: (...args) => { handled += 1; return handle(...args); },
    } }, { host }));
    return app;
  };
  return { log, starts, ends, recording, calls, errors, onInternalError, legacyReports, mount, handledCount: () => handled };
}

const post = (body: unknown, init: { signal?: AbortSignal } = {}) =>
  new Request('http://local/r', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, ...(init.signal ? { signal: init.signal } : {}) });
const errorOf = async (response: Response) => (await response.json() as { error: { code: string; message: string; requestId?: string } }).error;
const verdict = (outcome: string, failed: boolean, status: number) => ({ outcome, failed, attributes: { 'http.status_code': status } });

describe('jsonRoute reporter mode', () => {
  it('a throwing route with a reporter returns one ERR- id that matches the single host record and the single tracker report', async () => {
    const h = harness();
    const response = await h.mount({ handle: () => { throw new Error('secret db path /var/x.db'); } }).fetch(post({}));
    const text = await response.text();
    const wire = (JSON.parse(text) as { error: { code: string; requestId: string } }).error;
    expect([response.status, wire.code, wire.requestId, text.includes('secret')]).toEqual([500, 'INTERNAL_ERROR', IDS[0], false]);
    expect(h.recording.entries.map(entry => (entry.meta as { errorId?: string } | undefined)?.errorId)).toEqual([IDS[0]]);
    expect(h.recording.reports.map(report => report.context.incidentId)).toEqual([IDS[0]]);
    expect([h.calls.describe, h.calls.record, h.ends.length]).toEqual([1, 0, 1]);
    expect(h.ends[0]).toMatchObject({ outcome: 'failed', failed: true });
    expect(h.onInternalError).not.toHaveBeenCalled();
  });

  it('one http.route operation per request, attribute http.route is the pattern', async () => {
    const h = harness();
    const app = h.mount({ method: 'get', path: '/runs/:id', parse: ({ params }) => ok({ value: { id: params.id } }) });
    const response = await app.fetch(new Request('http://local/runs/abc?x=1'));
    h.log.push('returned');
    expect([response.status, await response.json()]).toEqual([200, { id: 'abc' }]);
    expect(h.starts).toEqual([{ name: 'http.route', attributes: { 'http.method': 'GET', 'http.route': '/runs/:id' } }]);
    expect(JSON.stringify(h.starts)).not.toMatch(/abc|x=1/);
    expect(h.ends).toEqual([verdict('completed', false, 200)]);
    // The operation ends before the response is handed back, never after.
    expect(h.log).toEqual(['start', 'end', 'returned']);
  });

  it('a returned refusal ends the operation as refused with no report', async () => {
    const cases: { readonly spec: Partial<Spec>; readonly request: () => Request; readonly status: number; readonly code: string }[] = [
      { spec: { parse: () => err({ error: { code: 'BAD_REQUEST', message: 'no' } }) }, request: () => post({}), status: 400, code: 'BAD_REQUEST' },
      { spec: { handle: () => err({ error: { code: 'NOT_FOUND', message: 'gone' } }) }, request: () => post({}), status: 404, code: 'NOT_FOUND' },
      // The Fetch body ceiling in request-body.ts: refused at the raw read, before parse or handle.
      { spec: { maxBodyBytes: 16 }, request: () => post({ pad: 'x'.repeat(64) }), status: 413, code: 'PAYLOAD_TOO_LARGE' },
    ];
    for (const { spec, request, status, code } of cases) {
      const h = harness();
      const response = await h.mount(spec).fetch(request());
      expect([response.status, (await errorOf(response)).code]).toEqual([status, code]);
      expect(h.ends).toEqual([verdict('refused', false, status)]);
      expect([h.recording.entries.length, h.recording.reports.length, h.calls.describe, h.calls.record]).toEqual([0, 0, 0, 0]);
    }
  });

  it('a thrown ClientFacingError is refused at its own status with no id', async () => {
    const h = harness();
    const response = await h.mount({ handle: () => { throw new ClientFacingError({ apiError: { code: 'CONFLICT', message: 'That name is taken.' } }); } }).fetch(post({}));
    expect([response.status, await response.json()]).toEqual([409, { error: { code: 'CONFLICT', message: 'That name is taken.' } }]);
    expect([h.recording.entries.length, h.recording.reports.length]).toEqual([0, 0]);
    expect(h.ends[0]).toMatchObject({ outcome: 'refused', failed: false });
  });

  it('ports.onError answers before the reporter and the reporter records nothing for it', async () => {
    const answers: readonly [unknown, number, string][] = [[new Error('x'), 418, 'refused'], [new ClientFacingError({ apiError: { code: 'CONFLICT', message: 'c' } }), 418, 'refused'], [new Error('y'), 503, 'failed']];
    for (const [thrown, status, outcome] of answers) {
      const h = harness();
      const response = await h.mount({ handle: () => { throw thrown; }, ports: { onError: () => new Response('mine', { status }) } }).fetch(post({}));
      expect([response.status, await response.text()]).toEqual([status, 'mine']);
      expect([h.calls.describe, h.calls.record, h.recording.entries.length, h.recording.reports.length]).toEqual([0, 0, 0, 0]);
      expect(h.ends).toEqual([verdict(outcome, outcome === 'failed', status)]);
    }
  });

  it("a throwing onError still answers with the original failure's id and records the policy failure separately", async () => {
    const h = harness();
    const original = new Error('original failure');
    const policy = new Error('policy failure');
    const response = await h.mount({ handle: () => { throw original; }, ports: { onError: () => { throw policy; } } }).fetch(post({}));
    const text = await response.text();
    // The policy record is written first (IDS[0]); the original is described after it (IDS[1]).
    const byId = new Map(h.recording.reports.map(report => [report.context.incidentId, report.error]));
    expect([response.status, (JSON.parse(text) as { error: { requestId: string } }).error.requestId, text.includes(IDS[0]!)]).toEqual([500, IDS[1], false]);
    expect([byId.get(IDS[0]), byId.get(IDS[1]), byId.size]).toEqual([policy, original, 2]);
    expect([h.calls.record, h.calls.describe]).toEqual([1, 1]);
    expect(h.ends).toHaveLength(1);
  });

  it('without errors the legacy path still answers with requestId and calls onInternalError', async () => {
    const h = harness();
    const response = await h.mount({ handle: () => { throw new Error('x'); } }, { withErrors: false }).fetch(post({}));
    expect([response.status, (await errorOf(response)).requestId]).toEqual([500, 'req-legacy']);
    expect([h.onInternalError.mock.calls.length, h.legacyReports.length, h.starts.length, h.recording.reports.length]).toEqual([1, 1, 0, 0]);
  });

  it('with errors, a passed onInternalError is never called', async () => {
    const h = harness();
    const response = await h.mount({ handle: () => { throw new Error('x'); } }).fetch(post({}));
    expect([response.status, (await errorOf(response)).requestId]).toEqual([500, IDS[0]]);
    expect([h.onInternalError.mock.calls.length, h.legacyReports.length, h.recording.reports.length]).toEqual([0, 0, 1]);
  });

  it('a disconnected client gets no write, the operation ends cancelled, nothing is reported', async () => {
    const exits: readonly ((controller: AbortController) => unknown)[] = [
      controller => { controller.abort(); return ok({ value: { n: 1 } }); },
      controller => { controller.abort(); throw controller.signal.reason; },
      controller => { controller.abort(); throw new DOMException('stopped', 'AbortError'); },
    ];
    for (const exit of exits) {
      const h = harness();
      const controller = new AbortController();
      const response = await h.mount({ handle: () => exit(controller) as never }).fetch(post({}, { signal: controller.signal }));
      expect([response.status, response.body]).toEqual([499, null]);
      expect(h.ends).toEqual([verdict('cancelled', false, 499)]);
      expect([h.recording.entries.length, h.recording.reports.length, h.calls.describe]).toEqual([0, 0, 0]);
    }
  });

  it('a non-abort throw after a disconnect, or an abort-like throw with the client still there, is still recorded', async () => {
    for (const disconnect of [true, false]) {
      const h = harness();
      const controller = new AbortController();
      const response = await h.mount({ handle: () => {
        if (disconnect) { controller.abort(); throw new Error('db down'); }
        throw new DOMException('upstream gave up', 'AbortError');
      } }).fetch(post({}, { signal: controller.signal }));
      expect([response.status, h.recording.reports.length]).toEqual([500, 1]);
      expect(h.ends[0]).toMatchObject({ outcome: 'failed', failed: true });
    }
  });

  it('a tracker whose end throws leaves a successful request answered 200 with zero reports', async () => {
    const h = harness({ endThrows: true });
    const response = await h.mount().fetch(post({ n: 1 }));
    expect([response.status, await response.json()]).toEqual([200, { n: 1 }]);
    expect([h.recording.entries.length, h.recording.reports.length, h.ends.length, h.handledCount()]).toEqual([0, 0, 1, 1]);
  });

  it('a throwing trackOperation still answers, and the handler is never retried', async () => {
    const h = harness({ trackThrows: true });
    const response = await h.mount().fetch(post({ n: 2 }));
    expect([response.status, await response.json(), h.handledCount(), h.recording.reports.length]).toEqual([200, { n: 2 }, 1, 0]);
  });

  it('a throwing reporter still answers with the fixed fallback and the unavailable id, without retrying the handler', async () => {
    const h = harness({ reporterThrows: true });
    const response = await h.mount({ handle: () => { throw new Error('secret'); } }).fetch(post({}));
    const text = await response.text();
    expect([response.status, (JSON.parse(text) as { error: { requestId: string } }).error.requestId, text.includes('secret'), h.handledCount()]).toEqual([500, UNAVAILABLE_ERROR_ID, false, 1]);
    expect(h.ends).toHaveLength(1);
  });

  it('a route that returns the reporter-backed INTERNAL_ERROR ends failed with exactly one report', async () => {
    const h = harness();
    const response = await h.mount({ handle: () => {
      // The producer: an in-route reporter-backed failure that writes its own one record.
      const { errorId } = h.errors.reporter.record({ error: new Error('disk full'), step: 'Save run', operation: 'http.route' });
      return err({ error: { code: 'INTERNAL_ERROR', message: 'Could not save.', requestId: errorId } });
    } }).fetch(post({}));
    expect([response.status, (await errorOf(response)).requestId]).toEqual([500, IDS[0]]);
    expect([h.recording.entries.length, h.recording.reports.length, h.calls.record, h.calls.describe]).toEqual([1, 1, 1, 0]);
    expect(h.ends).toEqual([verdict('failed', true, 500)]);
  });
});
