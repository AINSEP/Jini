/** CMS permission checking preserves the CMS command denial contract. Generic registration wiring lives in the kernel. */
import { ForbiddenError, type AuthorizeFn } from "../commands/command.js";
import type { AuthorizationPort } from "../authorization.js";
export type { AuthorizationPort, AuthorizationRequired, AuthorizationOptional } from "../authorization.js";

export interface RequireToolPermissionRequired {
  authorize: AuthorizationPort;
  workspaceId: string;
  principalId: string;
  permission: string;
}
export interface RequireToolPermissionOptional {
  entityType?: string | undefined;
  entityId?: string | undefined;
}

/**
 * Runs the identical inline `authorize()` check the corresponding admin HTTP route performs, for a
 * tool whose own domain function carries no `authorize()` call to inherit.
 *
 * This is NOT a second evaluator alongside another check — that is exactly the single-evaluator
 * rule's concern. For each tool that
 * calls it, this IS the only gate that tool's execution ever reaches, reached by an identical path
 * to the one a human clicking the same admin route reaches. Domains split cleanly on which kind
 * they are: content-types/Forms/Identity mutations and every Widgets write-service call self-enforce
 * inside the domain function and must NOT call this; Comments/Members/Newsletter/Media/Menus/
 * Database/Recovery gate in the route instead, so their handlers call this in the route's place.
 * Which kind a given tool is stays documented next to that tool's handler, not here.
 *
 * Throws `core/commands`'s `ForbiddenError` — the same class `executeCommand` itself throws — so a
 * tool caller and a route caller see the identical error shape for an identical denial. Throw
 * rather than a 403 body because the caller here is `ToolExecutor`, which reads a thrown error as a
 * failed execution and has no response to write to.
 *
 * Import the defining command module directly: its barrel also exports mutation appliers that
 * name content features. Pulling that barrel into shared permission wiring would couple every
 * tool domain to those features; the direct import preserves the identical denial class without
 * that dependency closure.
 *
 * @param required - The `authorize()` evaluator and the workspace the run is scoped to.
 * @param optional - Entity scope for who is asking, for what permission, optionally against which entity.
 * @throws {ForbiddenError} If `authorize()` denies.
 * @complexity O(1) beyond the injected `authorize()` call.
 * @overallScore 100
 */

export async function requireToolPermission(required: RequireToolPermissionRequired, optional: RequireToolPermissionOptional = {}): Promise<void> {
  const result = await required.authorize({
    principalId: required.principalId, permission: required.permission, workspaceId: required.workspaceId,
  }, optional);
  if (!result.allowed) throw new ForbiddenError({
    message: `principal '${required.principalId}' is not authorized for '${required.permission}' (${result.reason})`,
    permission: required.permission, reason: result.reason,
  });
}


/** Adapt an existing evaluator without losing entity scope. @complexity O(1) plus evaluation. */
export function adaptLegacyAuthorize(required: { authorize: AuthorizeFn }, _optional: Record<string, never> = {}): AuthorizationPort {
  return (request, optional = {}) => required.authorize({ ...request, ...optional });
}
