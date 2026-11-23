import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { authorizeExternalMcp, externalMcpParam, type ExternalMcpRoutePrincipal } from "./shared.js";

/**
 * @file The Integrations "Always allow" list (owner call 2026-09-28): which remote tools the site
 * owner told the approval card to stop asking about, per external MCP server, and a revoke for each.
 *
 * Reads and deletes `external_mcp_tool_approvals` rows (`Jini packages/mcp/src/federation/tool-approvals.ts`).
 * Revoking is reversible — the tool's next call just shows the card again — so there is no confirm
 * step anywhere on this path. Granting stays on the card: a grant is pinned to a fingerprint of the
 * tool exactly as the running daemon admitted it, which only the card's own call path has.
 *
 * The fingerprint is never sent: it is a hash the page has no use for.
 *
 * A composition with no store (`toolApprovalRepo` unset) can have saved nothing, so its
 * list is empty and every revoke is a 404 — the truthful answer, not an error.
 */

/** One saved grant as the store returns it (other fields, e.g. the fingerprint, are never sent). */
export interface ExternalMcpToolApprovalRow { serverId: string; toolName: string; grantedByPrincipalId: string; grantedAt: string }

/** The host's workspace-scoped approval store, only the two methods these routes call. */
export interface ExternalMcpToolApprovalStore {
  listByWorkspaceId(workspaceId: string): Promise<readonly ExternalMcpToolApprovalRow[]>;
  delete(input: { workspaceId: string; serverId: string; toolName: string }): Promise<boolean>;
}

/** The deps both routes read. The store key is required; its value is `undefined` when none is composed. */
export interface ExternalMcpToolApprovalsRouteDeps {
  workspaceId: string;
  toolApprovalRepo: ExternalMcpToolApprovalStore | undefined;
}

/** GET the saved "Always allow" grants, sorted by server then tool. */
export const externalMcpToolApprovalsListRoute = defineJsonRoute<Record<string, never>, { approvals: ExternalMcpToolApprovalRow[] }, ExternalMcpToolApprovalsRouteDeps, ExternalMcpRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/mcp-servers/tool-approvals",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeExternalMcp({ authorize });
    const rows = (await deps.toolApprovalRepo?.listByWorkspaceId(deps.workspaceId)) ?? [];
    const approvals = rows
      .map(({ serverId, toolName, grantedByPrincipalId, grantedAt }) => ({ serverId, toolName, grantedByPrincipalId, grantedAt }))
      .sort((a, b) => a.serverId.localeCompare(b.serverId) || a.toolName.localeCompare(b.toolName));
    return ok({ value: { approvals } });
  },
});

/** DELETE one saved grant; 404 when none was saved for that tool. */
export const externalMcpToolApprovalRevokeRoute = defineJsonRoute<{ serverId: string; toolName: string }, { removed: true }, ExternalMcpToolApprovalsRouteDeps, ExternalMcpRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/mcp-servers/:serverId/tool-approvals/:toolName",
  parse: (raw) => ok({ value: { serverId: externalMcpParam(raw.params, "serverId"), toolName: externalMcpParam(raw.params, "toolName") } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeExternalMcp({ authorize });
    const removed = (await deps.toolApprovalRepo?.delete({ workspaceId: deps.workspaceId, serverId: input.serverId, toolName: input.toolName })) ?? false;
    if (!removed) rejectRoute({ status: 404, error: "no Always allow is saved for that tool", code: "NOT_FOUND" });
    return ok({ value: { removed: true } });
  },
});
