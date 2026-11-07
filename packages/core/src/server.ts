/**
 * @file The server contract: register a handler for an HTTP method + path, where handlers speak
 * the web-standard `Request` → `Response`. Route code in Jini packages takes `{ app: Server }`
 * and never names a concrete server, so any host adapter (plain Node `http`, Express, a Fetch
 * runtime, an in-memory test fake) can serve the same routes.
 *
 * Universal: types plus one pure path matcher. No server code lives here.
 *
 * Overlap, kept deliberately: `@jini-ai/http-kit` has its own Express-bound route-spec shapes
 * (`HttpMethod` in lowercase, `RouteInputContext.params`). Core is the bottom layer and must not
 * import http-kit, so those are not reused; a later bridge can map one onto the other.
 */

/** HTTP methods a route may be registered under. Uppercase, matching web `Request.method`. */
export type ServerMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Handles one matched request. `params` holds the `:name` path segments of the registered path,
 * already percent-decoded by the adapter (for `/notes/:id` and `/notes/a%20b`, `{ id: 'a b' }`).
 * Body, query string, headers and abort signal are read from `request` itself.
 */
export type ServerHandler = (
  requiredArgs: { readonly request: Request; readonly params: Readonly<Record<string, string>> },
  optionalArgs?: Record<string, never>,
) => Response | Promise<Response>;

/**
 * Something routes can be registered on.
 *
 * Path syntax: literal segments and `:name` segments, matched segment by segment against the
 * request URL's pathname (no wildcards, no regex, query string ignored). Use `matchServerPath`
 * for exactly these semantics. Registering the same method + path twice is an adapter error.
 * An unmatched request is the adapter's to answer (typically 404, or 405 when only the method
 * differs).
 *
 * @agent-note In your app, use whichever server adapter you prefer, including Express. A plain
 * Node `http` adapter is about 40 lines: keep a route list, convert each `IncomingMessage` into a
 * web `Request`, find the route with `matchServerPath`, call its handler, and write the returned
 * `Response` (status, headers, body) back to the `ServerResponse`. Fetch-native runtimes skip the
 * conversion. Tests can use an in-memory fake that dispatches a `Request` directly.
 */
export interface Server {
  route(
    requiredArgs: { readonly method: ServerMethod; readonly path: string; readonly handler: ServerHandler },
    optionalArgs?: Record<string, never>,
  ): void;
}

/**
 * Matches a registered `pattern` (e.g. `/notes/:id`) against a URL `pathname`. Returns the decoded
 * `:name` params on a match, or `null`. Segment counts must be equal; a trailing slash is not
 * ignored. Literal segments compare against the pathname as given (still percent-encoded). A param
 * segment never matches an empty segment, and one whose percent-encoding is malformed does not match.
 */
export function matchServerPath(
  { pattern, pathname }: { readonly pattern: string; readonly pathname: string },
  _optional: Record<string, never> = {},
): Record<string, string> | null {
  const expected = pattern.split('/');
  const actual = pathname.split('/');
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const want = expected[index] ?? '';
    const got = actual[index] ?? '';
    if (want.startsWith(':')) {
      if (got === '') return null;
      try {
        params[want.slice(1)] = decodeURIComponent(got);
      } catch {
        return null;
      }
    } else if (want !== got) {
      return null;
    }
  }
  return params;
}
