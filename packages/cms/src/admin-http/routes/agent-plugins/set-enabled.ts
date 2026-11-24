import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { AdminAgentPluginSetEnabledEnvelope } from "@jini-ai/core/contracts/site/cms-agent-plugins";

import { agentPluginLifecycleFields, type AgentPluginRowCandidate } from "../../http/agent-plugins.js";
import {
  agentPluginActorId, authorizeAgentPlugins, pluginIdParam, rejectSetEnabledError,
  type AgentPluginCandidatesLoader, type AgentPluginRoutePrincipal, type AgentPluginSetEnabledCopy, type AgentPluginSetEnabledErrorPredicates,
} from "./shared.js";

/** The host's shared lifecycle owner: verifies the id is installed here, then writes the activation record. */
export type SetAgentPluginEnabledFn = (required: { pluginId: string; enabled: boolean; actor: string }) => Promise<{ readonly enabled: boolean; readonly warnings?: readonly string[] | undefined }>;

/** The deps this route reads. Every host collaborator is injected and bound by the registrar. */
export interface AgentPluginSetEnabledRouteDeps {
  workspaceId: string;
  loadCandidates: AgentPluginCandidatesLoader;
  setEnabled: SetAgentPluginEnabledFn;
  /** Best-effort provisioning of the plugin's auto-admitted MCP servers; the host logs, never throws. */
  provisionMcpServers: (required: { pluginId: string; principalId: string }) => Promise<void>;
  /** Announces that `pluginId`'s tools were lowered (the host's roster-reload port). */
  notifyPluginLowered: (required: { pluginId: string }) => Promise<void>;
  isError: AgentPluginSetEnabledErrorPredicates;
  copy: AgentPluginSetEnabledCopy;
  /** Server-side log line for a refusal whose real cause stays out of the response. */
  warn: (message: string) => void;
}

/** The PATCH input: the path id and the validated switch. */
export interface AgentPluginSetEnabledInput { pluginId: string; enabled: boolean }

