/**
 * @file Same-origin security guard: wraps the host's origin policy in the `Result` pipeline so a route
 * host can treat an origin failure the same as a parse/handle failure.
 */
import { isLocalSameOrigin, type OriginValidationEnvConfig, type OriginValidationLoggerPort, type RequestWithOriginHeaders } from '../../origin-validation.js';
import type { ServerApiError } from './api-error.js';
import { err, ok, type Result } from './result.js';

/** Decides whether a request comes from one of the host's own pages. The host injects it, and tests pass a fake. */
export interface SameOriginPolicyPort {
  isSameOrigin(required: { readonly req: RequestWithOriginHeaders }, optional?: Record<string, never>): boolean;
}

/** What a route host hands every same-origin-guarded route. */
export interface OriginContext {
  readonly originPolicy: SameOriginPolicyPort;
}

/**
 * The standard local-daemon policy: loopback/bind host, the resolved port, and the host's allow-list env var.
 * `port` is read on every call, because the listener binds after the routes are built.
 *
 * `env` is the host-supplied environment; the host also names the bind-host, allowed-origin and web-port vars.
 *
 * Present because a host can inject its own environment, and that injection already reaches
 * the origin-guard *middleware* — which is handed an explicit `env`. Without the same seam here,
 * the two halves of one decision read two different environments: the middleware admits an origin
 * the host configured and the per-route guard then rejects it, or a bind host the host never set
 * decides what counts as same-origin.
 */
export function createLocalSameOriginPolicy(
  required: { readonly port: () => number; readonly env: Readonly<Record<string, string | undefined>>; readonly config: OriginValidationEnvConfig },
  optional: { readonly logger?: OriginValidationLoggerPort } = {},
): SameOriginPolicyPort {
  return { isSameOrigin: ({ req }) => isLocalSameOrigin({ req, port: required.port(), env: required.env, config: required.config }, optional) };
}

/**
 * Asks the host's origin policy and folds a refusal into the same error-handling pipeline as
 * parse/handle failures.
 */
export function guardSameOrigin({ req, origin }: { readonly req: RequestWithOriginHeaders; readonly origin: OriginContext }, _optional: Record<string, never> = {}): Result<void> {
  if (origin.originPolicy.isSameOrigin({ req })) return ok({ value: undefined });
  const error: ServerApiError = { code: 'FORBIDDEN', message: 'cross-origin request rejected' };
  return err({ error });
}
