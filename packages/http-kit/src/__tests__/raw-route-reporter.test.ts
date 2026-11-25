// P4-J2b raw reporter mode: with `adapter.errors`, a raw route is one `http.route` operation that spans
// the gates, `handle` and the creation of its `Response`, never the body's drain; a thrown failure gets
// one incident ID (one host record, one tracker report), and a stream that fails after the head went out
// is recorded once and the connection cut. Without `errors` the legacy SEC-005 sink is unchanged.
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { ObservabilityPort, OperationTrackingOutcome } from '@jini-ai/core/contracts/observability';
import { createRecordingReporter } from '@jini-ai/core/errors/testing';
import { defineRawRoute, mountRawRoute } from '../raw-route.js';
import type { RawRouteSpec } from '../types.js';
import { listen } from './route-test-host.js';
import { createReporterRouteInternalError } from '../reporter-internal-error.js';

const ISO = '2026-01-01T00:00:00.000Z';
const ID = 'ERR-AAAA-BBBB-CCCC-0001';

interface TrackedOperation { readonly name: string; readonly attributes: unknown; ends: OperationTrackingOutcome[] }

/** A real reporter over recording ports, plus a tracker port that keeps every operation and its end. */
function reporterPorts() {
  // A spare ID, so a second record would succeed and be counted rather than fail on an exhausted list.
  const { reporter, entries, reports } = createRecordingReporter({ ids: [ID, 'ERR-AAAA-BBBB-CCCC-0009'], iso: ISO });
  const operations: TrackedOperation[] = [];
  const observability: Pick<ObservabilityPort, 'trackOperation'> = {
    trackOperation: ({ name, attributes }) => {
      const operation: TrackedOperation = { name, attributes, ends: [] };
      operations.push(operation);
      return { run: (fn) => fn(), end: (outcome) => { operation.ends.push(outcome); } };
    },
  };
  return { errors: { reporter, observability }, entries, reports, operations };
}

/** Same-origin is not under test here; the host context only carries `errors`. */
const ANY_ORIGIN = { isSameOrigin: () => true };

function mounted(spec: RawRouteSpec<object>, ports: ReturnType<typeof reporterPorts>) {
  const app = express();
  mountRawRoute({ app, spec, deps: {}, adapter: { originPolicy: ANY_ORIGIN, errors: ports.errors } });
  return listen({ app });
}

