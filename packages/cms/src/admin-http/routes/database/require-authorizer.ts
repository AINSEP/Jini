import type { JsonRouteAuthorize } from '@jini-ai/core/contracts/server';

/**
 * The database routes always authorize before they read: a handler invoked without the host's
 * authorizer must fail closed (the host failure port answers 500), never read unauthorized data.
 * @returns The authorizer the host supplied.
 * @complexity O(1).
 */
export function requireAuthorizer({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): JsonRouteAuthorize {
  if (!authorize) throw new Error('database admin route requires the host authorizer');
  return authorize;
}