/**
 * `AGENT_PLUGIN_SET_ENABLED` — `PATCH /api/admin/v1/workspaces/:workspaceId/agent-plugins/:pluginId`
 * (2026-09-09). The Agent Plugins screen's enable/disable toggle, and the FIRST production write
 * path for `setAgentPluginActivation()` — before this route, that writer's only caller was
 * `recordBundledAgentPluginIfAbsent`'s boot-time seed, so an operator had no way to turn a bundled
 * plugin on from the admin at all.
 *
 * This is a real gate, not a cosmetic flag. `resolveAgentPluginRefs`
 * (`Jini packages/agent-plugins/src/lifecycle/resolve-agent-plugin-refs.ts`) re-reads `activations.json` on EVERY run
 * and refuses a run that pins a disabled plugin, and `tool-registrations.ts` filters the dynamic
 * per-plugin tools through the same record.
 *
 * DISABLING is therefore complete without a restart, including for a plugin whose tool is already
 * registered in the running agent daemon: that tool's own `ToolPolicy` re-reads this record before
 * every call (`features/agent-plugins/tool-registrations.ts`, REVOCATION — added 2026-09-16 for sol
 * finding 5-1, which found the tool still answering after an operator switched the plugin off).
 * ENABLING is not symmetric and this header should not be read as claiming it is: a plugin that was
 * disabled when the daemon booted has no registration at all, and `@jini-ai/core`'s `ToolRegistry`
 * is append-only, so its tool appears only after a restart. `plugins_set_enabled`'s `restartNoteFor`
 * (`features/plugin-runtime/tool-registrations.ts`) reports exactly that asymmetry to the model.
 *
 * ---------------------------------------------------------------------------
 * Why this does NOT go through `executeCommand`, unlike `routes/plugins/set-enabled.ts`
 * ---------------------------------------------------------------------------
 * The site/runtime plugin family's identical operation is `executeCommand`-wrapped because its
 * activation is a database row with a `PluginActivationRecord` repo, a `plugin-activation` entity
 * type, and therefore a meaningful change-set/outbox/rollback story. An Agent Plugin activation is
 * one small JSON file written atomically (write-temp-then-`rename`, see
 * `activation.ts`'s `writeActivationsAtomically`) with no repo, no entity type, and no inverse to
 * capture beyond the prior boolean that the file itself already holds. Threading `clock`/`idGen`/
 * `changeSets`/`outbox` into `AgentPluginsRouteDeps` and minting an entity type for it would be
 * ceremony around a single-field file write.
 *
 * The consequence is stated rather than hidden: this mutation does NOT appear in the change-set
 * history and is NOT undoable through the admin's revert surface. `activations.json` records
 * `updatedAt`/`updatedBy` per plugin (the actor is this request's authenticated principal), which is
 * the audit trail this write actually has. Authorization is NOT weakened — `admin.plugins.enable`
 * is checked here explicitly via `authorizeOrRespond`, the same permission the other family's
 * gateway checks, and the same helper `list.ts` uses one door over for `admin.plugins.read`.
 *
 * ---------------------------------------------------------------------------
 * Divergence from `routes/plugins/set-enabled.ts`: `enabled` is validated, not coerced
 * ---------------------------------------------------------------------------
 * That route reads `Boolean(req.body?.enabled)`, so a request that omits the field, or sends
 * `"false"`, silently means "disable". For a toggle whose off-state refuses assistant runs, a
 * malformed body must be an error rather than a guess, so a non-boolean `enabled` is 400
 * `VALIDATION_ERROR` here.
 *
 * SECURITY: `:pluginId` never reaches the filesystem unchecked. The id must match an ACTUALLY
 * INSTALLED plugin in this workspace (`loadAgentPluginSearchCandidates`, the same read model
 * `list.ts` serves) before any write is attempted, and `setAgentPluginActivation` independently
 * re-asserts the Agent Plugins name grammar. No absolute host path reaches the response — the
 * response body is re-shaped from that same loader's fields, exactly as `list.ts` does.
 *
 * ---------------------------------------------------------------------------
 * 2026-09-09: the write composition moved out, and is now shared
 * ---------------------------------------------------------------------------
 * The "verify the id is installed here, then write the activation record" pair that used to sit
 * inline in the handler below is now `features/agent-plugins/set-enabled.ts`'s `setAgentPluginEnabled`,
 * because it acquired a SECOND caller: `plugins_set_enabled`'s Agent Plugin branch
 * (`features/plugin-runtime/tool-registrations.ts`), the assistant's own enable/disable tool. Two
 * copies of that precondition would be two places that each decide what "installed" means, and the
 * failure mode of them drifting is an activation recorded for a plugin the admin screen says is not
 * there. What stayed here is genuinely this route's own: the read model it answers with, and the
 * HTTP status mapping.
 *
 * ---------------------------------------------------------------------------
 * 2026-09-10: enabling this plugin also PROVISIONS its auto-admitted MCP servers
 * ---------------------------------------------------------------------------
 * On a successful ENABLE only, this handler calls `features/agent-plugins/federate-mcp.ts`'s
 * `provisionAgentPluginMcpServers` to create (if absent) a disabled row in the SAME external-MCP
 * store Settings → External MCP already owns, for every remote MCP server this plugin declares that
 * `classifyAgentPluginMcpServerTrust` auto-admits — see that module's own header for the full
 * argument, its three collision rules (never clobber an existing row, seed disabled, provisioning is
 * not authorization), and why a `stdio` server never reaches this path at all.
 *
 * Disabling the plugin does NOT call this at all — there is nothing to provision on a disable, and
 * `federate-mcp.ts`'s own header states explicitly that a provisioned row survives a disable (or an
 * uninstall) rather than being deactivated or deleted by this route.
 *
 * Deliberately best-effort: a provisioning failure is logged, never thrown back to the client. The
 * plugin's own activation state (the thing this route is actually named for) must not fail because
 * one MCP row could not be written — the same fail-open posture `agent-daemon-server.ts`'s own
 * `resolveStoredExternalMcpConnections` takes for the identical store at boot. `plugins_set_enabled`
 * (`features/plugin-runtime/tool-registrations.ts`, the assistant's own in-chat equivalent of this
 * toggle) now calls the same two primitives (`resolveAgentPluginMcpServers` +
 * `provisionAgentPluginMcpServers`) on enable, so both inbound adapters of the same logical enable
 * have identical side effects. The provisioning step and its logging are mirrored, not shared,
 * because a `features/**` module may not import this server route; that tool's deps bag carries the
 * same `externalMcpServerRepo`/`siteAssistantSecretSealer`/`siteAssistantSecretKeyring` slice this
 * route threads through `AgentPluginsRouteDeps`.
 *
 * A provisioned row is created DISABLED and needs an assistant restart on top of that once an
 * operator enables and authorizes it (`external-mcp/put.ts`'s own doc states the same restart rule
 * for an operator-typed row) — federation config is read once at boot.
 */
