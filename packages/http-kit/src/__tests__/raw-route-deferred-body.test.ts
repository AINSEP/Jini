// Batch L (w4-routes): a raw spec reads its body only when its handler asks (`raw.readBody`), after its
// own gates, so an unauthorized upload is refused without its body ever being read — the order the
// hand-written `express.raw`-after-authorize routes kept. Mutation `raw-body-read-before-authorize`
// (the adapter reading the body ahead of `authenticate`) turns the "never read" cases RED.
import { gzipSync } from 'node:zlib';
import express from 'express';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import type { RouteBodyRead, RouteBodyReadOptions } from '@jini-ai/core/contracts/server';
import { defineRawRoute, mountRawRoute } from '../raw-route.js';
import type { JsonRoutePorts } from '../types.js';
import { listen } from './route-test-host.js';

type Session = { allowed: boolean };
const LIMIT = 16;

/** An app whose `authenticate` admits only `x-session: yes`, recording whether the request stream was consumed by then. */
function uploadApp(readOutcome: (read: RouteBodyRead<unknown>) => Response, read: 'raw' | 'urlencoded' = 'raw') {
  const seen: { consumedAtAuth?: boolean; reads: number } = { reads: 0 };
  const ports: JsonRoutePorts<object, Session> = {
    authenticate: ({ raw }) => {
      if (raw.headers?.['x-session'] !== 'yes') throw Object.assign(new Error('no session'), { status: 401 });
      return { allowed: raw.headers?.['x-allow'] === 'yes' };
    },
    onError: ({ res, error }) => { res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message }); },
  };
  const spec = defineRawRoute<object, Session>({
    method: 'post', path: '/upload',
    handle: async ({ raw, context }) => {
      if (!context?.allowed) return Response.json({ error: 'forbidden' }, { status: 403 });
      seen.reads += 1;
      const outcome = read === 'raw'
        ? await raw.readBody({ type: 'raw', mediaType: 'application/zip', limit: LIMIT })
        : await raw.readBody({ type: 'urlencoded', limit: LIMIT });
      return readOutcome(outcome);
    },
  }, { ports, readHeaders: ['x-session', 'x-allow'] });
  const app = express();
  // Records, at the moment the gates run, whether anything has started reading the request stream.
  app.use((req: Request, _res, next) => {
    const probe = req as Request & { _consuming?: boolean };
    req.on('authProbe', () => { seen.consumedAtAuth = Boolean(probe._consuming) || probe.readableFlowing === true; });
    next();
  });
  const wrapped = { ...ports, authenticate: (args: Parameters<NonNullable<typeof ports.authenticate>>[0]) => {
    (args.res.req as Request).emit('authProbe');
    return ports.authenticate!(args);
  } };
  mountRawRoute({ app, spec: { ...spec, ports: wrapped }, deps: {} });
  return { app, seen };
}

const echo = (read: RouteBodyRead<unknown>) => read.ok
  ? Response.json({ bytes: read.value instanceof Uint8Array ? read.value.byteLength : null, form: read.value instanceof Uint8Array ? null : read.value })
  : Response.json({ refusal: read.refusal }, { status: 422 });

const post = (url: string, body: Uint8Array | string, headers: Record<string, string>) => fetch(`${url}/upload`, { method: 'POST', headers, body });

