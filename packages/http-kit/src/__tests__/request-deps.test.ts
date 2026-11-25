// `RouteMountOptions.requestDeps`: the host binds its per-request facts (the client address, the
// consent a cookie carries, whether the socket is local) into closures over THAT request, and the
// spec receives them as ordinary deps — so the spec never sees `req` and stays server-framework
// neutral. Additive: absent, the mounted deps reach the route unchanged.
import express from 'express';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { ok } from '@jini-ai/core/contracts/server';
import { defineJsonRoute, mountJsonRoute } from '../adapter.js';
import { defineRawRoute, mountRawRoute } from '../raw-route.js';
import { listen } from './route-test-host.js';

interface Deps { readonly who: () => string; readonly label: string }
const mounted: Deps = { who: () => 'nobody', label: 'mounted' };
/** The host's binding: a closure over this request's header, plus everything mounted. */
const bindRequest = ({ req, deps }: { req: Request; deps: Deps }): Deps => ({ ...deps, who: () => String(req.headers['x-who'] ?? '') });
const get = (url: string, who: string): Promise<Response> => fetch(url, { headers: { 'x-who': who } });

describe('RouteMountOptions.requestDeps (JSON mount)', () => {
  it('hands each request its own bound deps, in handle and in every port', async () => {
    const seen: string[] = [];
    const spec = defineJsonRoute<undefined, { who: string; label: string }, Deps, string>({
      method: 'get', path: '/j', parse: () => ok({ value: undefined }),
      handle: async ({ deps, authorize }) => { await authorize!({ permission: 'p' }); return ok({ value: { who: deps.who(), label: deps.label } }); },
    }, { ports: {
      workspace: ({ deps }) => { seen.push(`workspace:${deps.who()}`); },
      authenticate: ({ deps }) => deps.who(),
      authorize: ({ deps, context }) => { seen.push(`authorize:${deps.who()}:${context}`); },
    } });
    const app = express();
    mountJsonRoute({ app, spec, deps: mounted }, { requestDeps: bindRequest });
    const base = await listen({ app });
    const first = await (await get(`${base}/j`, 'ada')).json();
    const second = await (await get(`${base}/j`, 'bob')).json();
    expect([first, second, seen]).toEqual([
      { who: 'ada', label: 'mounted' }, { who: 'bob', label: 'mounted' },
      ['workspace:ada', 'authorize:ada:ada', 'workspace:bob', 'authorize:bob:bob'],
    ]);
  });

  it('is evaluated once per request, after the static headers: a throw takes the error port and keeps them', async () => {
    let calls = 0;
    const spec = defineJsonRoute<undefined, object, Deps>({ method: 'get', path: '/j', parse: () => ok({ value: undefined }), handle: () => ok({ value: {} }) }, {
      responseHeaders: { 'Cache-Control': 'no-store' },
      ports: { onError: ({ res, error }) => { res.status(503).json({ caught: (error as Error).message }); } },
    });
    const app = express();
    mountJsonRoute({ app, spec, deps: mounted }, { requestDeps: () => { calls += 1; throw new Error('no socket'); } });
    const response = await get(`${await listen({ app })}/j`, 'ada');
    expect([response.status, response.headers.get('cache-control'), await response.json(), calls]).toEqual([503, 'no-store', { caught: 'no socket' }, 1]);
  });

  it('passes the mounted deps unchanged when absent', async () => {
    const spec = defineJsonRoute<undefined, { same: boolean }, Deps>({ method: 'get', path: '/j', parse: () => ok({ value: undefined }), handle: ({ deps }) => ok({ value: { same: deps === mounted } }) });
    const app = express();
    mountJsonRoute({ app, spec, deps: mounted });
    expect(await (await get(`${await listen({ app })}/j`, 'ada')).json()).toEqual({ same: true });
  });
});

describe('RouteMountOptions.requestDeps (raw mount)', () => {
  it('hands each request its own bound deps, in handle and in the ports', async () => {
    const seen: string[] = [];
    const spec = defineRawRoute<Deps>({ method: 'get', path: '/r', handle: async ({ deps }) => new Response(`${deps.who()}/${deps.label}`) }, {
      ports: { workspace: ({ deps }) => { seen.push(deps.who()); } },
    });
    const app = express();
    mountRawRoute({ app, spec, deps: mounted }, { requestDeps: bindRequest });
    const base = await listen({ app });
    const answers = [await (await get(`${base}/r`, 'ada')).text(), await (await get(`${base}/r`, 'bob')).text()];
    expect([answers, seen]).toEqual([['ada/mounted', 'bob/mounted'], ['ada', 'bob']]);
  });

  it('passes the mounted deps unchanged when absent', async () => {
    const spec = defineRawRoute<Deps>({ method: 'get', path: '/r', handle: async ({ deps }) => new Response(String(deps === mounted)) });
    const app = express();
    mountRawRoute({ app, spec, deps: mounted });
    expect(await (await get(`${await listen({ app })}/r`, 'ada')).text()).toBe('true');
  });
});
