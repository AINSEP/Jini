/**
 * @file Middleware decorator for the `Server` contract.
 *
 * Why a decorator instead of `Server.use`: middleware wraps the routes registered THROUGH it, so
 * which routes a gate covers is decided by where they are registered, never by registration order
 * against a framework's layer stack. That keeps the `Server` contract one method wide and makes
 * an exemption explicit (`exemptPaths`) instead of an accident of mount order.
 */
import type { Server, ServerMiddleware, ServerRoute } from '../server.js';

function coversPath({ path, pathPrefix }: { readonly path: string; readonly pathPrefix: string }): boolean {
  if (pathPrefix === '/' || pathPrefix === '') return true;
  const prefix = pathPrefix.endsWith('/') ? pathPrefix.slice(0, -1) : pathPrefix;
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Returns a `Server` that runs `middleware` (in array order) in front of every route registered
 * through it whose path is under `pathPrefix`, except routes whose registered path is listed in
 * `exemptPaths` (compared against the route PATTERN, so a mount prefix can never silently turn an
 * exemption off). Routes registered directly on the inner `server` are untouched.
 * @throws From a route's handler when a middleware calls `next()` twice for one request.
 */
export function withServerMiddleware(
  { server, middleware }: { readonly server: Server; readonly middleware: readonly ServerMiddleware[] },
  { pathPrefix = '/', exemptPaths = [] }: { readonly pathPrefix?: string; readonly exemptPaths?: readonly string[] } = {},
): Server {
  return {
    route(route) {
      if (!coversPath({ path: route.path, pathPrefix }) || exemptPaths.includes(route.path)) {
        server.route(route);
        return;
      }
      server.route(withRouteMiddleware({ route, middleware }));
    },
  };
}

/**
 * Returns `route` with `middleware` (in array order) in front of its handler: the per-route form of
 * {@link withServerMiddleware}, for a route group that must carry its own gates so a host cannot mount the
 * route without them (it never sees the `Server` the group is mounted on). Method, path and `locals` sharing
 * behave as in `withServerMiddleware`; the input route is not modified.
 * @throws From the route's handler when a middleware calls `next()` twice for one request.
 */
export function withRouteMiddleware(
  { route, middleware }: { readonly route: ServerRoute; readonly middleware: readonly ServerMiddleware[] },
  _optional: Record<string, never> = {},
): ServerRoute {
  return { ...route, handler: (args) => runChain({ route, middleware, args }) };
}

/** Runs `middleware[index..]` and then the route's handler, sharing one `locals` object per request. */
function runChain({ route, middleware, args }: {
  readonly route: ServerRoute;
  readonly middleware: readonly ServerMiddleware[];
  readonly args: Parameters<ServerRoute['handler']>[0];
}): Promise<Response> {
  const { request, params, client } = args;
  const locals = args.locals ?? {};
  const peer = client ? { client } : {};
  const routeInfo = { method: route.method, path: route.path };
  const run = async (index: number): Promise<Response> => {
    const current = middleware[index];
    if (!current) return route.handler({ request, params, locals, ...peer });
    let called = false;
    const next = () => {
      if (called) throw new Error(`A middleware in front of ${route.method} ${route.path} called next() twice.`);
      called = true;
      return run(index + 1);
    };
    return current({ request, params, locals, route: routeInfo, ...peer, next });
  };
  return run(0);
}
