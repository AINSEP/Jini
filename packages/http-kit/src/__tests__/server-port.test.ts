import { describe, expect, it } from 'vitest';
import type { ServerHandler, ServerMiddleware, ServerRoute } from '@jini-ai/core/contracts/server';
import { createRouteTable, jsonResponse, readBodyBytes, readJsonBody, readQuery, withServerMiddleware } from '../server-port.js';

const text = (body: string): ServerHandler => () => new Response(body);

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://local/x', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
}

describe('createRouteTable', () => {
  it('matches literal over :param regardless of registration order, and decodes params', () => {
    const table = createRouteTable();
    table.route({ method: 'GET', path: '/runs/:id', handler: text('param') });
    table.route({ method: 'GET', path: '/runs/active', handler: text('literal') });
    const literal = table.match({ method: 'GET', pathname: '/runs/active' });
    expect(literal.kind === 'route' && literal.route.path).toBe('/runs/active');
    const param = table.match({ method: 'GET', pathname: '/runs/a%20b' });
    expect(param.kind === 'route' && param.params).toEqual({ id: 'a b' });
  });

  it('answers HEAD from GET, reports 405 with Allow, and not-found otherwise', () => {
    const table = createRouteTable();
    table.route({ method: 'GET', path: '/x', handler: text('get') });
    expect(table.match({ method: 'HEAD', pathname: '/x' }).kind).toBe('route');
    expect(table.match({ method: 'POST', pathname: '/x' })).toEqual({ kind: 'method-not-allowed', allow: ['GET', 'HEAD'] });
    expect(table.match({ method: 'GET', pathname: '/x/' })).toEqual({ kind: 'not-found' });
    expect(table.match({ method: 'GET', pathname: '/x%ZZ' })).toEqual({ kind: 'not-found' });
  });

  it('refuses the same method + path shape twice, in plain words', () => {
    const table = createRouteTable();
    table.route({ method: 'GET', path: '/x/:id', handler: text('a') });
    expect(() => table.route({ method: 'GET', path: '/x/:slug', handler: text('b') })).toThrow('The route GET /x/:slug is registered twice. Remove one of the two registrations.');
    expect(() => table.route({ method: 'POST', path: '/x/:slug', handler: text('b') })).not.toThrow();
  });
});

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

describe('jsonResponse', () => {
  it('uses Express res.json content type and extra headers', async () => {
    const res = jsonResponse({ status: 404, body: { a: 1 } }, { headers: { 'x-y': 'z' } });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('x-y')).toBe('z');
    expect(await res.json()).toEqual({ a: 1 });
  });
});

describe('readJsonBody / readBodyBytes', () => {
  it('parses an object, and gives {} for no body, empty body and non-JSON content types (express.json parity)', async () => {
    expect(await readJsonBody({ request: jsonRequest('{"via":"x"}') })).toEqual({ ok: true, value: { via: 'x' } });
    expect(await readJsonBody({ request: jsonRequest('  ') })).toEqual({ ok: true, value: {} });
    expect(await readJsonBody({ request: new Request('http://l/', { method: 'POST', body: 'a=1', headers: { 'content-type': 'text/plain' } }) })).toEqual({ ok: true, value: {} });
    expect(await readJsonBody({ request: new Request('http://l/') })).toEqual({ ok: true, value: {} });
    expect(await readJsonBody({ request: jsonRequest('[1]', { 'content-type': 'application/vnd.x+json' }) })).toEqual({ ok: true, value: [1] });
  });

  it('refuses invalid JSON and bare primitives with a 400 in plain words', async () => {
    for (const body of ['{bad', '"str"', '42']) {
      const result = await readJsonBody({ request: jsonRequest(body) });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatchObject({ code: 'BAD_REQUEST', message: 'The request body is not valid JSON. Send a JSON object or array.' });
    }
  });

  it('refuses a body over maxBytes by declared length and by streamed length', async () => {
    const declared = await readJsonBody({ request: jsonRequest('{"a":1}', { 'content-length': '999' }) }, { maxBytes: 10 });
    expect(!declared.ok && declared.error.code).toBe('PAYLOAD_TOO_LARGE');
    const streamed = await readBodyBytes({ request: new Request('http://l/', { method: 'POST', body: 'x'.repeat(11) }) }, { maxBytes: 10 });
    expect(!streamed.ok && streamed.error.message).toBe('The request body is larger than the 10 bytes this address accepts. Send less data.');
    const exact = await readBodyBytes({ request: new Request('http://l/', { method: 'POST', body: 'x'.repeat(10) }) }, { maxBytes: 10 });
    expect(exact.ok && exact.value.byteLength).toBe(10);
  });
});

describe('readQuery (the Express 4 query shapes routes already validate)', () => {
  const query = (search: string) => readQuery({ request: new Request(`http://l/x${search}`) });

  it('gives one value as a string and a repeated key as an array, in order', () => {
    expect(query('?a=1&b=2&b=3')).toEqual({ a: '1', b: ['2', '3'] });
    expect(query('')).toEqual({});
  });

  it('collects `name[]` keys into an array, as Express did', () => {
    expect(query('?capability[]=x&capability[]=y')).toEqual({ capability: ['x', 'y'] });
  });

  // Express 4's extended parser (qs) merges a plain key with its `[]` and `[i]` spellings into one
  // list; a route that accepts a repeated value (frontend-sessions' `capability`) must see every one.
  it('merges mixed plain, `[]` and indexed spellings of one key into one list, as Express did', () => {
    expect(query('?capability=a&capability[]=b')).toEqual({ capability: ['a', 'b'] });
    expect(query('?capability[]=a&capability=b')).toEqual({ capability: ['a', 'b'] });
    expect(query('?capability[0]=a')).toEqual({ capability: ['a'] });
    expect(query('?capability[1]=b&capability[0]=a')).toEqual({ capability: ['a', 'b'] });
    expect(query('?capability[0]=a&capability[0]=b')).toEqual({ capability: ['a', 'b'] });
    expect(query('?capability=a&capability[0]=b')).toEqual({ capability: ['a', 'b'] });
  });

  it('treats an index above 20 or a named key mixed into a list as a non-list, non-string value', () => {
    for (const search of ['?capability[21]=a', '?capability=a&capability[x]=1', '?capability[x]=1&capability[]=a']) {
      const value = query(search).capability;
      expect(value, search).toBeDefined();
      expect(typeof value, search).not.toBe('string');
      expect(Array.isArray(value), search).toBe(false);
    }
  });

  it('gives a bracketed key a non-string value, so a route that requires a string still refuses it', () => {
    const value = query('?contextRef[a]=1').contextRef;
    expect(value).toBeDefined();
    expect(typeof value).not.toBe('string');
    expect(Array.isArray(value)).toBe(false);
  });

  it('never touches the prototype', () => {
    const result = query('?__proto__=x&constructor=y');
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result).toEqual(Object.fromEntries([['__proto__', 'x'], ['constructor', 'y']]));
  });
});
