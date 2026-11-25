/**
 * Express-bound route-spec shapes (`JsonRoutePorts`, `JsonRouteSpec`) consumed by `mountJsonRoute`.
 * The framework-free vocabulary (`Result`, `Handler`, `InputParser`, …) lives in
 * `@jini-ai/core/contracts/server`.
 */
import type { Handler, HttpMethod, InputParser, JsonRouteAuthorize, JsonRouteAuthorizeScope, RawRouteInputContext, RouteInputContext, RouteRequestFacts, ServerApiError } from '@jini-ai/core/contracts/server';
import type { Request, RequestHandler, Response } from 'express';

/** Host-owned workspace, authentication/authorization and exception policy.
 * Guards throw on rejection; the error port owns their wire envelope. Without an error port the
 * adapter retains its caller-safe-error and SEC-005 redaction policy. Authentication can await
 * host readiness; it runs after workspace rejection and before parsing or handling.
 */
export interface JsonRoutePorts<Deps, Context = undefined> {
  readonly workspace?: (requiredArgs: { readonly raw: RouteInputContext; readonly deps: Deps }) => void | Promise<void>;
  /** May answer `undefined` (no principal yet): the handler then sees no `context`, and the host's
   *  `authorize` port decides — after `parse`, so a body refusal still wins over a missing session. */
  readonly authenticate?: (requiredArgs: { readonly raw: RouteInputContext; readonly res: Response; readonly deps: Deps }) => Context | undefined | Promise<Context | undefined>;
  /** `entityType` is present only when the handler gave one: a host pinning exact arguments sees no `entityType` key otherwise. */
  readonly authorize?: (requiredArgs: { readonly context: Context | undefined; readonly deps: Deps; readonly permission: string; readonly entityType?: string }, optionalArgs?: JsonRouteAuthorizeScope) => void | Promise<void>;
  readonly onError?: (requiredArgs: { readonly res: Response; readonly error: unknown }) => void;
  /**
   * Opt-in writer for a RETURNED parse or handler failure. Without it a returned `err` keeps the
   * core `{ error: ServerApiError }` envelope at `statusForError` (the base pins), and it never
   * reaches `onError` (a host's exception classifier must not re-map an already-classified
   * failure). A host whose wire envelope is flat supplies this so a returned failure and a thrown
   * refusal reach the caller in the same shape; `status` is the core default it may keep or override.
   */
  readonly onReturnedError?: (requiredArgs: { readonly res: Response; readonly error: ServerApiError; readonly status: number; readonly phase: 'parse' | 'handle' }) => void;
  /**
   * The host's request-facts resolver (its proxy-trust answer for the client address, plus user agent
   * and host). Consulted only for a spec with `requestFacts: true`; such a spec mounted without this
   * port throws at mount time, so a missing resolver is never a silently absent client address.
   */
  readonly requestFacts?: (requiredArgs: { readonly req: Request; readonly deps: Deps }) => RouteRequestFacts;
  /**
   * Opt-in writer for the body-cap 413 that `allowRouteBody` answers when a spec's `maxBodyBytes` is
   * exceeded (JSON and raw mounts alike). Absent, core's `payloadTooLargeError` envelope is written
   * unchanged. A host whose admin client already reads its own 413 body supplies this so a route moved
   * onto a spec keeps that body; the cap still runs before the workspace port and the handler.
   */
  readonly payloadTooLarge?: (requiredArgs: { readonly res: Response; readonly maxBytes: number }) => void;
}

/** Optional mount settings shared by `mountJsonRoute` and `mountRawRoute`. */
export interface RouteMountOptions<Deps = never> {
  /**
   * Body parsers registered between the path and the handler of THIS route only
   * (`app[method](path, ...bodyParsers, handler)`), as a hand-written route mounted its own
   * `express.urlencoded`. Scoped to the one registration, never an `app.use`, so no other route sees it.
   */
  readonly bodyParsers?: readonly RequestHandler[];
  /**
   * Per-request host deps: called once per request, after the spec's static `responseHeaders` and
   * before every gate, with the request, the response and the mounted deps; what it returns is the
   * `deps` the ports and `handle` receive for THAT request. It is how a host hands a spec facts only
   * the request holds (a client address, a consent cookie, whether the socket is local) as closures
   * already bound to that request, so the spec never sees `req` and stays server-framework neutral.
   * Synchronous so the gates keep their tick order; a throw takes the route's error path. Absent,
   * the mounted deps reach the route unchanged.
   */
  readonly requestDeps?: (required: { readonly req: Request; readonly res: Response; readonly deps: Deps }) => Deps;
}

