import { describe, expect, it } from 'vitest';
import { matchServerPath, type Server, type ServerHandler, type ServerMethod } from '../index.js';

/** In-memory `Server`: what a test (or any adapter) does with the contract, minus the socket. */
function createFakeServer() {
  const routes: { method: ServerMethod; path: string; handler: ServerHandler }[] = [];
  const app: Server = {
    route({ method, path, handler }) {
      if (routes.some((route) => route.method === method && route.path === path)) {
        throw new Error(`duplicate route ${method} ${path}`);
      }
      routes.push({ method, path, handler });
    },
  };
  async function dispatch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    let pathMatched = false;
    for (const route of routes) {
      const params = matchServerPath({ pattern: route.path, pathname });
      if (params === null) continue;
      pathMatched = true;
      if (route.method === request.method) return route.handler({ request, params });
    }
    return new Response(null, { status: pathMatched ? 405 : 404 });
  }
  return { app, dispatch };
}

/** Route code in the shape packages will use: it takes `{ app }`, never a concrete server. */
function registerNoteRoutes({ app }: { readonly app: Server }): void {
  app.route({
    method: 'GET',
    path: '/notes/:id',
    handler: ({ request, params }) =>
      Response.json({ id: params.id, view: new URL(request.url).searchParams.get('view') }),
  });
  app.route({
    method: 'POST',
    path: '/notes',
    handler: async ({ request }) => Response.json({ created: await request.json() }, { status: 201 }),
  });
}

describe('Server contract', () => {
  it('dispatches a Request to the matching handler with decoded path params', async () => {
    const { app, dispatch } = createFakeServer();
    registerNoteRoutes({ app });

    const response = await dispatch(new Request('http://local/notes/a%20b?view=full'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'a b', view: 'full' });
  });

  it('lets an async handler read the request body', async () => {
    const { app, dispatch } = createFakeServer();
    registerNoteRoutes({ app });

    const response = await dispatch(
      new Request('http://local/notes', { method: 'POST', body: JSON.stringify({ title: 'hi' }) }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ created: { title: 'hi' } });
  });

  it('leaves unmatched paths and methods to the adapter', async () => {
    const { app, dispatch } = createFakeServer();
    registerNoteRoutes({ app });

    expect((await dispatch(new Request('http://local/missing'))).status).toBe(404);
    expect((await dispatch(new Request('http://local/notes/1', { method: 'DELETE' }))).status).toBe(405);
  });
});

describe('matchServerPath', () => {
  it('returns params for :name segments and an empty object for a literal match', () => {
    expect(matchServerPath({ pattern: '/a/:x/b/:y', pathname: '/a/1/b/two' })).toEqual({ x: '1', y: 'two' });
    expect(matchServerPath({ pattern: '/health', pathname: '/health' })).toEqual({});
  });

  it('rejects differing literals, segment counts, trailing slashes and empty params', () => {
    expect(matchServerPath({ pattern: '/notes/:id', pathname: '/posts/1' })).toBeNull();
    expect(matchServerPath({ pattern: '/notes/:id', pathname: '/notes/1/extra' })).toBeNull();
    expect(matchServerPath({ pattern: '/notes', pathname: '/notes/' })).toBeNull();
    expect(matchServerPath({ pattern: '/notes/:id', pathname: '/notes/' })).toBeNull();
  });

  it('does not match a param whose percent-encoding is malformed', () => {
    expect(matchServerPath({ pattern: '/notes/:id', pathname: '/notes/%E0%A4%A' })).toBeNull();
  });
});
