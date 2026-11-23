import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';

import { toAdminWorkspaceResponse, type AdminWorkspaceResponse } from '../../http/workspace.js';
import { authorizeWorkspaceManage, workspaceRefusal, WORKSPACES_PATH, type WorkspaceAdminRouteDeps, type WorkspaceRoutePrincipal } from './deps.js';

/**
 * GET workspaces/:workspaceId — SPEC-044 REQ-03. `:workspaceId` must equal the caller's own
 * (boot-wired) workspace, else `404` (INV-04 — matches every other admin route's existing
 * mismatched-workspaceId convention; checked by the host's workspace port before authorization, so
 * a mismatched id never discloses whether a permission grant exists). Gated by `workspace.manage`.
 * The parse is total: there is nothing to validate beyond the path the host port already checked.
 */
export const workspaceGetRoute = defineJsonRoute<Record<string, never>, { workspace: AdminWorkspaceResponse }, WorkspaceAdminRouteDeps, WorkspaceRoutePrincipal>({
  method: 'get',
  path: `${WORKSPACES_PATH}/:workspaceId`,
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeWorkspaceManage({ authorize });
    const workspace = await deps.workspaceRepo.findById({ id: deps.workspaceId });
    if (!workspace) throw workspaceRefusal({ status: 404, error: 'workspace was not found' });
    return ok({ value: { workspace: toAdminWorkspaceResponse(workspace) } });
  },
});
