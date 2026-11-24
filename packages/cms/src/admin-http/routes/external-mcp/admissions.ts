import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { ExternalMcpAdmissionsEnvelope } from "@jini-ai/core/contracts/site/cms-external-mcp";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { authorizeExternalMcp, type ExternalMcpRoutePrincipal } from "./shared.js";

/** The server-owned federation's admissions report, or the reader's own unavailable body. */
export type ExternalMcpAdmissionsResult =
  | { ok: false; body: unknown }
  | { ok: true; connections: unknown; configFailures?: unknown };

/** The deps this route reads: the host's admissions reader (it owns the fallback when none is wired). */
export interface ExternalMcpAdmissionsRouteDeps {
  workspaceId: string;
  readAdmissions: () => Promise<ExternalMcpAdmissionsResult>;
}

/**
 * Reports the server-owned federation's live admissions after the workspace/permission gate.
 * A missing or still-connecting reader answers a distinguishable 503, never an empty roster:
 * an empty list means no tools were admitted, whereas an unavailable report cannot say that.
 * The legacy failure code remains until the admin client's unavailable-state contract migrates.
 * @complexity O(1) dispatch plus the server reader's bounded federation wait.
 */
export const externalMcpAdmissionsRoute = defineJsonRoute<Record<string, never>, ExternalMcpAdmissionsEnvelope, ExternalMcpAdmissionsRouteDeps, ExternalMcpRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/mcp-servers/admissions",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeExternalMcp({ authorize });
    const result = await deps.readAdmissions();
    // The reader's own body, verbatim: its copy and code are the admin client's unavailable contract.
    if (!result.ok) throw new RouteRefusalError({ status: 503, body: result.body });
    return ok({
      value: result.configFailures !== undefined ? { connections: result.connections, configFailures: result.configFailures } : { connections: result.connections },
    });
  },
});
