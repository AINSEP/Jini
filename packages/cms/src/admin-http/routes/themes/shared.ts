import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";

/**
 * @file Shared guard for the `themes` admin route specs (list, duplicate). The theme list itself,
 * its stored-id resolution and the duplication service are the host's theme discovery, injected
 * per route; the specs keep only the HTTP rules (order, mapping, status per refusal).
 */

/** The principal fields these routes read: none beyond the id the host port authorizes with. */
export interface ThemeRoutePrincipal { id: string }

/**
 * Asks the host for one theme permission, id-free (neither route ever named an entity id). A mount
 * without an authorizer is a wiring bug, not a caller error, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeThemes(
  { authorize, permission, entityType }: { authorize: JsonRouteAuthorize | undefined; permission: string; entityType: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (!authorize) throw new Error("themes admin route has no authorizer");
  await authorize({ permission, entityType });
}
