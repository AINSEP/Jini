import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { authorizeExternalMcp, externalMcpParam, type ExternalMcpRoutePrincipal } from "./shared.js";

/** Host collaborator: removes one row. @returns Whether a row was removed. */
export type ExternalMcpDeleteServerFn = (required: { workspaceId: string; serverId: string }) => Promise<boolean>;

/** The deps this route reads: the runtime's built-in provenance check and the host's delete. */
export interface ExternalMcpDeleteRouteDeps {
  workspaceId: string;
  isBuiltInServer: (serverId: string) => boolean;
  deleteServer: ExternalMcpDeleteServerFn;
}

/**
 * DELETE one external MCP server from the workspace's roster.
 *
 * Answers 404 when no row was removed rather than reporting success for an id that never existed —
 * a silent success here would tell an operator a server is gone when what actually happened is that
 * they deleted a typo and the real one is still configured and still being launched at every boot.
 *
 * Its tools refuse from the next call — `external-mcp-revocation.ts`'s per-call gate re-reads the
 * row on every federated call and refuses one whose row is gone. `restartRequired` stays true
 * because the running assistant still holds the open connection and lists the tools until it
 * restarts. The delete itself is unchanged and permanent.
 */
export const externalMcpDeleteRoute = defineJsonRoute<{ serverId: string }, { removed: true; restartRequired: true }, ExternalMcpDeleteRouteDeps, ExternalMcpRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/mcp-servers/:serverId",
  parse: (raw) => ok({ value: { serverId: externalMcpParam(raw.params, "serverId") } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeExternalMcp({ authorize });
    if (deps.isBuiltInServer(input.serverId)) rejectRoute({ status: 409, error: "built-in MCP connections cannot be removed", code: "BUILT_IN_CONNECTION" });
    const removed = await deps.deleteServer({ workspaceId: deps.workspaceId, serverId: input.serverId });
    if (!removed) rejectRoute({ status: 404, error: "external MCP server was not found", code: "NOT_FOUND" });
    return ok({ value: { removed: true, restartRequired: true } });
  },
});
