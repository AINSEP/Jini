import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";

/**
 * @file Shared guards for the `comments` admin route specs (moderation queue, moderation actions,
 * settings).
 */

/** The principal fields these routes read: only the id, as the moderation/settings actor. */
export interface CommentsRoutePrincipal { id: string }

/**
 * Each comments admin route is gated by one `comments.*` permission on its own entity type. The
 * host injects `authorize`; a mount without one is a wiring bug, not a caller error. Per-comment
 * actions pass the requested `entityId`; the queue and the settings act on no single comment.
 *
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeComments(
  { authorize, permission, entityType }: { authorize: JsonRouteAuthorize | undefined; permission: string; entityType: string },
  optional: JsonRouteAuthorizeScope = {},
): Promise<void> {
  if (!authorize) throw new Error("comments admin route has no authorizer");
  const required = { permission, entityType };
  await (optional.entityId === undefined ? authorize(required) : authorize(required, { entityId: optional.entityId }));
}

/**
 * The authenticated principal's id, recorded as the write's actor.
 *
 * @complexity O(1).
 */
export function commentsActorId({ context }: { context: CommentsRoutePrincipal | undefined }, _options: Record<string, never> = {}): string {
  if (!context) throw new Error("comments admin route has no authenticated principal");
  return context.id;
}