describe('mountRawRoute reporter mode', () => {
  it('raw route with a reporter answers a throw with one ERR- id matching one host record and one tracker report', async () => {
    const ports = reporterPorts();
    const spec = defineRawRoute<object>({ method: 'get', path: '/files/:id', handle: async () => { throw new Error('secret dsn'); } });
    const response = await fetch(`${await mounted(spec, ports)}/files/abc?token=t`);
    const body = await response.json() as { error: { code: string; requestId: string; message: string } };
    expect(response.status).toBe(500);
    expect(body.error).toMatchObject({ code: 'INTERNAL_ERROR', requestId: ID });
    expect(body.error.message).toContain(ID);
    expect(JSON.stringify(body)).not.toContain('secret dsn');
    expect(ports.entries).toHaveLength(1);
    expect(JSON.stringify(ports.entries[0]?.meta)).toContain(ID);
    expect(ports.reports.map((r) => r.context.incidentId)).toEqual([ID]);
    // One operation, labelled with the registered pattern (never the URL), ended once as a failure.
    expect(ports.operations).toHaveLength(1);
    expect(ports.operations[0]).toMatchObject({ name: 'http.route', attributes: { 'http.method': 'GET', 'http.route': '/files/:id' } });
    expect(ports.operations[0]?.ends).toEqual([{ outcome: 'failed', failed: true }]);
  });

  it('raw route operation ends before a streamed body drains', async () => {
    const ports = reporterPorts();
    let producer!: ReadableStreamDefaultController<Uint8Array>;
    const spec = defineRawRoute<object>({ method: 'get', path: '/events', handle: async () => new Response(new ReadableStream<Uint8Array>({
      start: (c) => { producer = c; c.enqueue(new TextEncoder().encode('data: 1\n\n')); },
    }), { headers: { 'content-type': 'text/event-stream' } }) });
    const response = await fetch(`${await mounted(spec, ports)}/events`);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: 1\n\n');
    // The stream is still open, yet the operation has already ended with the answer's status.
    expect(ports.operations[0]?.ends).toEqual([{ outcome: 'completed', failed: false, attributes: { 'http.status_code': 200 } }]);
    producer.close();
    expect((await reader.read()).done).toBe(true);
    expect(ports.operations[0]?.ends).toHaveLength(1);
    expect(ports.entries).toEqual([]);
  });

  it('a partial stream failure is recorded once and the response closed', async () => {
    const ports = reporterPorts();
    let producer!: ReadableStreamDefaultController<Uint8Array>;
    const spec = defineRawRoute<object>({ method: 'get', path: '/download', handle: async () => new Response(new ReadableStream<Uint8Array>({
      start: (c) => { producer = c; c.enqueue(new TextEncoder().encode('part')); },
    })) });
    const response = await fetch(`${await mounted(spec, ports)}/download`);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('part');
    producer.error(new Error('disk gone'));
    await expect(reader.read()).rejects.toThrow();
    // Recorded synchronously before the cut: once the client sees the reset, every record is in.
    expect(ports.entries).toHaveLength(1);
    expect(ports.reports.map((r) => r.context.incidentId)).toEqual([ID]);
    expect(ports.entries[0]?.message).toContain('Write response');
    // The drain is transport-owned: the operation had already ended, and is not ended again.
    expect(ports.operations[0]?.ends.map((end) => end.outcome)).toEqual(['completed']);
  });

  it('a disconnect while handle runs ends cancelled, writes nothing and reports nothing for an abort-like throw', async () => {
    const ports = reporterPorts();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const spec = defineRawRoute<object>({ method: 'get', path: '/slow', handle: async (_args, { signal }) => {
      entered();
      await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      return new Response('late');
    } });
    const client = new AbortController();
    const pending = fetch(`${await mounted(spec, ports)}/slow`, { signal: client.signal }).catch(() => undefined);
    await started;
    client.abort();
    await pending;
    await vi.waitFor(() => expect(ports.operations[0]?.ends).toHaveLength(1));
    expect(ports.operations[0]?.ends[0]?.outcome).toBe('cancelled');
    expect(ports.entries).toEqual([]);
    expect(ports.reports).toEqual([]);
  });

  it('a gate refusal and a returned 4xx end refused with no record', async () => {
    const ports = reporterPorts();
    const app = express();
    app.use(express.raw({ type: '*/*' }));
    mountRawRoute({ app, spec: defineRawRoute<object>({ method: 'post', path: '/up', handle: async () => new Response('ok') }, { maxBodyBytes: 2 }), deps: {}, adapter: { originPolicy: ANY_ORIGIN, errors: ports.errors } });
    mountRawRoute({ app, spec: defineRawRoute<object>({ method: 'get', path: '/gone', handle: async () => new Response('gone', { status: 410 }) }), deps: {}, adapter: { originPolicy: ANY_ORIGIN, errors: ports.errors } });
    const base = await listen({ app });
    expect((await fetch(`${base}/up`, { method: 'POST', body: 'too big' })).status).toBe(413);
    expect((await fetch(`${base}/gone`)).status).toBe(410);
    expect(ports.operations.map((op) => op.ends[0]?.outcome)).toEqual(['refused', 'refused']);
    expect(ports.entries).toEqual([]);
  });

  it('ports.onError answers before the reporter, and a throwing onError is its own incident while the reply carries the original id', async () => {
    const ports = reporterPorts();
    const { reporter, entries } = createRecordingReporter({ ids: ['ERR-AAAA-BBBB-CCCC-0002', ID], iso: ISO });
    const errors = { reporter, observability: ports.errors.observability };
    const app = express();
    mountRawRoute({ app, spec: defineRawRoute<object>({ method: 'get', path: '/tea', handle: async () => { throw new Error('x'); } }, { ports: { onError: ({ res }) => { res.status(418).send('teapot'); } } }), deps: {}, adapter: { originPolicy: ANY_ORIGIN, errors } });
    mountRawRoute({ app, spec: defineRawRoute<object>({ method: 'get', path: '/bad', handle: async () => { throw new Error('original'); } }, { ports: { onError: () => { throw new Error('policy'); } } }), deps: {}, adapter: { originPolicy: ANY_ORIGIN, errors } });
    const base = await listen({ app });
    const tea = await fetch(`${base}/tea`);
    expect([tea.status, await tea.text(), entries.length]).toEqual([418, 'teapot', 0]);
    const bad = await fetch(`${base}/bad`);
    const body = await bad.json() as { error: { requestId: string } };
    expect(entries).toHaveLength(2);
    expect(body.error.requestId).toBe(ID);
    expect(ports.operations.map((op) => op.ends[0]?.outcome)).toEqual(['refused', 'failed']);
  });

  it('an opted-in host policy rejection reaches Express unchanged after the operation ends', async () => {
    const ports = reporterPorts();
    const app = express();
    const writes = vi.fn();
    app.use((_req, res, next) => { const status = res.status.bind(res); res.status = (code) => { writes(code); return status(code); }; next(); });
    const policyError = { status: 422 };
    const nextError = vi.fn();
    const mountApp = { get: (path: string, handler: (req: express.Request, res: express.Response) => Promise<void>) => {
      app.get(path, (req, res, next) => { void handler(req, res).catch(next); });
    } } as unknown as express.Express;
    const spec = defineRawRoute<object>({ method: 'get', path: '/policy', handle: async () => { throw new Error('original'); } }, { ports: { onError: () => { throw policyError; } } });
    mountRawRoute({ app: mountApp, spec, deps: {}, adapter: { originPolicy: ANY_ORIGIN, errors: ports.errors } }, { preserveHostErrorRouting: true });
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      nextError(error);
      expect(ports.operations).toHaveLength(1);
      expect(ports.operations[0]?.ends).toEqual([{ outcome: 'failed', failed: true }]);
      expect([ports.entries.length, ports.reports.length, writes.mock.calls.length]).toEqual([0, 0, 0]);
      res.status(422).send('host refusal');
    });
    const response = await fetch(`${await listen({ app })}/policy`);
    expect([response.status, await response.text()]).toEqual([422, 'host refusal']);
    expect(nextError).toHaveBeenCalledTimes(1);
    expect(nextError.mock.calls[0]?.[0]).toBe(policyError);
    expect(writes.mock.calls).toEqual([[422]]);
  });

  it('an opted-in pre-header JSON or buffered raw write failure uses the existing host writer once', async () => {
    const ports = reporterPorts();
    const reportInternalError = createReporterRouteInternalError({ reporter: ports.errors.reporter });
    const failure = new Error('buffered body failed');
    const onError = vi.fn(({ res, error }: { res: express.Response; error: unknown }) => {
      expect(ports.operations[0]?.ends).toHaveLength(1);
      const incident = reportInternalError({ report: { error }, logSource: 'host-write', message: 'Host write failed.' });
      res.status(503).json({ host: incident });
    });
    const handle = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start: (controller) => { controller.error(failure); } })));
    const spec = defineRawRoute<object>({ method: 'get', path: '/buffered', handle }, { bufferedReply: true, ports: { onError } });
    const app = express();
    mountRawRoute({ app, spec, deps: {}, adapter: { originPolicy: ANY_ORIGIN, errors: ports.errors } }, { preserveHostErrorRouting: true });
    const response = await fetch(`${await listen({ app })}/buffered`);
    expect([response.status, await response.json()]).toEqual([503, { host: { code: 'INTERNAL_ERROR', message: `Host write failed. (error ${ID})`, requestId: ID } }]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0].error).toBe(failure);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(ports.operations).toHaveLength(1);
    expect(ports.operations[0]?.ends).toEqual([{ outcome: 'completed', failed: false, attributes: { 'http.status_code': 200 } }]);
    expect([ports.entries.length, ports.reports.length]).toEqual([1, 1]);
  });

  it('raw route without errors keeps the legacy sink', async () => {
    const internal = vi.fn();
    const app = express();
    mountRawRoute({ app, spec: defineRawRoute<object>({ method: 'get', path: '/boom', handle: async () => { throw new Error('secret dsn'); } }), deps: {}, adapter: { originPolicy: ANY_ORIGIN, onInternalError: internal } });
    const response = await fetch(`${await listen({ app })}/boom`);
    const body = await response.json() as { error: { code: string; requestId?: string } };
    expect([response.status, body.error.code]).toEqual([500, 'INTERNAL_ERROR']);
    expect(body.error.requestId).toEqual(expect.any(String));
    expect(body.error.requestId).not.toMatch(/^ERR-/);
    expect(internal).toHaveBeenCalledTimes(1);
  });
});
