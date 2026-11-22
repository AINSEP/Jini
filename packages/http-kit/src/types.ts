/**
 * Express-bound route-spec shapes (`JsonRoutePorts`, `JsonRouteSpec`) consumed by `mountJsonRoute`.
 * The framework-free vocabulary (`Result`, `Handler`, `InputParser`, …) lives in
 * `@jini-ai/core/contracts/server`.
 */
import type { Handler, HttpMethod, InputParser, RouteInputContext } from '@jini-ai/core/contracts/server';
import type { Response } from 'express';

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
  /** Body ceiling for every method but GET, measured on the already-parsed body; over it is a 413. */
  maxBodyBytes?: number;
  parse: InputParser<Input>;
  handle: Handler<Input, Output, Deps, Context>;
  successStatus?: number;
  ports?: JsonRoutePorts<Deps, Context>;
}
