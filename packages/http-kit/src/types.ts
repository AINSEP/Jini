/**
 * Foundational layer: the shared `Result` success/failure envelope and the route-spec shape
 * (`JsonRouteSpec`, `InputParser`, `Handler`, `HttpMethod`, `RouteInputContext`) every other
 * module in this package depends on.
 */
import type { Result as CoreResult } from '@jini-ai/core/primitives';
import type { ApiError } from '@jini-ai/protocol';
import type { Response } from 'express';

/**
 * A discriminated success/failure envelope used throughout the module in place of throwing.
 * Route parsing, handling, and origin checks all resolve to a `Result` so the Adapter can fold
 * every failure mode into one error-handling pipeline.
 */
export type Result<T, E = ApiError> = CoreResult<T, E>;

/** Builds a successful `Result` carrying `value`. */
export const ok = <T, E = ApiError>({ value }: { readonly value: T }, _optional: Record<string, never> = {}): Result<T, E> => ({ ok: true, value });
/** Builds a failed `Result` carrying `error`. */
export const err = <T = never, E = ApiError>({ error }: { readonly error: E }, _optional: Record<string, never> = {}): Result<T, E> => ({ ok: false, error });

/**
 * The normalized shape of a raw HTTP request handed to a route's `parse` function: body, query,
 * and params, decoupled from any framework `Request` type so parsers are unit-testable without
 * a real server.
 */
export interface RouteInputContext {
  body: unknown;
  query: Record<string, unknown>;
  params: Record<string, string>;
}

/** Parses a `RouteInputContext` into a typed `Input`, or fails with an `ApiError`. */
export type InputParser<Input> = (raw: RouteInputContext) => Result<Input>;

/**
 * Handles a parsed `Input` (plus injected `Deps`) and produces a `Result<Output>`.
 *
 * `signal` is optional and additive: it aborts if the underlying HTTP request's connection drops
 * before the Adapter has written a response (see `mountJsonRoute` in `adapter.ts`) — handlers read it from their optional arguments when they perform cancellable work.
 */
export type Handler<Input, Output, Deps, Context = undefined> = (
  requiredArgs: { readonly input: Input; readonly deps: Deps; readonly context?: Context | undefined; readonly authorize?: JsonRouteAuthorize },
  optionalArgs?: { readonly signal?: AbortSignal | undefined },
) => Promise<Result<Output>> | Result<Output>;

/** HTTP verbs the Adapter can mount a `JsonRouteSpec` under. */
export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

/** Explicit authorization remains at the route's chosen point, preserving validation precedence. */
export type JsonRouteAuthorize = (
  requiredArgs: { readonly permission: string; readonly entityType: string },
  optionalArgs?: Record<string, never>,
) => Promise<void>;

/** Host-owned workspace, authentication/authorization and exception policy.
 * Guards throw on rejection; the error port owns their wire envelope. Without an error port the
 * adapter retains its caller-safe-error and SEC-005 redaction policy. Authentication can await
 * host readiness; it runs after workspace rejection and before parsing or handling.
 */
export interface JsonRoutePorts<Deps, Context = undefined> {
  readonly workspace?: (requiredArgs: { readonly raw: RouteInputContext; readonly deps: Deps }) => void | Promise<void>;
  readonly authenticate?: (requiredArgs: { readonly raw: RouteInputContext; readonly res: Response; readonly deps: Deps }) => Context | Promise<Context>;
  readonly authorize?: (requiredArgs: { readonly context: Context | undefined; readonly deps: Deps; readonly permission: string; readonly entityType: string }) => void | Promise<void>;
  readonly onError?: (requiredArgs: { readonly res: Response; readonly error: unknown }) => void;
}

/**
 * Declarative description of one JSON route: how to parse input, how to handle it, and whether
 * it requires a same-origin request. Consumed by `mountJsonRoute` in `adapter.ts`.
 */
export interface JsonRouteSpec<Input, Output, Deps, Context = undefined> {
  method: HttpMethod;
  path: string;
  requireSameOrigin?: boolean;
  parse: InputParser<Input>;
  handle: Handler<Input, Output, Deps, Context>;
  successStatus?: number;
  ports?: JsonRoutePorts<Deps, Context>;
}
