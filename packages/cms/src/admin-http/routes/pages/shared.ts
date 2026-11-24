import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";

/**
 * @file The read guard and row shape shared by the pages admin route specs.
 *
 * A page is a post row with `kind: "page"` (same table, same repo, same editor), so both read routes
 * ask the host's authorizer for `content.read` on entity type `post` and name no entity: the list
 * has none, and the by-id route's param may be a slug rather than the stored id, so it is not an
 * entity id the authorizer could match a grant against.
 */

/** The principal fields these routes read: only the id. */
export interface PageRoutePrincipal { id: string }

/** The fields of the host's post row these specs read; the host's own DTO helper renders the rest. */
export interface AdminPageRecord {
  kind: string;
  bodyHtml?: string | null;
}

/**
 * Ask the host's authorizer for `content.read` on posts, naming no entity. A mount without an
 * authorizer is a wiring bug, not a caller error, so it fails closed.
 *
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizePageRead({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("pages admin route has no authorizer");
  await authorize({ permission: "content.read", entityType: "post" });
}
