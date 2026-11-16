/**
 * @file Same-origin security guard: wraps `isLocalSameOrigin` in the `Result` pipeline so a route
 * host can treat an origin failure the same as a parse/handle failure.
 */
import { isLocalSameOrigin, type OriginValidationEnvConfig, type RequestWithOriginHeaders } from '../../origin-validation.js';
import type { ServerApiError } from './api-error.js';
import { err, ok, type Result } from './result.js';

/** The subset of server startup state `guardSameOrigin` needs: the resolved local port, and the
 * environment the origin policy is read from. */
export interface OriginContext extends OriginValidationEnvConfig {
  resolvedPortRef: { current: number };
  /**
   * Host-supplied environment; the host also names the bind-host, allowed-origin and web-port vars.
   *
   * Present because a host can inject its own environment, and that injection already reaches
   * the origin-guard *middleware* — which is handed an explicit `env`. Without the same seam here,
   * the two halves of one decision read two different environments: the middleware admits an origin
   * the host configured and the per-route guard then rejects it, or a bind host the host never set
   * decides what counts as same-origin.
   */
  env: Readonly<Record<string, string | undefined>>;
}

/**
 * Wraps `isLocalSameOrigin` so a route host can fold the origin decision into the same
 * error-handling pipeline as parse/handle failures.
 */
export function guardSameOrigin({ req, origin }: { readonly req: RequestWithOriginHeaders; readonly origin: OriginContext }, _optional: Record<string, never> = {}): Result<void> {
  const { env, allowedOriginsEnvVar, webPortEnvVar, bindHostEnvVar } = origin;
  if (isLocalSameOrigin({ req, port: origin.resolvedPortRef.current, env,
    config: { allowedOriginsEnvVar, webPortEnvVar, bindHostEnvVar },
  })) {
    return ok({ value: undefined });
  }
  const error: ServerApiError = { code: 'FORBIDDEN', message: 'cross-origin request rejected' };
  return err({ error });
}
