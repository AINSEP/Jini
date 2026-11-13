/**
 * @file Framework-free building blocks for `@jini-ai/core/contracts/server`'s `Server` contract,
 * shared by every host adapter so no adapter re-implements them: the route table (path matching
 * and the contract's precedence rule), the middleware decorator, JSON responses and bounded body
 * reading. Web-standard `Request`/`Response` only, so this file runs on any runtime.
 *
 * Why a decorator instead of `Server.use`: middleware wraps the routes registered THROUGH it, so
 * which routes a gate covers is decided by where they are registered, never by registration order
 * against a framework's layer stack. That keeps the `Server` contract one method wide and makes
 * an exemption explicit (`exemptPaths`) instead of an accident of mount order.
 */
import type { Server, ServerMethod, ServerMiddleware, ServerRoute } from '@jini-ai/core/contracts/server';
import { createApiError } from '@jini-ai/protocol';
import { err, ok, type Result } from './types.js';

/** The outcome of matching one request against a route table. */
export type RouteMatch =
  | { readonly kind: 'route'; readonly route: ServerRoute; readonly params: Readonly<Record<string, string>> }
  | { readonly kind: 'method-not-allowed'; readonly allow: readonly ServerMethod[] }
  | { readonly kind: 'not-found' };

/** A `Server` that also answers which registered route a request reaches. */
export interface RouteTable extends Server {
  match(requiredArgs: { readonly method: string; readonly pathname: string }, optionalArgs?: Record<string, never>): RouteMatch;
}

/**
 * Matches a registered `pattern` (e.g. `/notes/:id`) against a URL `pathname` with the contract's
 * path syntax. Returns the decoded `:name` params, or `null`. Moved from
 * `examples/notes-app/src/node-server.ts` so every adapter shares one matcher.
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
    if (got === '') return null;
    try {
      params[want.slice(1)] = decodeURIComponent(got);
    } catch {
      // Malformed percent-encoding is "no match", per the contract, not a thrown 500.
      return null;
    }
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
export function createRouteTable(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): RouteTable {
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
      server.route({ ...route, handler: (args) => runChain({ route, middleware, args }) });
    },
  };
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

/** A JSON response with Express's `res.json` content type, so clients see the same header. */
export function jsonResponse({ status, body }: { readonly status: number; readonly body: unknown }, { headers = {} }: { readonly headers?: Readonly<Record<string, string>> } = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

/** Stands in for what `qs` turned a bracketed key into (`a[b]=1` → an object): not a string, so a route's "must be a string" check still refuses it. */
const BRACKETED_QUERY_VALUE: Readonly<Record<string, never>> = Object.freeze({});

function addQueryValue({ query, key, value }: { query: Map<string, unknown>; key: string; value: string }): void {
  const bracket = key.indexOf('[');
  if (bracket <= 0) {
    const previous = query.get(key);
    if (previous === undefined) query.set(key, value);
    else if (Array.isArray(previous)) previous.push(value);
    else if (typeof previous === 'string') query.set(key, [previous, value]);
    return;
  }
  const name = key.slice(0, bracket);
  const previous = query.get(name);
  if (key === `${name}[]` && (previous === undefined || Array.isArray(previous))) query.set(name, [...(previous ?? []), value]);
  else query.set(name, BRACKETED_QUERY_VALUE);
}

/**
 * The query string in the shapes the Express 4 host's `req.query` gave routes, so a converted
 * route's existing validation sees the same values: one value → string; a repeated key or
 * `name[]` → `string[]`; any other bracketed key (`a[b]=1`) → a non-string value, so a route that
 * requires a string still refuses it instead of reading it as absent. Nested values are not
 * parsed: no Jini route reads them. Built from entries, so `__proto__` is a plain key.
 * @complexity O(n) in query parameters.
 */
export function readQuery({ request }: { readonly request: Request }, _optional: Record<string, never> = {}): Record<string, unknown> {
  const query = new Map<string, unknown>();
  for (const [key, value] of new URL(request.url).searchParams) addQueryValue({ query, key, value });
  return Object.fromEntries(query);
}

/** Express's `express.json()` default ceiling, kept so moving a route off Express changes no limit. */
export const DEFAULT_JSON_BODY_MAX_BYTES = 100 * 1024;

function tooLarge(maxBytes: number) {
  return createApiError({ code: 'PAYLOAD_TOO_LARGE', message: `The request body is larger than the ${maxBytes} bytes this address accepts. Send less data.` });
}

/**
 * Reads the whole body as bytes, refusing (413, `PAYLOAD_TOO_LARGE`) as soon as it passes
 * `maxBytes` — a declared `content-length` above the limit is refused before reading anything.
 * A request with no body gives zero bytes.
 */
export async function readBodyBytes({ request }: { readonly request: Request }, { maxBytes = DEFAULT_JSON_BODY_MAX_BYTES }: { readonly maxBytes?: number } = {}): Promise<Result<Uint8Array>> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return err({ error: tooLarge(maxBytes) });
  if (!request.body) return ok({ value: new Uint8Array(0) });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Stop pulling from the socket at once: an oversized upload must not be buffered to the end.
      await reader.cancel();
      return err({ error: tooLarge(maxBytes) });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return ok({ value: bytes });
}

function isJsonContentType(contentType: string | null): boolean {
  const mediaType = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

/**
 * Reads a JSON body the way the Express 4 host's `express.json()` did, so a converted route sees
 * the same value: no body, an empty body or a non-JSON content type give `{}`; only an object or
 * array is accepted (body-parser's strict mode); invalid JSON is a 400 `BAD_REQUEST`; a body over
 * `maxBytes` is a 413 `PAYLOAD_TOO_LARGE`.
 */
export async function readJsonBody({ request }: { readonly request: Request }, { maxBytes = DEFAULT_JSON_BODY_MAX_BYTES }: { readonly maxBytes?: number } = {}): Promise<Result<unknown>> {
  if (!isJsonContentType(request.headers.get('content-type'))) return ok({ value: {} });
  const bytes = await readBodyBytes({ request }, { maxBytes });
  if (!bytes.ok) return bytes;
  const text = new TextDecoder().decode(bytes.value).trim();
  if (text === '') return ok({ value: {} });
  const invalid = createApiError({ code: 'BAD_REQUEST', message: 'The request body is not valid JSON. Send a JSON object or array.' });
  if (!text.startsWith('{') && !text.startsWith('[')) return err({ error: invalid });
  try {
    return ok({ value: JSON.parse(text) as unknown });
  } catch {
    return err({ error: invalid });
  }
}
