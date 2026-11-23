import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

/**
 * @file Guards shared by the media admin route specs.
 *
 * Every media route answered an unknown asset with the same `404 media '<id>' was not found` body
 * and asked the host's authorizer for a `media.*` permission on entity type `media`. Owning both
 * once keeps those routes' status codes and bodies from drifting apart.
 */

/** The principal fields these routes read: only the id, as the removal's acting principal. */
export interface MediaRoutePrincipal { id: string }

/**
 * Ask the host's authorizer for one media permission. A by-id route names its asset
 * (`entityId`); an id-free route (the provider map) sends no `entityId` key at all.
 *
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeMedia(
  { authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string },
  optional: JsonRouteAuthorizeScope = {},
): Promise<void> {
  if (!authorize) throw new Error("media admin route has no authorizer");
  const required = { permission, entityType: "media" };
  await (optional.entityId === undefined ? authorize(required) : authorize(required, { entityId: optional.entityId }));
}

/** The authenticated principal; the host's authenticate port always sets it before `handle` runs.
 *  @complexity O(1). */
export function principalOf({ context }: { context: MediaRoutePrincipal | undefined }, _optional: Record<string, never> = {}): MediaRoutePrincipal {
  if (!context) throw new Error("media admin route has no authenticated principal");
  return context;
}

/** Refuses with the media routes' `404 media '<id>' was not found` body.
 *  @complexity O(1). */
export function rejectMediaNotFound({ mediaId }: { mediaId: string }, _optional: Record<string, never> = {}): never {
  return rejectRoute({ status: 404, error: `media '${mediaId}' was not found` });
}
