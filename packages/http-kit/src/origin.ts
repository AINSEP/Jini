/**
 * Same-origin security guard: wraps `isLocalSameOrigin` in the module's `Result` pipeline so
 * the Adapter can treat an origin failure the same as a parse/handle failure.
 */
import type { Request } from 'express';
import { createApiError } from '@jini-ai/protocol';
import { isLocalSameOrigin } from './origin-validation.js';
import { err, ok, type Result } from './types.js';

/** The subset of server startup state `guardSameOrigin` needs: the resolved local port, and the
 * environment the origin policy is read from. */
export interface OriginContext {
  resolvedPortRef: { current: number };
  /**
   * Environment `JINI_BIND_HOST`, `JINI_ALLOWED_ORIGINS` and `JINI_WEB_PORT` are read from.
   *
   * @default `process.env`
   *
   * Present because a host can inject its own environment (`@jini-ai/server`'s
   * `createLocalNodeDaemon`/`composeJiniKernel` `env` option), and that injection already reaches
   * the origin-guard *middleware* — which is handed an explicit `env`. Without the same seam here,
   * the two halves of one decision read two different environments: the middleware admits an origin
   * the host configured and the per-route guard then rejects it, or a bind host the host never set
   * decides what counts as same-origin.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * Wraps `isLocalSameOrigin` so the HTTP Adapter can fold the origin decision into the same
 * error-handling pipeline as parse/handle failures.
 */
export function guardSameOrigin(req: Request, origin: OriginContext): Result<void> {
  if (isLocalSameOrigin(req, origin.resolvedPortRef.current, origin.env ?? process.env)) {
    return ok(undefined);
  }
  return err(createApiError('FORBIDDEN', 'cross-origin request rejected'));
}
