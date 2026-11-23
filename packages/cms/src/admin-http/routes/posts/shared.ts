import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";

/**
 * @file The read guard shared by the posts admin route specs.
 *
 * Both read routes ask the host's authorizer for `content.read` on entity type `post` and name no
 * entity: the list has none, and the by-id route's param may be a slug rather than the stored id, so
 * it is not an entity id the authorizer could match a grant against.
 */

/** The principal fields these routes read: only the id. */
export interface PostRoutePrincipal { id: string }

/**
 * Ask the host's authorizer for `content.read` on posts, naming no entity.
 *
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizePostRead({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("posts admin route has no authorizer");
  await authorize({ permission: "content.read", entityType: "post" });
}
