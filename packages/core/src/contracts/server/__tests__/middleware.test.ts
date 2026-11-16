import { describe, expect, it } from 'vitest';
import type { ServerHandler, ServerMiddleware, ServerRoute } from '../../server.js';
import { createRouteTable } from '../route-table.js';
import { withServerMiddleware } from '../middleware.js';

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

