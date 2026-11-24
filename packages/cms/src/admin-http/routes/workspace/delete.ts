import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';

import { deleteWorkspace, WorkspaceLastRemainingError, WorkspaceNotFoundError } from '../../../workspace/index.js';
import { authorizeWorkspaceManage, workspaceRefusal, WORKSPACES_PATH, type WorkspaceAdminRouteDeps, type WorkspaceRoutePrincipal } from './deps.js';

/** The target named by the request path. */
export interface WorkspaceDeleteInput { workspaceId: string }

/**
 * Maps `deleteWorkspace`'s thrown error types onto their wire refusal; anything else is returned
 * unchanged for the host's opaque failure mapping.
 *
 * Because INV-05 below refuses every request this route can currently address, `deleteWorkspace`
 * is never actually reached over HTTP in v1, so these branches have no live caller today — they are
 * retained (and tested directly rather than through a fetch) for the multi-workspace future the
 * transition already supports. That is the deliberate cost of guarding on identity: the refusal
 * moved earlier than the domain call.
 *
 * @complexity O(1).
 */
export function deleteWorkspaceFailure({ error }: { error: unknown }, _optional: Record<string, never> = {}): unknown {
  if (error instanceof WorkspaceLastRemainingError) return workspaceRefusal({ status: 409, error: error.message, code: 'LAST_WORKSPACE' });
  if (error instanceof WorkspaceNotFoundError) return workspaceRefusal({ status: 404, error: error.message, code: 'RESOURCE_NOT_FOUND' });
  return error;
}

/**
 * INV-05 (identity, not count — see the route's header below) followed by the domain delete.
 *
 * The route's `:workspaceId` check narrows every addressable target to `deps.workspaceId`, so over
 * HTTP this always takes the BOUND_WORKSPACE refusal in v1, and the not-bound path below has no live
 * caller until a second workspace becomes addressable. It passes `deps.workspaceId` to the domain
 * delete exactly as the original inline handler did (behaviour kept identical); whether that should
 * be `targetWorkspaceId` once a second workspace is addressable is an owner decision, not settled
 * here. Throws the domain's typed errors for the caller's `deleteWorkspaceFailure` to map.
 *
 * @throws RouteRefusalError 409 BOUND_WORKSPACE for the bound workspace; Error without a transaction port.
 * @complexity O(1) plus `deleteWorkspace`'s own O(workspaces) roster check.
 */
export async function deleteWorkspaceUnlessBound(
  { deps, targetWorkspaceId }: { deps: WorkspaceAdminRouteDeps; targetWorkspaceId: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (targetWorkspaceId === deps.workspaceId) {
    throw workspaceRefusal({
      status: 409,
      error: 'the workspace this server is bound to cannot be deleted while it is serving that workspace',
      code: 'BOUND_WORKSPACE',
    });
  }

  const transaction = deps.workspaceRepo.transaction;
  if (!transaction) throw new Error('workspace deletion requires a transaction port');
  await deleteWorkspace({
    deps: { repo: deps.workspaceRepo, transaction: transaction.bind(deps.workspaceRepo) },
    input: { id: deps.workspaceId },
  });
}

/**
 * DELETE workspaces/:workspaceId — `DELETE_WORKSPACE` (SPEC-044 REQ-05/INV-03, AC-06).
 * `:workspaceId` must equal the caller's own workspace (INV-04, checked by the host's workspace port
 * before authorization, and before the last-workspace guard — EC-04: an unauthorized caller learns
 * nothing about workspace count). Gated by `workspace.manage`. Success is `204` with no body.
 *
 * INV-05 (bound-workspace guard) — the reason this route refuses.
 *
 * `deleteWorkspace`'s INV-03 guard (this package's workspace `delete.ts`) refuses only when the
 * target is the install's LAST remaining workspace ROW (`repo.list().length <= 1`); it does not
 * compare the row against this process's own fixed `deps.workspaceId`. That made the safety
 * property row-count-based rather than identity-based, and the count is caller-controlled: a
 * principal holding `workspace.manage` could POST a second, empty workspace row and then DELETE
 * this process's own `deps.workspaceId`, leaving every other route in the composition pointed at
 * a workspace id that no longer resolves. It was never a privilege-escalation path (both calls
 * need `workspace.manage`), but a single permission should not be able to destroy the running
 * site's own scope as a side effect of satisfying an unrelated invariant.
 *
 * The guard is therefore keyed on identity, not on count: this process refuses to delete the
 * workspace it is bound to, whatever the row count happens to be. Because the `:workspaceId` check
 * already narrows the target to `deps.workspaceId`, that makes the route refuse unconditionally
 * today — which is the honest v1 answer, and the same answer INV-03 gave by accident. When a
 * genuinely addressable second workspace arrives, this guard keeps refusing exactly the one
 * workspace that must not be deleted and lets the rest through, where the count guard would have
 * started allowing all of them. INV-03 stays in place underneath as defence-in-depth for any other
 * host of the package.
 *
 * Placed AFTER `authorize()` on purpose, in the position the count guard occupied, preserving
 * EC-04: an unauthorized caller still learns nothing about workspace count or bindings.
 */
export const workspaceDeleteRoute = defineJsonRoute<WorkspaceDeleteInput, undefined, WorkspaceAdminRouteDeps, WorkspaceRoutePrincipal>({
  method: 'delete',
  path: `${WORKSPACES_PATH}/:workspaceId`,
  parse: (raw) => ok({ value: { workspaceId: String(raw.params.workspaceId ?? '') } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeWorkspaceManage({ authorize });
    try {
      await deleteWorkspaceUnlessBound({ deps, targetWorkspaceId: input.workspaceId });
    } catch (error) {
      throw deleteWorkspaceFailure({ error });
    }
    return ok({ value: undefined });
  },
}, { successStatus: 204 });
