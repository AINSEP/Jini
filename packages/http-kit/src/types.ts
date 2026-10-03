/**
 * Foundational layer: the shared `Result` success/failure envelope and the route-spec shape
 * (`JsonRouteSpec`, `InputParser`, `Handler`, `HttpMethod`, `RouteInputContext`) every other
 * module in this package depends on.
 */
import type { Result as CoreResult } from '@jini-ai/core/primitives';
import type { ApiError } from '@jini-ai/protocol';

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
export type Handler<Input, Output, Deps> = (
  requiredArgs: { readonly input: Input; readonly deps: Deps },
  optionalArgs?: { readonly signal?: AbortSignal | undefined },
) => Promise<Result<Output>> | Result<Output>;

/** HTTP verbs the Adapter can mount a `JsonRouteSpec` under. */
export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

/**
 * Declarative description of one JSON route: how to parse input, how to handle it, and whether
 * it requires a same-origin request. Consumed by `mountJsonRoute` in `adapter.ts`.
 */
export interface JsonRouteSpec<Input, Output, Deps> {
  method: HttpMethod;
  path: string;
  requireSameOrigin?: boolean;
  parse: InputParser<Input>;
  handle: Handler<Input, Output, Deps>;
  successStatus?: number;
}
