// Mount opt-ins that let a host keep a hand-written route's wire when it moves to a spec:
// `ports.payloadTooLarge` (the host's own body-cap 413) and `bodyParsers` (a parser scoped to ONE
// registration, between the path and the handler). Both are additive: absent, nothing changes.
import express from 'express';
import type { Express, RequestHandler } from 'express';
import { describe, expect, it } from 'vitest';
import { ok } from '@jini-ai/core/contracts/server';
import { defineJsonRoute, mountJsonRoute } from '../adapter.js';
import { defineRawRoute, mountRawRoute } from '../raw-route.js';
import type { JsonRoutePorts } from '../types.js';
import { listen } from './route-test-host.js';

/** The host's own 413 writer: a body shape no core envelope produces. */
const hostPorts: JsonRoutePorts<object> = {
  payloadTooLarge: ({ res, maxBytes }) => { res.status(413).json({ error: 'Content too large to save.', code: 'PAYLOAD_TOO_LARGE', maxBytes }); },
};
const bigJson = JSON.stringify({ p: 'a'.repeat(100) });
const post = (url: string, body: string, type = 'application/json'): Promise<Response> => fetch(url, { method: 'POST', headers: { 'content-type': type }, body });

describe('JsonRoutePorts.payloadTooLarge', () => {
  it('writes the host 413 for a JSON mount, before the workspace port and the handler', async () => {
    const seen: string[] = [];
    const spec = defineJsonRoute<unknown, object, object>({
      method: 'post', path: '/j', parse: ({ body }) => ok({ value: body }), handle: () => { seen.push('handle'); return ok({ value: {} }); },
    }, { maxBodyBytes: 32, ports: { ...hostPorts, workspace: () => { seen.push('workspace'); } } });
    const app = express();
    app.use(express.json());
    mountJsonRoute({ app, spec, deps: {} });
    const response = await post(`${await listen({ app })}/j`, bigJson);
    expect([response.status, await response.json(), seen]).toEqual([413, { error: 'Content too large to save.', code: 'PAYLOAD_TOO_LARGE', maxBytes: 32 }, []]);
  });

  it('writes the host 413 for a raw mount too', async () => {
    const spec = defineRawRoute<object>({ method: 'post', path: '/r', handle: async () => new Response('x') }, { maxBodyBytes: 32, ports: hostPorts });
    const app = express();
    app.use(express.json());
    mountRawRoute({ app, spec, deps: {} });
    const response = await post(`${await listen({ app })}/r`, bigJson);
    expect([response.status, (await response.json() as { code: string }).code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
  });

  it('keeps the core envelope when the port is absent, and admits a body at the cap', async () => {
    const spec = defineJsonRoute<unknown, object, object>({ method: 'post', path: '/j', parse: ({ body }) => ok({ value: body }), handle: () => ok({ value: { fine: true } }) }, { maxBodyBytes: 32 });
    const app = express();
    app.use(express.json());
    mountJsonRoute({ app, spec, deps: {} });
    const base = await listen({ app });
    const refused = await post(`${base}/j`, bigJson);
    expect([refused.status, (await refused.json() as { error: { code: string } }).error.code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
    expect((await post(`${base}/j`, JSON.stringify({ p: 1 }))).status).toBe(200);
  });
});

/** An express app that records what each verb registration was given, then registers for real. */
function recording(app: Express, log: string[][]): Express {
  const register = (verb: 'get' | 'post') => (path: string, ...handlers: RequestHandler[]) => {
    log.push([path, ...handlers.map((h) => h.name || '<anonymous>')]);
    return app[verb](path, ...handlers);
  };
  return { get: register('get'), post: register('post') } as unknown as Express;
}

describe('bodyParsers', () => {
  it('registers the parsers between the path and the JSON handler, scoped to that one route', async () => {
    const log: string[][] = [];
    const spec = defineJsonRoute<unknown, { body: unknown }, object>({ method: 'post', path: '/form', parse: ({ body }) => ok({ value: body }), handle: ({ input }) => ok({ value: { body: input } }) });
    const other = defineJsonRoute<unknown, { body: unknown }, object>({ method: 'post', path: '/plain', parse: ({ body }) => ok({ value: body }), handle: ({ input }) => ok({ value: { body: input } }) });
    const app = express();
    mountJsonRoute({ app: recording(app, log), spec, deps: {} }, { bodyParsers: [express.urlencoded({ extended: false })] });
    mountJsonRoute({ app: recording(app, log), spec: other, deps: {} });
    expect(log.map((row) => row.length)).toEqual([3, 2]);
    expect(log[0]?.[1]).toBe('urlencodedParser');
    const base = await listen({ app });
    const form = await post(`${base}/form`, 'a=1&b=2', 'application/x-www-form-urlencoded');
    expect(await form.json()).toEqual({ body: { a: '1', b: '2' } });
    const unparsed = await post(`${base}/plain`, 'a=1&b=2', 'application/x-www-form-urlencoded');
    expect(await unparsed.json()).toEqual({});
  });

  it('does the same for a raw mount', async () => {
    const log: string[][] = [];
    const spec = defineRawRoute<object>({ method: 'post', path: '/rform', handle: async ({ raw }) => new Response(JSON.stringify(raw.body)) });
    const app = express();
    mountRawRoute({ app: recording(app, log), spec, deps: {} }, { bodyParsers: [express.urlencoded({ extended: false })] });
    expect(log[0]?.length).toBe(3);
    const response = await post(`${await listen({ app })}/rform`, 'a=1', 'application/x-www-form-urlencoded');
    expect(await response.json()).toEqual({ a: '1' });
  });
});
