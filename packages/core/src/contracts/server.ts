/**
 * @file The server contract: register a handler for an HTTP method + path, where handlers speak
 * the web-standard `Request` → `Response`. Route code in Jini packages takes `{ app: Server }`
 * and never names a concrete server, so any host adapter (plain Node `http`, Express, a Fetch
 * runtime, an in-memory test fake) can serve the same routes.
 *
 * Types only. Path matching, dispatch and every other piece of server code belong to the host's
 * adapter, which the host passes in as `app`.
 *
 * Overlap, kept deliberately: `@jini-ai/http-kit` has its own Express-bound route-spec shapes
 * (`HttpMethod` in lowercase, `RouteInputContext.params`). Core is the bottom layer and must not
 * import http-kit, so those are not reused; a later bridge can map one onto the other.
 */

/**
 * HTTP methods a route may be registered under. Uppercase, matching web `Request.method`.
 *
 * @agent-note Register `HEAD` only when it must differ from `GET`: an adapter answers a `HEAD`
 * with no `HEAD` route from the `GET` route, keeping its status and headers and dropping the
 * body. Register `OPTIONS` to answer a CORS preflight yourself; nothing answers it for you.
 */
export type ServerMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

/**
 * Handles one matched request. `params` holds the `:name` path segments of the registered path,
 * already percent-decoded by the adapter (for `/notes/:id` and `/notes/a%20b`, `{ id: 'a b' }`).
 * Body, query string, headers and abort signal are read from `request` itself.
 *
 * `client` is the immediate peer of the connection, which a web `Request` cannot carry: the
 * adapter fills it from its socket (Node's `incoming.socket.remoteAddress`, Bun's `requestIP`,
 * Deno's `remoteAddr`). It is absent when the adapter has no peer (an in-memory fake, a closed
 * socket). It is never read from a header: trusting `x-forwarded-for` is host policy, applied
 * on top of this value.
 *
 * @agent-note Return a web `Response`; never write to a socket or framework response object, so
 * the same handler runs on every adapter. Read the body once from `request` (`json()`,
 * `formData()`, `text()`). For a client IP, start from `client.address`; read a forwarded header
 * only behind a proxy the host trusts.
 */
export type ServerHandler = (
  requiredArgs: {
    readonly request: Request;
    readonly params: Readonly<Record<string, string>>;
    readonly client?: { readonly address: string };
  },
  optionalArgs?: Record<string, never>,
) => Response | Promise<Response>;

/**
 * Something routes can be registered on.
 *
 * Path syntax: literal segments and `:name` segments, matched segment by segment against the
 * request URL's pathname (no wildcards, no regex, query string ignored). Segment counts must be
 * equal and a trailing slash is not ignored. Literal segments compare against the pathname as
 * given (still percent-encoded). A `:name` segment never matches an empty segment, and one whose
 * percent-encoding is malformed does not match. Registering the same method + path twice is an
 * adapter error. An unmatched request is the adapter's to answer (typically 404, or 405 when only
 * the method differs).
 *
 * @agent-note In your app, use whichever server adapter you prefer, including Express. A plain
 * Node `http` adapter is about 60 lines (`examples/notes-app/src/node-server.ts` is one): keep a
 * route list, convert each `IncomingMessage` into a web `Request`, match the path as described
 * above, call the handler, and write the returned `Response` (status, headers, body) back to the
 * `ServerResponse`. Fetch-native runtimes skip the conversion. Tests can use an in-memory fake
 * that dispatches a `Request` directly.
 */
export interface Server {
  route(
    requiredArgs: { readonly method: ServerMethod; readonly path: string; readonly handler: ServerHandler },
    optionalArgs?: Record<string, never>,
  ): void;
}
