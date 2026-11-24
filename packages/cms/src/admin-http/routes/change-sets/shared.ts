import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";

import type { RevertPrincipalKind } from "../../../core/commands/revert.js";

/**
 * @file Shared guards for the `change-sets` admin route specs.
 *
 * Each hand-written change-set route asked the host's authorizer for one `changeset.*` permission on
 * the `change_set` entity type. The by-id routes name the change set they act on; the list names none.
 */

/** The principal fields these routes read: the id (the actor) and the kind (revert's agent-cannot-force rule). */
export interface ChangeSetRoutePrincipal { id: string; kind: RevertPrincipalKind }

/**
 * Asks the host for one `changeset.*` permission on the `change_set` entity type. By-id routes pass the
 * requested `entityId` so the host decides for that change set; the list acts on no single one.
 * A mount without an authorizer is a wiring bug, not a caller error, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeChangeSet(
  { authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string },
  optional: JsonRouteAuthorizeScope = {},
): Promise<void> {
  if (!authorize) throw new Error("change-sets admin route has no authorizer");
  const required = { permission, entityType: "change_set" };
  await (optional.entityId === undefined ? authorize(required) : authorize(required, { entityId: optional.entityId }));
}

/** The `:changeSetId` path segment; Express always fills it, the `?? ""` mirrors the host's own guard. @complexity O(1). */
export function changeSetIdParam(params: Record<string, string | undefined>): string {
  return String(params.changeSetId ?? "");
}
