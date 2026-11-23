import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import type { ToolGapsToolDeps } from '@jini-ai/core/contracts/site/assistant-host-ports';
import type { ToolGapEntry } from '@jini-ai/core/contracts/site/daemon-tool-audit';
import { rejectRoute } from '@jini-ai/core/errors/route-refusal';

/**
 * @file `GET /api/admin/v1/workspaces/:workspaceId/system/tool-gaps` — owner-only Observability
 * filter over the existing tool audit store. No mutation endpoint. Not RBAC-gated: only the
 * install's owner principal may read it (the 403 is this route's own copy); the workspace 404 and
 * the session principal come from the host ports.
 */

/** What this route reads: the same deps the owner-only `tool_gaps_list` tool registration gets. */
export type AdminToolGapsRouteDeps = ToolGapsToolDeps;

/** The fields of the authenticated principal this route reads. */
export interface ToolGapsPrincipal { id: string }

/** `GET .../system/tool-gaps`: the owner's tool-gap entries, 503 when no audit store is wired.
 * @complexity O(1) plus the injected audit read.
 */
export const toolGapsRoute = defineJsonRoute<Record<string, never>, { entries: readonly ToolGapEntry[] }, AdminToolGapsRouteDeps, ToolGapsPrincipal>({
  method: 'get',
  path: '/api/admin/v1/workspaces/:workspaceId/system/tool-gaps',
  parse: () => ok({ value: {} }),
  handle: async ({ deps, context }) => {
    if (!context) throw new Error('tool-gaps route has no authenticated principal');
    if (context.id !== await deps.ownerPrincipalId) rejectRoute({ status: 403, error: 'Only the owner can read tool gaps.', code: 'FORBIDDEN' });
    if (!deps.toolGaps) rejectRoute({ status: 503, error: 'Tool gap audit storage is unavailable.' });
    return ok({ value: { entries: await deps.toolGaps.list({ workspaceId: deps.workspaceId, principalId: context.id }, {}) } });
  },
});
