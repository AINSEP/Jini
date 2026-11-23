import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeExternalMcp, type ExternalMcpDescribeOwnershipFn, type ExternalMcpOwnedServer, type ExternalMcpRoutePrincipal } from "./shared.js";

/** Host collaborator: the workspace's server read model (never env VALUES; safe hints only). */
export type ExternalMcpListServersFn = (required: { workspaceId: string }) => Promise<ReadonlyArray<{ serverId: string }>>;

/** The deps this route reads: the workspace, the host's read model and its ownership tagger. */
export interface ExternalMcpListRouteDeps {
  workspaceId: string;
  listServers: ExternalMcpListServersFn;
  describeOwnership: ExternalMcpDescribeOwnershipFn;
}

/**
 * GET the workspace's configured external MCP servers, for Settings → External MCP.
 *
 * Serves the read model only: `envNames` without any env VALUE. There is deliberately no route
 * anywhere that returns a stored env value — the tab has no use for one, and an endpoint that
 * decrypted credentials for display would be a strictly worse trade than showing which variables
 * are set. That property is asserted in `external-mcp-store.test.ts`, not merely intended.
 *
 * Never decrypts, so it cannot fail on a rotated or missing site key — the same property
 * the connector configuration reader and `media/get-providers.ts` rely on.
 * Owner 2026-10-07: safe hints now unseal on the server, without returning secret values. Missing
 * keys still degrade to metadata-only reads; they must not make this settings list unavailable.
 */
export const externalMcpListRoute = defineJsonRoute<Record<string, never>, { servers: ExternalMcpOwnedServer<{ serverId: string }>[] }, ExternalMcpListRouteDeps, ExternalMcpRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/mcp-servers",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeExternalMcp({ authorize });
    const servers = await deps.listServers({ workspaceId: deps.workspaceId });
    return ok({ value: { servers: servers.map((server) => deps.describeOwnership(server)) } });
  },
});