/** The request-context opt-ins and static response headers a JSON or raw spec may declare. */
export interface RouteRequestOptIns {
  /** Header names handed to the route as `raw.headers` (lower-cased keys; an absent header has no key). */
  readHeaders?: readonly string[];
  /** Hands the host-resolved facts to the route as `raw.facts`; requires the `requestFacts` port. */
  requestFacts?: true;
  /** Static headers set on EVERY answer of the route, before any gate (a refusal carries them too). */
  responseHeaders?: Readonly<Record<string, string>>;
  /**
   * Request-dependent headers, set once the workspace port admitted the request — before same-origin,
   * authenticate, parse and handle — so the workspace refusal never carries them and every later answer
   * (a refusal, a thrown authorization or handler failure, the success) does. `undefined` sets none.
   * For a hand-written route that set a header from the query right after its workspace check
   * (`?kind=document`'s `Cache-Control: private, no-store`). Absent, nothing extra is written.
   */
  admittedResponseHeaders?: (raw: RouteInputContext) => Readonly<Record<string, string>> | undefined;
}

/**
 * Declarative description of one JSON route: how to parse input, how to handle it, and whether
 * it requires a same-origin request. Consumed by `mountJsonRoute` in `adapter.ts`.
 */
export interface JsonRouteSpec<Input, Output, Deps, Context = undefined> extends RouteRequestOptIns {
  method: HttpMethod;
  path: string;
  requireSameOrigin?: boolean;
  /**
   * Body ceiling for every method but GET/HEAD, same field as core's `JsonRouteSpec`. It can only
   * tighten the host's JSON parser limit, never widen it: that parser reads the wire first.
   */
  maxBodyBytes?: number;
  parse: InputParser<Input>;
  handle: Handler<Input, Output, Deps, Context>;
  successStatus?: number;
  ports?: JsonRoutePorts<Deps, Context>;
}

/**
 * Declarative description of one non-JSON route (HTML, a stream, an upload, a download, a redirect
 * with cookies): the same gates and host ports as a JSON spec, but `handle` receives the raw input and
 * answers with a web `Response`, which `mountRawRoute` writes back. `raw.body` is whatever the host's
 * per-route parser left on the request (a `Buffer` behind `express.raw`); a route that must not read an
 * unauthorized body registers no parser and calls `raw.readBody(...)` after its gates instead.
 */
export interface RawRouteSpec<Deps, Context = undefined> extends RouteRequestOptIns {
  method: HttpMethod;
  path: string;
  requireSameOrigin?: boolean;
  /** Body ceiling for every method but GET/HEAD, measured as in `JsonRouteSpec`. */
  maxBodyBytes?: number;
  ports?: JsonRoutePorts<Deps, Context>;
  /**
   * Opt-in: read the whole `Response` body and answer through Express's `res.send(Buffer)` instead of
   * streaming it — `Content-Length`, the host's ETag and a bodiless 304 for a fresh GET/HEAD, as a
   * hand-written `res.send` route answered. Absent: the body streams chunked, with no ETag and no 304.
   * `'redirect'`: the same, except that a 3xx answer carrying `Location` is replayed through the host
   * framework's own redirect writer, so a top-level browser redirect keeps its Accept-negotiated body and
   * `Vary: Accept` (the spec still only states its intent: status, `Location`, headers, cookies).
   */
  bufferedReply?: true | 'redirect';
  handle(
    requiredArgs: { readonly raw: RawRouteInputContext; readonly deps: Deps; readonly context: Context | undefined; readonly authorize: JsonRouteAuthorize },
    optionalArgs: { readonly signal: AbortSignal },
  ): Promise<globalThis.Response>;
}
