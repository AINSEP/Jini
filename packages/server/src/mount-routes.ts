/**
 * @file How this preset puts a list of routes on its Express app. A route group in the daemon
 * returns its routes as data and never sees the app; this is the one place they meet. Each call
 * adds one layer at the position of the call, so everything the preset mounted above it (health,
 * the token gate, the body parser, the origin guard) has already run when a route is reached, and
 * a request the list does not own falls through to whatever is mounted below.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import type { ServerRoute } from '@jini-ai/core/contracts/server';
import type { ErrorReporter } from '@jini-ai/core/errors/reporter';
import { recordRouteRegistrations } from '@jini-ai/http-kit';
import { createNodeDispatcher } from '@jini-ai/http-kit/node-bridge';

type NodeLayer = (req: IncomingMessage & { body?: unknown }, res: ServerResponse & { locals?: Record<string, unknown> }, next: (error?: unknown) => void) => void;

/** The only thing asked of the app: that a request handler can be added to it. */
interface LayerTarget {
  use(layer: NodeLayer): unknown;
}

function layerTarget(app: unknown): LayerTarget {
  if ((typeof app === 'object' || typeof app === 'function') && app !== null && typeof (app as { use?: unknown }).use === 'function') return app as LayerTarget;
  throw new TypeError('mountRoutes needs an app with a use(handler) method (the preset\'s Express app); it was given something else.');
}

/**
 * Mounts `routes` on `app` as one layer, at this position in the app's order.
 * @param optional.reporter - The host's error reporter (`context.errors.reporter` of the route host). With it, a failure the dispatcher answers itself (after headers went out) carries the reporter's ERR ID and one record instead of a local reference; before headers Express's own error handling still decides.
 * @param optional.rawBody - The routes read the request body as a stream of bytes (an upload). The body a parser above may have produced is then not handed on: a route sees the untouched stream, or no body at all when something above already consumed it.
 * @throws {TypeError} When `app` cannot take a request handler.
 * @complexity O(routes) once; per request one route-table lookup.
 */
export function mountRoutes(
  { app, routes }: { readonly app: unknown; readonly routes: readonly ServerRoute[] },
  { rawBody = false, reporter }: { readonly rawBody?: boolean; readonly reporter?: Pick<ErrorReporter, 'record'> } = {},
): void {
  const target = layerTarget(app);
  recordRouteRegistrations({ app: app as Express, registrations: routes.map(({ method, path }) => ({ method, path })) });
  // Express answered these routes before they were lists; callers kept their spellings, so the answers stay.
  const dispatcher = createNodeDispatcher({}, { expressCompatible: true, ...(reporter ? { reporter } : {}) });
  for (const route of routes) dispatcher.server.route(route);
  target.use((req, res, next) => {
    const locals = res.locals === undefined ? {} : { locals: res.locals };
    // A failure inside a route is answered by the dispatcher itself; this promise settles either way.
    void dispatcher.handle({ incoming: req, out: res }, { next, ...locals, ...(rawBody ? {} : { parsedBody: req.body }) });
  });
}
