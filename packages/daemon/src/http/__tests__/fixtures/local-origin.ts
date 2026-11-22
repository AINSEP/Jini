/**
 * @file The host-style origin binding for route tests that talk to a real listener: the real local
 * same-origin policy reading a port ref the test fills in once the server is listening, exactly as a
 * host does. Tests whose subject is not origin policy use `createTestRouteHost` from core instead.
 */
import type { RouteHostContext } from '@jini-ai/core/contracts/server';
import { createLocalSameOriginPolicy } from '@jini-ai/core/contracts/server';

/** The env-var names the daemon's local origin policy reads. */
export const testOriginConfig = { allowedOriginsEnvVar: 'JINI_ALLOWED_ORIGINS', webPortEnvVar: 'JINI_WEB_PORT', bindHostEnvVar: 'JINI_BIND_HOST' };

/** A route host whose origin policy reads `portRef.current` per call; set it once the test server listens. */
export function createLocalTestOrigin(
  _required = {},
  optional: { readonly port?: number; readonly env?: Readonly<Record<string, string | undefined>> } = {},
): { readonly adapter: RouteHostContext; readonly portRef: { current: number } } {
  const portRef = { current: optional.port ?? 0 };
  const originPolicy = createLocalSameOriginPolicy({ port: () => portRef.current, env: optional.env ?? {}, config: testOriginConfig });
  return { adapter: { originPolicy }, portRef };
}
