/**
 * Express-bound route-spec shapes (`JsonRoutePorts`, `JsonRouteSpec`) consumed by `mountJsonRoute`.
 * The framework-free vocabulary (`Result`, `Handler`, `InputParser`, …) lives in
 * `@jini-ai/core/contracts/server`.
 */
import type { Handler, HttpMethod, InputParser, JsonRouteAuthorize, JsonRouteAuthorizeScope, RouteInputContext, RouteRequestFacts, ServerApiError } from '@jini-ai/core/contracts/server';
import type { Request, Response } from 'express';

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
}

/** The request-context opt-ins and static response headers a JSON or raw spec may declare. */
export interface RouteRequestOptIns {
  /** Header names handed to the route as `raw.headers` (lower-cased keys; an absent header has no key). */
  readHeaders?: readonly string[];
  /** Hands the host-resolved facts to the route as `raw.facts`; requires the `requestFacts` port. */
  requestFacts?: true;
  /** Static headers set on EVERY answer of the route, before any gate (a refusal carries them too). */
  responseHeaders?: Readonly<Record<string, string>>;
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
 * per-route parser left on the request (a `Buffer` behind `express.raw`).
 */
export interface RawRouteSpec<Deps, Context = undefined> extends RouteRequestOptIns {
  method: HttpMethod;
  path: string;
  requireSameOrigin?: boolean;
  /** Body ceiling for every method but GET/HEAD, measured as in `JsonRouteSpec`. */
  maxBodyBytes?: number;
  ports?: JsonRoutePorts<Deps, Context>;
  handle(
    requiredArgs: { readonly raw: RouteInputContext; readonly deps: Deps; readonly context: Context | undefined; readonly authorize: JsonRouteAuthorize },
    optionalArgs: { readonly signal: AbortSignal },
  ): Promise<globalThis.Response>;
}
