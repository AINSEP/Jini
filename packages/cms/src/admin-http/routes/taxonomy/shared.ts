import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";

/** @file Helpers shared by the taxonomy admin route specs (Categories & Tags, ADR-044). */

/** The session principal these routes read. */
export interface TaxonomyRoutePrincipal { id: string }

/** ADR-044 registers exactly one permission for this whole domain (no `.read`/`.write` split).
 * @complexity O(1) beyond the injected authorizer. */
export async function authorizeTaxonomyManage(
  { authorize, entityType }: { authorize: JsonRouteAuthorize | undefined; entityType: "taxonomy" | "term" },
  optional: JsonRouteAuthorizeScope = {},
): Promise<void> {
  if (!authorize) throw new Error("taxonomy admin route has no authorizer");
  const required = { permission: "admin.taxonomy.manage", entityType };
  await (optional.entityId === undefined ? authorize(required) : authorize(required, { entityId: optional.entityId }));
}

/** The authenticated principal; the host's authenticate port always supplies one.
 * @complexity O(1). */
export function taxonomyPrincipal({ context }: { context: TaxonomyRoutePrincipal | undefined }, _optional: Record<string, never> = {}): TaxonomyRoutePrincipal {
  if (!context) throw new Error("taxonomy admin route has no authenticated principal");
  return context;
}