export const agentPluginSetEnabledRoute = defineJsonRoute<AgentPluginSetEnabledInput, AdminAgentPluginSetEnabledEnvelope, AgentPluginSetEnabledRouteDeps, AgentPluginRoutePrincipal>({
  method: "patch",
  path: "/api/admin/v1/workspaces/:workspaceId/agent-plugins/:pluginId",
  // `enabled` must be a real boolean, not a coerced one — see "`enabled` is validated, not coerced"
  // above. Refused in `parse`, so the 400 still precedes authorization.
  parse: (raw) => {
    const enabled = (raw.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== "boolean") rejectRoute({ status: 400, error: "'enabled' must be a boolean", code: "VALIDATION_ERROR" });
    return ok({ value: { pluginId: pluginIdParam({ params: raw.params }), enabled } });
  },
  handle: async ({ input, deps, context, authorize }) => {
    const { pluginId, enabled } = input;
    await authorizeAgentPlugins({ authorize, permission: "admin.plugins.enable" }, { entityId: pluginId });
    const actor = agentPluginActorId({ context });
    try {
      const candidate = (await deps.loadCandidates()).find((entry) => entry.pluginId === pluginId);
      if (candidate === undefined) rejectRoute({ status: 404, error: `agent plugin '${pluginId}' is not installed in this workspace`, code: "AGENT_PLUGIN_NOT_FOUND" });

      const written = await deps.setEnabled({ pluginId, enabled, actor });

      // Provisioning only ever runs on enable — disabling has nothing to provision, and a
      // previously-provisioned row survives a disable untouched (`federate-mcp.ts`'s own header).
      if (written.enabled) {
        await deps.provisionMcpServers({ pluginId, principalId: actor });
      } else {
        // Keep the durable OFF switch effective in discovery too; surviving OAuth rows keep
        // their credentials, while the existing reload withdraws their tools and guidance.
        await deps.notifyPluginLowered({ pluginId });
      }

      return ok({ value: updatedRow({ candidate, enabled: written.enabled }, { warnings: written.warnings }) });
    } catch (error) {
      return rejectSetEnabledError({ error, pluginId, isError: deps.isError, warn: deps.warn, copy: deps.copy });
    }
  },
});

/** The `list.ts` row shape, for one plugin, so the client can replace a row in place rather than
 *  re-fetching the whole list after a toggle. `enabled` comes from the record just written, not
 *  from the pre-write read. @complexity O(1). */
function updatedRow(
  { candidate, enabled }: { candidate: AgentPluginRowCandidate; enabled: boolean },
  { warnings = [] }: { warnings?: readonly string[] | undefined } = {},
): AdminAgentPluginSetEnabledEnvelope {
  return {
    warnings,
    agentPlugin: {
      pluginId: candidate.pluginId,
      id: candidate.id,
      provides: candidate.provides,
      displayName: candidate.displayName ?? null,
      summary: candidate.summary ?? null,
      version: candidate.version ?? null,
      description: candidate.description ?? null,
      keywords: candidate.keywords,
      enabled,
      ...agentPluginLifecycleFields({ candidate }),
      skills: candidate.skills,
      mcpServerIds: candidate.mcpServerIds,
    },
  };
}
