import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import type { AdminWorkspaceResponse } from '@jini-ai/core/contracts/site/cms-workspace';

import { toAdminWorkspaceResponse } from '../../http/workspace.js';
import { authorizeWorkspaceManage, WORKSPACES_PATH, type WorkspaceAdminRouteDeps, type WorkspaceRoutePrincipal } from './deps.js';

/**
 * GET workspaces — SPEC-044 REQ-02. Returns an array containing exactly the caller's own
 * (boot-wired `deps.workspaceId`) workspace — v1 never has more than one row addressable by a
 * running process. Gated by `workspace.manage`. The path has no `:workspaceId`, so the host mounts
 * it without the workspace check.
 */
export const workspaceListRoute = defineJsonRoute<Record<string, never>, { workspaces: AdminWorkspaceResponse[] }, WorkspaceAdminRouteDeps, WorkspaceRoutePrincipal>({
  method: 'get',
  path: WORKSPACES_PATH,
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeWorkspaceManage({ authorize });
    const own = await deps.workspaceRepo.findById({ id: deps.workspaceId });
    // Defensive: the boot-wired workspaceId always resolves to a real row by construction (the
    // host's composition root seeds it before any request can be served) — not an expected runtime path.
    const workspaces = own ? [toAdminWorkspaceResponse({ workspace: own })] : [];
    return ok({ value: { workspaces } });
  },
});
