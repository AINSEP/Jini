import { describe, expect, it } from 'vitest';
import type { ServerHandler, ServerMiddleware, ServerRoute } from '../../server.js';
import { createRouteTable } from '../route-table.js';
import { withRouteMiddleware, withServerMiddleware } from '../middleware.js';

const text = (body: string): ServerHandler => () => new Response(body);

describe('withServerMiddleware', () => {
  function capture() {
    const routes: ServerRoute[] = [];
    return { routes, server: { route: (route: ServerRoute) => { routes.push(route); } } };
  }

  it('runs middleware in order, passes locals and the route pattern, and lets the handler read them', async () => {
    const { routes, server } = capture();
    const seen: string[] = [];
    const first: ServerMiddleware = async ({ locals, route, next }) => { seen.push(`first ${route.method} ${route.path}`); locals.who = 'p1'; return next(); };
    const second: ServerMiddleware = async ({ next }) => { seen.push('second'); const res = await next(); return new Response(await res.text(), { status: 201 }); };
    withServerMiddleware({ server, middleware: [first, second] }).route({ method: 'GET', path: '/a/:id', handler: ({ locals, params }) => new Response(`${String(locals?.who)} ${params.id ?? ''}`) });
    const res = await routes[0]!.handler({ request: new Request('http://l/a/7'), params: { id: '7' } });
    expect(seen).toEqual(['first GET /a/:id', 'second']);
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('p1 7');
  });

  it('a middleware that returns without next() stops the request before the handler', async () => {
    const { routes, server } = capture();
    let handled = false;
    withServerMiddleware({ server, middleware: [() => new Response('no', { status: 401 })] })
      .route({ method: 'POST', path: '/a', handler: () => { handled = true; return new Response('yes'); } });
    const res = await routes[0]!.handler({ request: new Request('http://l/a', { method: 'POST' }), params: {} });
    expect(res.status).toBe(401);
    expect(handled).toBe(false);
  });

  it('leaves routes outside pathPrefix and exempt patterns unwrapped', async () => {
    const { routes, server } = capture();
    const deny: ServerMiddleware = () => new Response('denied', { status: 401 });
    const gated = withServerMiddleware({ server, middleware: [deny] }, { pathPrefix: '/api/', exemptPaths: ['/api/health'] });
    gated.route({ method: 'GET', path: '/api/health', handler: text('open') });
    gated.route({ method: 'GET', path: '/apix', handler: text('outside') });
    gated.route({ method: 'GET', path: '/api', handler: text('root') });
    const statuses = await Promise.all(routes.map(async (r) => (await r.handler({ request: new Request('http://l/'), params: {} })).status));
    expect(statuses).toEqual([200, 200, 401]);
  });

  it('refuses a second next() from the same middleware', async () => {
    const { routes, server } = capture();
    withServerMiddleware({ server, middleware: [async ({ next }) => { await next(); return next(); }] }).route({ method: 'GET', path: '/a', handler: text('x') });
    await expect(routes[0]!.handler({ request: new Request('http://l/a'), params: {} })).rejects.toThrow('A middleware in front of GET /a called next() twice.');
  });
});

describe('withRouteMiddleware', () => {
  const call = (route: ServerRoute, path = '/a') => route.handler({ request: new Request(`http://l${path}`), params: {} });

  it('returns the same route with its gates in front: method and path are kept, the handler runs only through the chain', async () => {
    const order: string[] = [];
    const route: ServerRoute = { method: 'POST', path: '/a/:id', handler: ({ locals }) => { order.push('handler'); return new Response(String(locals?.who)); } };
    const gated = withRouteMiddleware({ route, middleware: [async ({ locals, next }) => { order.push('gate'); locals.who = 'p1'; return next(); }] });
    expect([gated.method, gated.path]).toEqual(['POST', '/a/:id']);
    expect(await (await call(gated)).text()).toBe('p1');
    expect(order).toEqual(['gate', 'handler']);
  });
  it('a gate that refuses stops the request before the handler, and the original route stays ungated', async () => {
    let handled = 0;
    const route: ServerRoute = { method: 'GET', path: '/a', handler: () => { handled += 1; return new Response('ok'); } };
    const gated = withRouteMiddleware({ route, middleware: [() => new Response('no', { status: 401 })] });
    expect((await call(gated)).status).toBe(401);
    expect(handled).toBe(0);
    expect((await call(route)).status).toBe(200);
  });
  it('runs several gates in array order, sharing one locals object, and refuses a second next()', async () => {
    const seen: string[] = [];
    const route: ServerRoute = { method: 'GET', path: '/a', handler: ({ locals }) => new Response(JSON.stringify(locals)) };
    const gated = withRouteMiddleware({ route, middleware: [
      async ({ locals, next }) => { seen.push('one'); locals.one = 1; return next(); },
      async ({ locals, next }) => { seen.push('two'); locals.two = 2; return next(); },
    ] });
    expect(await (await call(gated)).json()).toEqual({ one: 1, two: 2 });
    expect(seen).toEqual(['one', 'two']);
    const twice = withRouteMiddleware({ route, middleware: [async ({ next }) => { await next(); return next(); }] });
    await expect(call(twice)).rejects.toThrow('A middleware in front of GET /a called next() twice.');
  });
  it('passes the caller address to every gate and on to the handler', async () => {
    let gateSaw: string | undefined;
    const route: ServerRoute = { method: 'GET', path: '/a', handler: ({ client }) => new Response(client?.address ?? 'none') };
    const gated = withRouteMiddleware({ route, middleware: [({ client, next }) => { gateSaw = client?.address; return next(); }] });
    const res = await gated.handler({ request: new Request('http://l/a'), params: {}, client: { address: '10.1.2.3' } });
    expect([gateSaw, await res.text()]).toEqual(['10.1.2.3', '10.1.2.3']);
  });
});

it('treats an empty prefix as global and a trailing slash as part of the mount spelling, not the route', async () => {
  const gate: ServerMiddleware = () => new Response('maintenance', { status: 503 });
  for (const pathPrefix of ['', '/api/']) {
    const table = createRouteTable();
    const server = withServerMiddleware({ server: table, middleware: [gate] }, { pathPrefix });
    server.route({ method: 'GET', path: '/api', handler: () => new Response('unwrapped') });
    const request = new Request('http://local/api');
    const match = table.match({ method: request.method, pathname: '/api' });
    if (match.kind !== 'route') throw new Error('GET /api was not registered');
    const response = await match.route.handler({ request, params: match.params });
    expect([response.status, await response.text()]).toEqual([503, 'maintenance']);
  }
});
