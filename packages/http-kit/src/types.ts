/**
 * Express-bound route-spec shapes (`JsonRoutePorts`, `JsonRouteSpec`) consumed by `mountJsonRoute`.
 * The framework-free vocabulary (`Result`, `Handler`, `InputParser`, …) lives in
 * `@jini-ai/core/contracts/server`.
 */
import type { Handler, HttpMethod, InputParser, JsonRouteAuthorizeScope, RouteInputContext, ServerApiError } from '@jini-ai/core/contracts/server';
import type { Response } from 'express';

/** Host-owned workspace, authentication/authorization and exception policy.
 * Guards throw on rejection; the error port owns their wire envelope. Without an error port the
 * adapter retains its caller-safe-error and SEC-005 redaction policy. Authentication can await
 * host readiness; it runs after workspace rejection and before parsing or handling.
 */
export interface JsonRoutePorts<Deps, Context = undefined> {
  readonly workspace?: (requiredArgs: { readonly raw: RouteInputContext; readonly deps: Deps }) => void | Promise<void>;
  readonly authenticate?: (requiredArgs: { readonly raw: RouteInputContext; readonly res: Response; readonly deps: Deps }) => Context | Promise<Context>;
  readonly authorize?: (requiredArgs: { readonly context: Context | undefined; readonly deps: Deps; readonly permission: string; readonly entityType: string }, optionalArgs?: JsonRouteAuthorizeScope) => void | Promise<void>;
  readonly onError?: (requiredArgs: { readonly res: Response; readonly error: unknown }) => void;
  /**
   * Opt-in writer for a RETURNED parse or handler failure. Without it a returned `err` keeps the
   * core `{ error: ServerApiError }` envelope at `statusForError` (the base pins), and it never
   * reaches `onError` (a host's exception classifier must not re-map an already-classified
   * failure). A host whose wire envelope is flat supplies this so a returned failure and a thrown
   * refusal reach the caller in the same shape; `status` is the core default it may keep or override.
   */
  readonly onReturnedError?: (requiredArgs: { readonly res: Response; readonly error: ServerApiError; readonly status: number; readonly phase: 'parse' | 'handle' }) => void;
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
