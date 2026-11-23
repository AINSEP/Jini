import { ToolInputError } from "@jini-ai/core";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { SaveExternalMcpServerInput } from "@jini-ai/core/contracts/hosted-mcp";
import { RecordVersionConflictError, versionConflictBody } from "@jini-ai/core/optimistic-concurrency";

import { parseExternalMcpPutBody } from "./put-body.js";
import {
  authorizeExternalMcp, externalMcpActorId, externalMcpParam, invalidServerMapping, rejectExternalMcpError, secretStoreMapping,
  type ExternalMcpCodedError, type ExternalMcpDescribeOwnershipFn, type ExternalMcpErrorMapping, type ExternalMcpFieldError,
  type ExternalMcpOwnedServer, type ExternalMcpRoutePrincipal, type ExternalMcpServerSummary,
} from "./shared.js";

/** Host collaborator: validates, seals and stores one row (the host's store owns the secret sealer). */
export type ExternalMcpSaveServerFn = (input: SaveExternalMcpServerInput & { principalId: string }) => Promise<ExternalMcpServerSummary>;

/** Host collaborator: the federation hot-reload trigger; `lowered` names connections whose access drops now. */
export type ExternalMcpRosterChangedFn = (optional?: { lowered: { serverIds: string[] } }) => Promise<unknown>;

/** The deps this route reads: the host's save + roster trigger, the ownership tagger and its error classifiers. */
export interface ExternalMcpPutRouteDeps {
  workspaceId: string;
  saveServer: ExternalMcpSaveServerFn;
  notifyRosterChanged: ExternalMcpRosterChangedFn;
  describeOwnership: ExternalMcpDescribeOwnershipFn;
  isToolAccessLoweringError: (err: unknown) => err is ExternalMcpCodedError;
  isValidationError: (err: unknown) => err is ExternalMcpFieldError;
  isSecretStoreUnconfiguredError: (err: unknown) => err is { message: string };
}

/**
 * Maps a failed save onto its HTTP answer: 409 for a stale `expectedVersion` (the shared conflict
 * body), 400 for a malformed one or an invalid field, 503 for a roster change that lowers tool
 * access or a missing secret store, 500 for anything else (rethrown to the host's failure port).
 * @complexity O(1).
 */
function putErrorMappings(deps: ExternalMcpPutRouteDeps): readonly ExternalMcpErrorMapping[] {
  return [
    { matches: deps.isToolAccessLoweringError, status: () => 503, body: (err) => ({ error: (err as ExternalMcpCodedError).message, code: (err as ExternalMcpCodedError).code }) },
    { matches: (err) => err instanceof RecordVersionConflictError, status: () => 409, body: (err) => versionConflictBody({ error: err as RecordVersionConflictError }) },
    { matches: (err) => err instanceof ToolInputError, status: () => 400, body: (err) => ({ error: (err as ToolInputError).message, code: "VALIDATION_ERROR" }) },
    invalidServerMapping(deps.isValidationError),
    secretStoreMapping(deps.isSecretStoreUnconfiguredError),
  ];
}

/**
 * PUT one external MCP server — creates it, or replaces the stored row for an existing id.
 *
 * Idempotent-by-id rather than POST-creates/PATCH-updates, because the admin tab's add form and its
 * expand-to-edit card are the same shape submitting the same fields; two routes would be two
 * validators of one contract.
 *
 * `env` is the one field with three distinct meanings, and the route preserves all three rather
 * than collapsing them: ABSENT keeps whatever credentials are stored (what an enable/disable toggle
 * sends, since the UI never received the values to send back), a STRING replaces them, and an EMPTY
 * string clears them. Collapsing absent into empty is how a toggle would silently wipe a token.
 *
 * A saved row does NOT necessarily take effect until the agent daemon restarts — the admitted tool
 * set for any ONE connection is still frozen at connect (`Jini packages/mcp/src/federation/trust.ts` R5) and this route
 * does not, and cannot, change that: editing an already-admitted connection's allowlist, credentials,
 * or transport here still needs a real restart, because that connection's one-time admission already
 * happened. `restartRequired: true` in the response reflects exactly that — it is conservative by
 * design, not stale: it stays true even for a brand-new row, because whether the SECONDARY hot-reload
 * trigger below actually admitted it depends on facts this route does not read back (daemon
 * reachability, whether the connection is `authMode: "oauth"` and therefore not yet authorized).
 *
 * That said, `restartRequired: true` no longer means "does nothing until restart": turning a
 * connection off stops affected answers immediately; removing a tool or its write permission takes effect on the next tool call.
 * Adding tools, or changing the server's address, command or sign-in method, needs a restart; until
 * then that connection's tools refuse. This is `external-mcp-revocation.ts`'s per-call gate, not this
 * route — the response value itself is unchanged (see that file's header for why).
 *
 * Federation hot-reload trigger (2026-09-11), fired unconditionally after every successful save,
 * best effort for enabled connections (OFF awaits Stop/cleanup): the daemon-side coordinator
 * (`Jini packages/mcp/src/federation/reload.ts`) is what actually decides whether anything changed — a save that only
 * edited fields on an ALREADY-admitted connection is a genuine no-op there (R5, restated above), and
 * a fresh `authMode: "oauth"` row is a no-op too until its own callback later completes and fires
 * the PRIMARY trigger (`public-http/routes/external-mcp/oauth-callback.ts`). The one case this
 * actually helps is a brand-new, immediately-usable connection (`static_env`/no-OAuth transport) —
 * exactly the "operator save/approve" trigger the feature's own spec calls out as the SECONDARY path,
 * next to a completed OAuth sign-in as the primary one.
 */
export const externalMcpPutRoute = defineJsonRoute<{ serverId: string; body: unknown }, { server: ExternalMcpOwnedServer; restartRequired: true }, ExternalMcpPutRouteDeps, ExternalMcpRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/mcp-servers/:serverId",
  parse: (raw) => ok({ value: { serverId: externalMcpParam(raw.params, "serverId"), body: raw.body } }),
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeExternalMcp({ authorize });
    // The gate above already authorized this same principal — used ONLY to attribute a change to
    // `writeAllowedToolNames` if this save makes one.
    const principalId = externalMcpActorId({ context });
    try {
      const server = await deps.saveServer({ workspaceId: deps.workspaceId, serverId: input.serverId, principalId, ...parseExternalMcpPutBody({ rawBody: input.body }) });
      // Ordinary discovery is best effort. OFF awaits Stop/cleanup before reporting success.
      if (server.enabled) void deps.notifyRosterChanged();
      else await deps.notifyRosterChanged({ lowered: { serverIds: [server.serverId] } });
      return ok({ value: { server: deps.describeOwnership(server), restartRequired: true } });
    } catch (err) {
      return rejectExternalMcpError({ err, mappings: putErrorMappings(deps) });
    }
  },
});
