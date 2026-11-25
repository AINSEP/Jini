/**
 * Reporter mode of the Express `mountJsonRoute` (P4-J2b): one `http.route` operation per request,
 * the operation ends before the adapter writes, one incident path, and the legacy SEC-005 sink only
 * when the host passed no `errors`. Real Express app, real socket, real `express.json()` in front,
 * a real reporter over recording ports and a recording `trackOperation`. Mirrors core's
 * `json-route.reporter.test.ts` for the Fetch route.
 *
 * Mutations these tests must catch (run by hand: edit, see red, revert):
 *   M write-before-end            the answer is written inside the operation      → success-order / 413 rows
 *   M drop-classify               returned refusals end `completed`               → refusal row
 *   M url-not-pattern             `http.route` = `req.originalUrl`                → pattern row
 *   M onInternalError-in-reporter both sinks fire                                 → "never called" row
 *   M rethrow-policy-error        policy error replaces the original              → throwing onError row
 *   M returned-internal-refused   a producer-reported INTERNAL_ERROR ends refused → returned INTERNAL_ERROR row
 *   M settle-ignores-abort-like   any throw after disconnect is cancelled         → non-abort row
 *   M second-answer               a failure after headers writes again            → headers-sent row
 *   M write-after-disconnect      a recorded failure is written to a gone client  → non-abort row
 *   M onError-after-reporter      the reporter describes before the host policy   → onError row
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientFacingError, err, ok, type RouteErrorPorts, type RouteHostContext, type ServerApiError } from '@jini-ai/core/contracts/server';
import { createRecordingReporter } from '@jini-ai/core/errors/testing';
import type { ErrorReporter } from '@jini-ai/core/errors/reporter';
import { defineJsonRoute, mountJsonRoute } from '../adapter.js';
import { rejectOversizedJsonBody } from '../middleware.js';
import { createReporterRouteInternalError } from '../reporter-internal-error.js';
import type { JsonRouteSpec, RouteMountOptions } from '../types.js';

const IDS = ['ERR-AAAA-AAAA-AAAA-0001', 'ERR-AAAA-AAAA-AAAA-0002', 'ERR-AAAA-AAAA-AAAA-0003'];
const ERR_ID = /ERR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/;
type Spec = JsonRouteSpec<unknown, unknown, object>;
type Ending = { outcome: string; failed: boolean; attributes?: Record<string, string | number> };

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function harness(options: { readonly endThrows?: boolean } = {}) {
  const log: string[] = [];
  const starts: { name: string; attributes?: unknown }[] = [];
  const ends: Ending[] = [];
  const recording = createRecordingReporter({ ids: IDS, iso: '2026-01-01T00:00:00.000Z' });
  const calls = { describe: 0, record: 0 };
  const reporter: ErrorReporter = {
    describe: (args, opts) => { calls.describe += 1; return recording.reporter.describe(args, opts); },
    record: (args, opts) => { calls.record += 1; return recording.reporter.record(args, opts); },
  };
  let onEnd: () => void = () => {};
  const ended = () => new Promise<void>((resolve) => { onEnd = resolve; });
  // A fresh tracker per operation: `endOnce` ends each tracker object once.
  const errors: RouteErrorPorts = { reporter, observability: { trackOperation: (input) => {
    log.push('start'); starts.push(input);
    return { run: (fn) => fn(), end: (outcome) => { log.push('end'); ends.push(outcome as Ending); onEnd(); if (options.endThrows) throw new Error('tracker end broke'); } };
  } } };
  const onInternalError = vi.fn();
  let handled = 0;
  async function mount(spec: Partial<Spec> = {}, { withErrors = true, upstream, mountOptions, errorMiddleware }: { withErrors?: boolean; upstream?: express.RequestHandler; mountOptions?: RouteMountOptions<object>; errorMiddleware?: express.ErrorRequestHandler } = {}) {
    const app = express();
    app.use(express.json({ limit: 1024 }));
    if (upstream) app.use(upstream);
    // Every adapter write goes through `res.status(...)`; logging it orders writes against `end`.
    app.use((_req, res, next) => { const status = res.status.bind(res); res.status = (code: number) => { log.push(`write ${code}`); return status(code); }; next(); });
    const route = defineJsonRoute<unknown, unknown, object>({
      method: 'post', path: '/runs/:id', parse: ({ body }) => ok({ value: body }),
      handle: () => { handled += 1; return ok({ value: { saved: true } }); }, ...spec,
    });
    const adapter = { onInternalError, ...(withErrors ? { errors } : {}) } as unknown as RouteHostContext;
    const mountApp = errorMiddleware ? { post: (path: string, handler: (req: express.Request, res: express.Response) => Promise<void>) => {
      app.post(path, (req, res, next) => { void handler(req, res).catch(next); });
    } } as unknown as express.Express : app;
    mountJsonRoute({ app: mountApp, spec: route, deps: {}, adapter }, mountOptions);
    if (errorMiddleware) app.use(errorMiddleware);
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const { port } = server.address() as AddressInfo;
    return (body: unknown = {}, { path = '/runs/abc', signal }: { path?: string; signal?: AbortSignal } = {}) =>
      fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body), ...(signal ? { signal } : {}) });
  }
  return { log, starts, ends, calls, errors, entries: recording.entries, reports: recording.reports, onInternalError, mount, ended, handled: () => handled };
}

describe('mountJsonRoute reporter mode', () => {
  it('a throwing route with a reporter returns one ERR- id that matches the single host record and the single tracker report', async () => {
    const h = harness();
    const post = await h.mount({ handle: () => { throw new Error('db file /var/secret.db locked'); } });
    const response = await post();
    const body = await response.json() as { error: ServerApiError };
    expect(response.status).toBe(500);
    expect(body.error.requestId).toBe(IDS[0]);
    expect(body.error.message).toContain('The server could not finish this request.');
    expect(body.error.message).toContain(`(error ${IDS[0]})`);
    expect(JSON.stringify(body)).not.toContain('secret.db');
    expect([h.calls.describe, h.entries.length, h.reports.length]).toEqual([1, 1, 1]);
    expect(JSON.stringify(h.entries[0])).toContain(IDS[0]);
    expect(h.reports[0]?.context).toMatchObject({ incidentId: IDS[0], operation: 'http.route' });
    expect(h.ends).toEqual([{ outcome: 'failed', failed: true }]);
  });

  it('one http.route operation per request, attribute http.route is the pattern', async () => {
    const h = harness();
    const post = await h.mount();
    await post({}, { path: '/runs/abc?x=1' });
    await post({}, { path: '/runs/def' });
    expect(h.starts).toEqual([
      { name: 'http.route', attributes: { 'http.method': 'POST', 'http.route': '/runs/:id' } },
      { name: 'http.route', attributes: { 'http.method': 'POST', 'http.route': '/runs/:id' } },
    ]);
    expect(h.ends).toEqual([
      { outcome: 'completed', failed: false, attributes: { 'http.status_code': 200 } },
      { outcome: 'completed', failed: false, attributes: { 'http.status_code': 200 } },
    ]);
  });

  it('success ends the operation before the response is written', async () => {
    const h = harness();
    const post = await h.mount({}, {});
    const response = await post();
    expect([response.status, await response.json()]).toEqual([200, { saved: true }]);
    expect(h.log).toEqual(['start', 'end', 'write 200']);
    expect(h.reports).toEqual([]);
  });

  it('parse, handle and in-route 413 refusals end refused with no record', async () => {
    const h = harness();
    const parseRefusal = await h.mount({ parse: () => err({ error: { code: 'BAD_REQUEST', message: 'Name the run.' } }) });
    expect((await parseRefusal()).status).toBe(400);
    const handleRefusal = await h.mount({ handle: () => err({ error: { code: 'NOT_FOUND', message: 'No such run.' } }) });
    expect((await handleRefusal()).status).toBe(404);
    const capped = await h.mount({ maxBodyBytes: 16 });
    const tooLarge = await capped({ p: 'a'.repeat(64) });
    expect([tooLarge.status, (await tooLarge.json() as { error: ServerApiError }).error.code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
    expect(h.ends.map((end) => [end.outcome, end.attributes?.['http.status_code']])).toEqual([['refused', 400], ['refused', 404], ['refused', 413]]);
    expect(h.log.filter((entry) => entry !== 'start')).toEqual(['end', 'write 400', 'end', 'write 404', 'end', 'write 413']);
    expect([h.entries.length, h.reports.length]).toEqual([0, 0]);
  });

  it('a thrown ClientFacingError is refused at its own status with no id', async () => {
    const h = harness();
    const post = await h.mount({ handle: () => { throw new ClientFacingError({ apiError: { code: 'CONFLICT', message: 'That run already finished.' } }); } });
    const response = await post();
    const body = await response.json() as { error: ServerApiError };
    expect([response.status, body.error.code, body.error.message, body.error.requestId]).toEqual([409, 'CONFLICT', 'That run already finished.', undefined]);
    expect(h.ends).toEqual([{ outcome: 'refused', failed: false }]);
    expect([h.entries.length, h.reports.length]).toEqual([0, 0]);
  });

  it('onError answers first and a throwing onError keeps the original incident id in the reply', async () => {
    const h = harness();
    const answered = await h.mount({ handle: () => { throw new ClientFacingError({ apiError: { code: 'CONFLICT', message: 'x' } }); }, ports: { onError: ({ res }) => { res.status(418).json({ flat: true }); } } });
    const first = await answered();
    expect([first.status, await first.json()]).toEqual([418, { flat: true }]);
    expect(h.ends[0]).toEqual({ outcome: 'refused', failed: false, attributes: { 'http.status_code': 418 } });
    expect([h.entries.length, h.reports.length]).toEqual([0, 0]);

    const original = new Error('original failure');
    const throwing = await h.mount({ handle: () => { throw original; }, ports: { onError: () => { throw new Error('policy broke'); } } });
    const second = await throwing();
    const body = await second.json() as { error: ServerApiError };
    // The policy failure is recorded first (ERR-…0001); the reply carries the original's own ID.
    expect([second.status, body.error.requestId]).toEqual([500, IDS[1]]);
    expect(h.calls).toEqual({ describe: 1, record: 1 });
    expect(h.reports.map((report) => report.context.incidentId)).toEqual([IDS[0], IDS[1]]);
    expect(h.ends[1]).toEqual({ outcome: 'failed', failed: true });
  });

  it('an opted-in host policy rejection reaches Express unchanged after the operation ends', async () => {
    const h = harness();
    const policyError = { status: 422 };
    const nextError = vi.fn();
    const post = await h.mount({ handle: () => { throw new Error('original'); }, ports: { onError: () => { throw policyError; } } }, {
      mountOptions: { preserveHostErrorRouting: true },
      errorMiddleware: (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        nextError(error);
        expect(h.log).toEqual(['start', 'end']);
        expect(h.ends).toEqual([{ outcome: 'failed', failed: true }]);
        expect([h.calls.describe, h.calls.record, h.entries.length, h.reports.length]).toEqual([0, 0, 0, 0]);
        res.status(422).json({ host: 'refused' });
      },
    });
    const response = await post();
    expect([response.status, await response.json()]).toEqual([422, { host: 'refused' }]);
    expect(nextError).toHaveBeenCalledTimes(1);
    expect(nextError.mock.calls[0]?.[0]).toBe(policyError);
    expect(h.log).toEqual(['start', 'end', 'write 422']);
  });

  it('an opted-in pre-header JSON or buffered raw write failure uses the existing host writer once', async () => {
    const h = harness();
    const reportInternalError = createReporterRouteInternalError({ reporter: h.errors.reporter });
    const onError = vi.fn<NonNullable<NonNullable<Spec['ports']>['onError']>>(({ res, error }) => {
      expect(h.ends).toHaveLength(1);
      const failure = reportInternalError({ report: { error }, logSource: 'host-write', message: 'Host write failed.' });
      res.status(503).json({ host: failure });
    });
    const handle = vi.fn(() => ok({ value: { big: 1n } }));
    const post = await h.mount({ handle, ports: { onError } }, { mountOptions: { preserveHostErrorRouting: true } });
    const response = await post();
    expect([response.status, await response.json()]).toEqual([503, { host: { code: 'INTERNAL_ERROR', message: `Host write failed. (error ${IDS[0]})`, requestId: IDS[0] } }]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledTimes(1);
    expect([h.starts.length, h.ends.length, h.calls.describe, h.calls.record, h.entries.length, h.reports.length]).toEqual([1, 1, 0, 1, 1, 1]);
  });

  it('no second response after headers are sent', async () => {
    const h = harness();
    const post = await h.mount({
      handle: () => { throw new Error('original'); },
      ports: { onError: ({ res }) => { res.status(502).json({ partial: true }); throw new Error('policy broke after writing'); } },
    });
    const response = await post();
    expect([response.status, await response.json()]).toEqual([502, { partial: true }]);
    expect(h.log.filter((entry) => entry.startsWith('write'))).toEqual(['write 502']);
    // Both failures are still on record: the policy's and the original incident.
    expect(h.reports.length).toBe(2);
  });

  it('without errors the legacy path still calls onInternalError', async () => {
    const h = harness();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const post = await h.mount({ handle: () => { throw new Error('boom'); } }, { withErrors: false });
    const response = await post();
    const body = await response.json() as { error: ServerApiError };
    expect(response.status).toBe(500);
    expect(h.onInternalError).toHaveBeenCalledTimes(1);
    expect(h.onInternalError.mock.calls[0]?.[0]).toMatchObject({ correlationId: body.error.requestId });
    expect([h.starts.length, h.entries.length]).toEqual([0, 0]);
    errorSpy.mockRestore();
  });

  it('with errors, onInternalError is never called', async () => {
    const h = harness();
    const post = await h.mount({ handle: () => { throw new Error('boom'); } });
    expect((await post()).status).toBe(500);
    expect(h.onInternalError).not.toHaveBeenCalled();
    expect(h.reports.length).toBe(1);
  });

  async function disconnectWith(rejection: (signal: AbortSignal) => unknown) {
    const h = harness();
    const post = await h.mount({ handle: (_args, optional) => new Promise((_resolve, reject) => {
      // The adapter always passes the response-close signal; the optional type serves other callers.
      const signal = optional?.signal as AbortSignal;
      signal.addEventListener('abort', () => reject(rejection(signal)));
      client.abort();
    }) });
    const client = new AbortController();
    const ended = h.ended();
    await expect(post({}, { signal: client.signal })).rejects.toThrow();
    await ended;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return h;
  }

  it('a disconnected client gets no write and no report for an abort-like throw', async () => {
    const h = await disconnectWith((signal) => signal.reason);
    expect(h.ends).toEqual([{ outcome: 'cancelled', failed: false, attributes: { 'http.status_code': 499 } }]);
    expect(h.log.filter((entry) => entry.startsWith('write'))).toEqual([]);
    expect([h.entries.length, h.reports.length]).toEqual([0, 0]);
  });

  it('a non-abort throw after disconnect is reported but not written', async () => {
    const h = await disconnectWith(() => new Error('db broke while the client left'));
    expect(h.ends).toEqual([{ outcome: 'failed', failed: true }]);
    expect(h.log.filter((entry) => entry.startsWith('write'))).toEqual([]);
    expect([h.entries.length, h.reports.length]).toEqual([1, 1]);
  });

  it('a tracker whose end throws leaves a successful 200 with zero reports', async () => {
    const h = harness({ endThrows: true });
    const post = await h.mount();
    const response = await post();
    expect([response.status, await response.json()]).toEqual([200, { saved: true }]);
    expect([h.entries.length, h.reports.length, h.handled()]).toEqual([0, 0, 1]);
  });

  it('a returned reporter-backed INTERNAL_ERROR ends failed without a second report', async () => {
    const h = harness();
    const reportInternalError = createReporterRouteInternalError({ reporter: h.errors.reporter });
    const post = await h.mount({ handle: () => err({ error: reportInternalError({ report: { error: new Error('provider down') }, logSource: 'run-start', message: 'The run could not start.' }) }) });
    const response = await post();
    const body = await response.json() as { error: ServerApiError };
    expect([response.status, body.error.requestId]).toEqual([500, IDS[0]]);
    expect(h.ends).toEqual([{ outcome: 'failed', failed: true, attributes: { 'http.status_code': 500 } }]);
    expect([h.calls.describe, h.calls.record, h.reports.length]).toEqual([0, 1, 1]);
  });

  it('an oversized Express body never starts an http.route operation', async () => {
    const h = harness();
    // The host's own body ceiling, upstream of the route (`middleware.ts`), not the adapter's in-route cap.
    const upstream = rejectOversizedJsonBody({ maxBytes: 32, errorResponseFactory: ({ maxBytes }) => ({ error: { code: 'PAYLOAD_TOO_LARGE', message: `Over ${maxBytes} bytes.` } }) });
    const post = await h.mount({}, { upstream });
    const response = await post({ p: 'a'.repeat(128) });
    expect(response.status).toBe(413);
    expect([h.starts.length, h.ends.length, h.handled(), h.reports.length]).toEqual([0, 0, 0, 0]);
  });

  it('a body that cannot be serialized is recorded once as a write failure and answered, with no second operation or handler run', async () => {
    const h = harness();
    const post = await h.mount({ handle: () => { h.log.push('handle'); return ok({ value: { big: 1n } }); } });
    const response = await post();
    const body = await response.json() as { error: ServerApiError };
    expect([response.status, body.error.requestId]).toEqual([500, IDS[0]]);
    expect(h.log.filter((entry) => entry === 'start' || entry === 'handle')).toEqual(['start', 'handle']);
    expect(h.ends).toEqual([{ outcome: 'completed', failed: false, attributes: { 'http.status_code': 200 } }]);
    expect([h.calls.describe, h.calls.record, h.reports.length]).toEqual([0, 1, 1]);
  });
});

describe('createReporterRouteInternalError', () => {
  const recordingFor = () => createRecordingReporter({ ids: IDS, iso: '2026-01-01T00:00:00.000Z' });

  it('records once and puts the same id in the message and requestId', () => {
    const { reporter, entries, reports } = recordingFor();
    const apiError = createReporterRouteInternalError({ reporter })({ report: { error: new Error('x') }, logSource: 'run-start', message: 'The run could not start.' });
    expect(apiError).toEqual({ code: 'INTERNAL_ERROR', message: `The run could not start. (error ${IDS[0]})`, requestId: IDS[0] });
    expect([entries.length, reports.length]).toEqual([1, 1]);
  });

  it('passes http.route, the log source and only the bounded string attributes to the reporter', () => {
    const record = vi.fn((): { errorId: string } => ({ errorId: 'ERR-AAAA-AAAA-AAAA-0001' }));
    const error = new Error('x');
    createReporterRouteInternalError({ reporter: { record } })({
      report: { error, runId: 'run-1', batchId: 7, source: 'agent', provider: 'p', operation: 'start', body: 'secret body', path: '/runs/run-1' },
      logSource: 'run-start', message: 'm',
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({ error, step: 'run-start', operation: 'http.route' }, { attributes: { runId: 'run-1', source: 'agent', provider: 'p', operation: 'start' } });
  });

  it('ignores a legacy onInternalError sink', () => {
    const { reporter, entries } = recordingFor();
    const onInternalError = vi.fn();
    createReporterRouteInternalError({ reporter })({ report: { error: new Error('x') }, logSource: 'run-start', message: 'm' }, { onInternalError });
    expect(onInternalError).not.toHaveBeenCalled();
    expect(entries.length).toBe(1);
  });
});
