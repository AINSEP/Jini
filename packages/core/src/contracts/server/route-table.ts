/**
 * @file Route table for the `Server` contract: path matching and the contract's precedence rule,
 * shared by every host adapter so none re-implements them. Web-standard only.
 */
import type { Server, ServerMethod, ServerRoute } from '../server.js';

/** The outcome of matching one request against a route table. */
export type RouteMatch =
  | { readonly kind: 'route'; readonly route: ServerRoute; readonly params: Readonly<Record<string, string>> }
  | { readonly kind: 'method-not-allowed'; readonly allow: readonly ServerMethod[] }
  /** Only from a table made with `lenientPaths`: a route's shape fits but one `:name` segment is not valid percent-encoding. */
  | { readonly kind: 'malformed-path' }
  | { readonly kind: 'not-found' };

/** A `Server` that also answers which registered route a request reaches. */
export interface RouteTable extends Server {
  match(requiredArgs: { readonly method: string; readonly pathname: string }, optionalArgs?: Record<string, never>): RouteMatch;
}

/** Decodes one `:name` segment; malformed percent-encoding is "no match" (`null`), per the contract, not a thrown 500. */
function decodeParam(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

type SegmentMatch = { readonly params: Record<string, string> } | 'malformed' | null;

/** Compares one fixed segment; `lenient` ignores letter case. */
function sameLiteral({ want, got, lenient }: { want: string; got: string; lenient: boolean }): boolean {
  return lenient ? want.toLowerCase() === got.toLowerCase() : want === got;
}

/**
 * The pathname the patterns are compared with. A lenient table accepts one trailing slash
 * (`/runs/` for `/runs`) and nothing more: `//` is still a different path, and `/` stays `/`.
 */
function comparablePath({ pathname, lenient }: { pathname: string; lenient: boolean }): string {
  return lenient && pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function matchSegments({ pattern, pathname, lenient }: { pattern: string; pathname: string; lenient: boolean }): SegmentMatch {
  const expected = pattern.split('/');
  const actual = comparablePath({ pathname, lenient }).split('/');
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  let malformed = false;
  for (let index = 0; index < expected.length; index += 1) {
    const want = expected[index] ?? '';
    const got = actual[index] ?? '';
    if (!want.startsWith(':')) {
      if (!sameLiteral({ want, got, lenient })) return null;
      continue;
    }
    // An empty segment is a different path (Express's `:name` needs one or more characters), not a bad escape.
    if (got === '') return null;
    const value = decodeParam(got);
    if (value === null) malformed = true;
    else params[want.slice(1)] = value;
  }
  // A later literal that differs still means "no match", so the verdict waits for the whole path.
  return malformed ? 'malformed' : { params };
}

/**
 * Matches a registered `pattern` (e.g. `/notes/:id`) against a URL `pathname` with the contract's
 * path syntax. Returns the decoded `:name` params, or `null`. One matcher, so every adapter agrees.
 */
export function matchServerPath({ pattern, pathname }: { readonly pattern: string; readonly pathname: string }, _optional: Record<string, never> = {}): Record<string, string> | null {
  const found = matchSegments({ pattern, pathname, lenient: false });
  return found === null || found === 'malformed' ? null : found.params;
}

/** `:name` segments become `:`, so paths that differ only in param names compare equal (and, for a lenient table, in letter case). */
function pathShape({ path, lenient }: { path: string; lenient: boolean }): string {
  return path.split('/').map((segment) => (segment.startsWith(':') ? ':' : lenient ? segment.toLowerCase() : segment)).join('/');
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

/** Optional settings for {@link createRouteTable}. */
export interface RouteTableOptions {
  /**
   * Match the way Express 4 does by default, for a host that replaces Express routes with this
   * table and must keep answering the spellings its callers already send: fixed segments ignore
   * letter case, one trailing slash is accepted, and a `:name` segment that is not valid
   * percent-encoding is reported as `malformed-path` (Express answers 400) instead of "no match".
   * Default `false`: the contract's exact matching.
   */
  readonly lenientPaths?: boolean;
}

/**
 * Creates an empty route table. `route()` refuses a second registration of the same method + path
 * shape; `match()` applies the contract's precedence (literal beats `:param`, registration order
 * never decides) and answers a HEAD from the GET route when no HEAD route exists.
 * @complexity `match` is O(routes × segments); fine for the few hundred routes a host mounts.
 */
export function createRouteTable(_required = {}, { lenientPaths = false }: RouteTableOptions = {}): RouteTable {
  const routes: ServerRoute[] = [];
  return {
    route(route) {
      const shape = pathShape({ path: route.path, lenient: lenientPaths });
      if (routes.some((existing) => existing.method === route.method && pathShape({ path: existing.path, lenient: lenientPaths }) === shape)) {
        throw new Error(`The route ${route.method} ${route.path} is registered twice. Remove one of the two registrations.`);
      }
      routes.push({ method: route.method, path: route.path, handler: route.handler });
    },
    match({ method, pathname }) {
      const matched: { route: ServerRoute; params: Record<string, string> }[] = [];
      let malformed = false;
      for (const route of routes) {
        const found = matchSegments({ pattern: route.path, pathname, lenient: lenientPaths });
        if (found === 'malformed') malformed = lenientPaths || malformed;
        else if (found) matched.push({ route, params: found.params });
      }
      if (matched.length === 0) return malformed ? { kind: 'malformed-path' } : { kind: 'not-found' };
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
