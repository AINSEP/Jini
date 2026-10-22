/**
 * Same-origin security guard: wraps `isLocalSameOrigin` in the module's `Result` pipeline so
 * the Adapter can treat an origin failure the same as a parse/handle failure.
 */
import type { Request } from 'express';
import { createApiError } from '@jini-ai/protocol';
import { isLocalSameOrigin, type OriginValidationEnvConfig } from '@jini-ai/core';
import { err, ok, type Result } from './types.js';

/** The subset of server startup state `guardSameOrigin` needs: the resolved local port, and the
 * environment the origin policy is read from. */
export interface OriginContext extends OriginValidationEnvConfig {
  resolvedPortRef: { current: number };
  /**
   * Host-supplied environment; the host also names the bind-host, allowed-origin and web-port vars.
   *
   * Present because a host can inject its own environment (`@jini-ai/server`'s
   * `createLocalNodeDaemon`/`composeJiniKernel` `env` option), and that injection already reaches
   * the origin-guard *middleware* — which is handed an explicit `env`. Without the same seam here,
   * the two halves of one decision read two different environments: the middleware admits an origin
   * the host configured and the per-route guard then rejects it, or a bind host the host never set
   * decides what counts as same-origin.
   */
  env: NodeJS.ProcessEnv;
}

/**
 * Wraps `isLocalSameOrigin` so the HTTP Adapter can fold the origin decision into the same
 * error-handling pipeline as parse/handle failures.
 */
export function guardSameOrigin({ req, origin }: { readonly req: Request; readonly origin: OriginContext }, _optional: Record<string, never> = {}): Result<void> {
  const { env, allowedOriginsEnvVar, webPortEnvVar, bindHostEnvVar } = origin;
  if (isLocalSameOrigin({ req, port: origin.resolvedPortRef.current, env,
    config: { allowedOriginsEnvVar, webPortEnvVar, bindHostEnvVar },
  })) {
    return ok({ value: undefined });
  }
  return err({ error: createApiError({ code: 'FORBIDDEN', message: 'cross-origin request rejected' }) });
}
