/**
 * @file A daemon route together with the names of the gates in front of it. A route is a method,
 * a path and a handler; once a gate is wrapped around the handler it can no longer be seen from
 * outside. Building every gated route through {@link gated} keeps the gate names beside the route,
 * so a test can read "which gates, in which order" from the route list without sending a request.
 */
import { jsonRoute, withRouteMiddleware, type JsonRouteSpec, type ServerMiddleware, type ServerRoute } from '@jini-ai/core/contracts/server';
import type { DaemonRouteHost } from './route-host.js';

/** The gates a daemon route can sit behind. */
export type DaemonGateName = 'same-origin' | 'tool-exec-caller' | 'remote-bridge-token' | 'frontend-session-owner';

/** A daemon route plus the names of its gates, in run order. Usable wherever a `ServerRoute` is. */
export interface DaemonRoute extends ServerRoute {
  readonly gates: readonly DaemonGateName[];
}

/**
 * One gate of a route. `middleware` is left out for a gate the route's own handler runs
 * (`same-origin` on a JSON route is checked by the JSON route itself): the name is still recorded.
 */
export interface DaemonGate {
  readonly name: DaemonGateName;
  readonly middleware?: ServerMiddleware;
}

/** `route` behind `gates`, first gate outermost. A gate that refuses answers itself and the handler is not called. */
export function gated({ route, gates }: { readonly route: ServerRoute; readonly gates: readonly DaemonGate[] }, _optional: Record<string, never> = {}): DaemonRoute {
  const middleware = gates.flatMap((gate) => (gate.middleware ? [gate.middleware] : []));
  const guarded = middleware.length > 0 ? withRouteMiddleware({ route, middleware }) : route;
  return { ...guarded, gates: gates.map((gate) => gate.name) };
}

function gateNames(route: ServerRoute): readonly string[] {
  const { gates } = route as Partial<DaemonRoute>;
  return Array.isArray(gates) ? [...gates] : [];
}

/** Method, path and gate names of each route, in list order. A route built without {@link gated} has no gates. For tests. */
export function describeRoutes({ routes }: { readonly routes: readonly ServerRoute[] }, _optional: Record<string, never> = {}): { method: string; path: string; gates: readonly string[] }[] {
  return routes.map((route) => ({ method: route.method, path: route.path, gates: gateNames(route) }));
}

/**
 * One JSON route spec as a daemon route: the host's incident reporter and body limit applied, and a
 * `same-origin` gate named when the spec asks for it (the JSON route itself runs that check).
 * @param required.spec - The route's declaration.
 * @param required.deps - What the route's `handle` is given.
 * @param required.host - The host the route list was built for.
 */
export function gatedJsonRoute<Input, Output, Deps>(
  { spec, deps, host }: { readonly spec: JsonRouteSpec<Input, Output, Deps>; readonly deps: Deps; readonly host: DaemonRouteHost },
  _optional: Record<string, never> = {},
): DaemonRoute {
  return gated({
    route: jsonRoute({ spec: { ...spec, maxBodyBytes: host.jsonBodyMaxBytes }, deps, reportInternalError: host.reportInternalError }, { host: host.context }),
    gates: spec.requireSameOrigin ? [{ name: 'same-origin' }] : [],
  });
}

/**
 * `deps` with the host's reporter added, without copying `deps`: every member stays readable through
 * the original object, so a deps value that is not a plain bag (a class instance, a proxy that fails on
 * use) behaves exactly as it did before the reporter was added.
 * @param required.deps - What a route group was given.
 * @param required.host - The host whose reporter the routes use for internal failures.
 */
export function withHostReporter<Deps extends object>(
  { deps, host }: { readonly deps: Deps; readonly host: DaemonRouteHost },
  _optional: Record<string, never> = {},
): Deps & { readonly reportInternalError: DaemonRouteHost['reportInternalError'] } {
  return Object.create(deps, { reportInternalError: { value: host.reportInternalError, enumerable: true } }) as Deps & { readonly reportInternalError: DaemonRouteHost['reportInternalError'] };
}
