/**
 * @file Route table for the `Server` contract: path matching and the contract's precedence rule,
 * shared by every host adapter so none re-implements them. Web-standard only.
 */
import type { Server, ServerMethod, ServerRoute } from '../server.js';

/** The outcome of matching one request against a route table. */
export type RouteMatch =
  | { readonly kind: 'route'; readonly route: ServerRoute; readonly params: Readonly<Record<string, string>> }
  | { readonly kind: 'method-not-allowed'; readonly allow: readonly ServerMethod[] }
  | { readonly kind: 'not-found' };

/** A `Server` that also answers which registered route a request reaches. */
export interface RouteTable extends Server {
  match(requiredArgs: { readonly method: string; readonly pathname: string }, optionalArgs?: Record<string, never>): RouteMatch;
}

/** Decodes one `:name` segment; an empty segment or malformed percent-encoding is "no match" (`null`), per the contract, not a thrown 500. */
function decodeParam(segment: string): string | null {
  if (segment === '') return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Matches a registered `pattern` (e.g. `/notes/:id`) against a URL `pathname` with the contract's
 * path syntax. Returns the decoded `:name` params, or `null`. One matcher, so every adapter agrees.
 */
export function matchServerPath({ pattern, pathname }: { readonly pattern: string; readonly pathname: string }, _optional: Record<string, never> = {}): Record<string, string> | null {
  const expected = pattern.split('/');
  const actual = pathname.split('/');
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const want = expected[index] ?? '';
    const got = actual[index] ?? '';
    if (!want.startsWith(':')) {
      if (want !== got) return null;
      continue;
    }
    const value = decodeParam(got);
    if (value === null) return null;
    params[want.slice(1)] = value;
  }
  return params;
}

/** `:name` segments become `:`, so paths that differ only in param names compare equal. */
function pathShape(path: string): string {
  return path.split('/').map((segment) => (segment.startsWith(':') ? ':' : segment)).join('/');
}

/** Negative when `a` wins: at the first segment where one is literal and the other `:param`, the literal wins. */
function bySpecificity(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  for (let index = 0; index < left.length; index += 1) {
    const aParam = (left[index] ?? '').startsWith(':');
    const bParam = (right[index] ?? '').startsWith(':');
    if (aParam !== bParam) return aParam ? 1 : -1;
  }
  return 0;
}

/**
 * Creates an empty route table. `route()` refuses a second registration of the same method + path
 * shape; `match()` applies the contract's precedence (literal beats `:param`, registration order
 * never decides) and answers a HEAD from the GET route when no HEAD route exists.
 * @complexity `match` is O(routes × segments); fine for the few hundred routes a host mounts.
 */
export function createRouteTable(_required = {}, _optional: Record<string, never> = {}): RouteTable {
  const routes: ServerRoute[] = [];
  return {
    route(route) {
      const shape = pathShape(route.path);
      if (routes.some((existing) => existing.method === route.method && pathShape(existing.path) === shape)) {
        throw new Error(`The route ${route.method} ${route.path} is registered twice. Remove one of the two registrations.`);
      }
      routes.push({ method: route.method, path: route.path, handler: route.handler });
    },
    match({ method, pathname }) {
      const matched: { route: ServerRoute; params: Record<string, string> }[] = [];
      for (const route of routes) {
        const params = matchServerPath({ pattern: route.path, pathname });
        if (params) matched.push({ route, params });
      }
      if (matched.length === 0) return { kind: 'not-found' };
      const best = (wanted: string) => matched.filter((m) => m.route.method === wanted)
        .sort((a, b) => bySpecificity(a.route.path, b.route.path))[0];
      const hit = best(method) ?? (method === 'HEAD' ? best('GET') : undefined);
      if (hit) return { kind: 'route', route: hit.route, params: hit.params };
      const allow = new Set<ServerMethod>(matched.map((m) => m.route.method));
      if (allow.has('GET')) allow.add('HEAD');
      return { kind: 'method-not-allowed', allow: [...allow] };
    },
  };
}