describe('mountRawRoute: deferred body (raw.readBody)', () => {
  it('an unauthenticated oversized upload is refused by the gate; the body is never read', async () => {
    const { app, seen } = uploadApp(echo);
    const response = await post(await listen({ app }), new Uint8Array(LIMIT * 4), { 'content-type': 'application/zip' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'no session' });
    expect(seen).toEqual({ consumedAtAuth: false, reads: 0 });
  });

  it('a denied upload with a body that cannot be read is refused by the handler gate, before any read', async () => {
    const { app, seen } = uploadApp(echo);
    const response = await post(await listen({ app }), new Uint8Array(gzipSync(Buffer.from('zip'))), { 'content-type': 'application/zip', 'content-encoding': 'gzip', 'x-session': 'yes' });
    expect(response.status).toBe(403);
    expect(seen).toEqual({ consumedAtAuth: false, reads: 0 });
  });

  it('an authorized upload reads the bytes after the gates', async () => {
    const { app, seen } = uploadApp(echo);
    const response = await post(await listen({ app }), new Uint8Array([1, 2, 3]), { 'content-type': 'application/zip', 'x-session': 'yes', 'x-allow': 'yes' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bytes: 3, form: null });
    expect(seen).toEqual({ consumedAtAuth: false, reads: 1 });
  });

  it('refuses over the limit with the parser\'s too-large outcome (the legacy 413), carrying the limit', async () => {
    const { app } = uploadApp(echo);
    const response = await post(await listen({ app }), new Uint8Array(LIMIT + 1), { 'content-type': 'application/zip', 'x-session': 'yes', 'x-allow': 'yes' });
    expect(await response.json()).toEqual({ refusal: { reason: 'too-large', limit: LIMIT } });
  });

  it('classifies a compressed body, a foreign media type and a missing body without reading them as bytes', async () => {
    const { app } = uploadApp(echo);
    const url = await listen({ app });
    const session = { 'x-session': 'yes', 'x-allow': 'yes' };
    const gz = await post(url, new Uint8Array(gzipSync(Buffer.from('zip'))), { ...session, 'content-type': 'application/zip', 'content-encoding': 'gzip' });
    expect(await gz.json()).toEqual({ refusal: { reason: 'unsupported-encoding' } });
    const json = await post(url, '{}', { ...session, 'content-type': 'application/json' });
    expect(await json.json()).toEqual({ refusal: { reason: 'media-type' } });
    const none = await fetch(`${url}/upload`, { method: 'POST', headers: session });
    expect(await none.json()).toEqual({ refusal: { reason: 'media-type' } });
  });

  it('a second read answers what the first read', async () => {
    const reads: unknown[] = [];
    const spec = defineRawRoute<object>({ method: 'post', path: '/twice', handle: async ({ raw }) => {
      reads.push(await raw.readBody({ type: 'raw', mediaType: 'application/zip', limit: LIMIT }));
      reads.push(await raw.readBody({ type: 'raw', mediaType: 'application/zip', limit: LIMIT }));
      return new Response(null, { status: 204 });
    } });
    const app = express();
    mountRawRoute({ app, spec, deps: {} });
    await fetch(`${await listen({ app })}/twice`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: new Uint8Array([9]) });
    expect(reads).toHaveLength(2);
    expect(reads[1]).toBe(reads[0]);
  });

  /** Posts one zip body to a route whose handler issues `first` then `second`, concurrently or one after the other. */
  async function twoReads({ first, second, concurrent }: { first: RouteBodyReadOptions; second: RouteBodyReadOptions; concurrent: boolean }) {
    const reads: RouteBodyRead<unknown>[] = [];
    const spec = defineRawRoute<object>({ method: 'post', path: '/two', handle: async ({ raw }) => {
      const issue = (options: RouteBodyReadOptions) => (raw.readBody as (o: RouteBodyReadOptions) => Promise<RouteBodyRead<unknown>>)(options);
      if (concurrent) reads.push(...await Promise.all([issue(first), issue(second)]));
      else { reads.push(await issue(first)); reads.push(await issue(second)); }
      return new Response(null, { status: 204 });
    } });
    const app = express();
    mountRawRoute({ app, spec, deps: {} });
    await fetch(`${await listen({ app })}/two`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: new Uint8Array([9]) });
    return reads;
  }
  const ZIP = { type: 'raw', mediaType: 'application/zip', limit: LIMIT } as const;

  // Mutation `deferred-body-reuses-incompatible-read` (the first read's promise returned for ANY options)
  // turns the incompatible cases RED: a later urlencoded read would answer bytes, a tighter limit the
  // first read's bytes.
  it.each([true, false])('identical options reuse the first read, the stream read once (concurrent: %s)', async (concurrent) => {
    const [first, second] = await twoReads({ first: ZIP, second: { ...ZIP }, concurrent });
    expect(first).toEqual({ ok: true, value: Buffer.from([9]) });
    expect(second).toBe(first);
  });

  it.each([true, false])('an incompatible later read is refused as incompatible-read, the first read untouched (concurrent: %s)', async (concurrent) => {
    const incompatible: RouteBodyReadOptions[] = [
      { type: 'urlencoded', limit: LIMIT },
      { ...ZIP, mediaType: 'application/octet-stream' },
      { ...ZIP, limit: LIMIT * 2 },
      { ...ZIP, limit: 1 },
    ];
    for (const second of incompatible) {
      const [first, later] = await twoReads({ first: ZIP, second, concurrent });
      expect(first).toEqual({ ok: true, value: Buffer.from([9]) });
      expect(later).toEqual({ ok: false, refusal: { reason: 'incompatible-read' } });
    }
  });

  it('a first urlencoded read refuses a later raw read of the same request', async () => {
    const spec = defineRawRoute<object>({ method: 'post', path: '/form', handle: async ({ raw }) => {
      const form = await raw.readBody({ type: 'urlencoded', limit: LIMIT });
      const bytes = await raw.readBody({ type: 'raw', mediaType: 'application/x-www-form-urlencoded', limit: LIMIT });
      return Response.json({ form, bytes });
    } });
    const app = express();
    mountRawRoute({ app, spec, deps: {} });
    const response = await fetch(`${await listen({ app })}/form`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
    expect(await response.json()).toEqual({ form: { ok: true, value: { a: '1' } }, bytes: { ok: false, refusal: { reason: 'incompatible-read' } } });
  });

  it('reads a flat urlencoded form, refusing a malformed or oversized one', async () => {
    const { app } = uploadApp(echo, 'urlencoded');
    const url = await listen({ app });
    const headers = { 'content-type': 'application/x-www-form-urlencoded', 'x-session': 'yes', 'x-allow': 'yes' };
    expect(await (await post(url, 'a=1&b=two', headers)).json()).toEqual({ bytes: null, form: { a: '1', b: 'two' } });
    expect(await (await post(url, `a=${'x'.repeat(LIMIT)}`, headers)).json()).toEqual({ refusal: { reason: 'too-large', limit: LIMIT } });
  });

  it('leaves a body a host parser registered ahead of the mount already read', async () => {
    const spec = defineRawRoute<object>({ method: 'post', path: '/early', handle: async ({ raw }) => echo(await raw.readBody({ type: 'raw', mediaType: 'application/zip', limit: LIMIT })) });
    const app = express();
    app.use(express.raw({ type: 'application/zip' }));
    mountRawRoute({ app, spec, deps: {} });
    const response = await fetch(`${await listen({ app })}/early`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: new Uint8Array(LIMIT * 2) });
    expect(await response.json()).toEqual({ bytes: LIMIT * 2, form: null });
  });
});
