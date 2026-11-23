import { adaptLegacyAuthorize } from "@jini-ai/core";
import { requireToolPermission } from "@jini-ai/core";
import { ToolInputError, type ToolExecutionOptions, type ToolExecutionContext, type ToolHandler } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";

import { AgentPluginActivationsBusyError, AgentPluginActivationsUnreadableError, AgentPluginUpdateError } from "../lifecycle/index.js";
import { FileLockTimeoutError } from "@jini-ai/core/contracts/runtime";
import {
  AgentPluginChangedSincePreviewError,
  AgentPluginNotFoundError,
  AgentPluginNotUninstallableError,
} from "../lifecycle/index.js";
import type { AgentPluginUninstallPreview } from "@jini-ai/core/contracts/site/agent-plugins-lifecycle";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";

/**
 * @file The Agent Plugin family's half of `plugins_uninstall` (S4, 2026-09-24).
 *
 * Before this file existed, this was its own standalone tool, `agent_plugins_uninstall`
 * (`features/agent-plugins/tool-registrations.ts`). `features/plugin-runtime/tool-registrations.ts`
 * already has `plugins_uninstall` for the OTHER plugin system (the host's own site/runtime plugin package format),
 * and a model choosing between two near-identically-named uninstall tools is the exact confusion
 * `plugins_set_enabled`'s own family merge (2026-09-09) already fixed for enable/disable — uninstall
 * had the identical problem and got the identical fix: ONE tool, a required `family` argument, this
 * module supplying the Agent Plugin branch.
 *
 * `runAgentPluginUninstall` below is everything `plugins_uninstall`'s handler
 * (`plugin-runtime/tool-registrations.ts`) needs to run the Agent Plugin branch: permission check,
 * preview-or-refusal, the confirmation dialog, and the confirmed write. Behavior is UNCHANGED from the
 * deleted standalone tool — same permanent removal, same dialog, same refusals — only the id it is
 * reached through changed. See that file's own header for the full design this mirrors (no
 * cross-workspace "enabled somewhere else" precondition; bundled is refused for permanence, not mere
 * absence).
 *
 * Deliberately does NOT import `agent-plugins/tool-registrations.ts` — that file's own header states
 * "no plugin-runtime -> agent-plugins/tool-registrations edge", and this module is `plugin-runtime`'s
 * new entry point into this family, so it must not create the edge from the other side either.
 *
 * Risk classification: `deletes-durable-state`, same as the deleted standalone tool. See
 * `plugin-runtime/tool-registrations.ts`'s `pluginsDerivedRisk` for where that is now declared for the
 * merged `plugins_uninstall` id — one id, one risk band, covering the worse of the two families' blast
 * radii (site plugins go to the Trash; Agent Plugins do not).
 */

import type { AgentPluginUninstallToolDeps as HostUninstallDeps } from '@jini-ai/core/contracts/headless/plugin-host';

/** The lifecycle request both the preview and the confirmed write take (the host's layout shape). */
export type UninstallAgentPluginRequired = Parameters<UninstallAgentPlugin>[0];
/** The lifecycle owner's confirmed write, as the host binds it. */
export type UninstallAgentPlugin = NonNullable<HostUninstallDeps['uninstallAgentPlugin']>;
/** A not-confirmed approval outcome: declined, expired, or closed because the run ended. */
export type AgentPluginUninstallNotConfirmed = { confirmed: false; reason: 'declined' | 'expired' | 'abandoned' };

/** The model-facing names this branch's notes use. The engine names no product and no host tool of
 *  its own in text a model reads, so the host supplies them. */
export interface AgentPluginUninstallCopy {
  /** The product the model is told about, e.g. "restart <productName>". */
  readonly productName: string;
  /** The host's merged uninstall tool id the model calls again (and the server log names). */
  readonly uninstallToolName: string;
  /** Where an operator disables or deletes an external MCP connection, e.g. "Settings → External MCP". */
  readonly externalMcpSettingsPath: string;
}

/** The host's approval owner, specialised to this branch: it asks the human through `surfaces`,
 *  using the dialog `describe` returns, and returns `declined`'s result when nobody confirms. */
export type AgentPluginUninstallApprovalHandler = (
  required: {
    surfaces: AssistantSurfaceDeps;
    prepare: (required: { ctx: ToolExecutionContext }, optional: ToolExecutionOptions) => Promise<AgentPluginUninstallPreview>;
    describe: (required: { ctx: ToolExecutionContext; prepared: AgentPluginUninstallPreview }) => HumanConfirmSpec | Promise<HumanConfirmSpec>;
    run: (required: { ctx: ToolExecutionContext; prepared: AgentPluginUninstallPreview; choice?: string }, optional: ToolExecutionOptions) => Promise<unknown>;
  },
  optional: { flag?: string; declined?: (required: { reason: AgentPluginUninstallNotConfirmed['reason'] }) => unknown },
) => ToolHandler;

/** What the host binds for this branch: its lifecycle owner, approval owner, dialog and copy. */
export interface AgentPluginUninstallHost {
  readonly previewAgentPluginUninstall: (request: UninstallAgentPluginRequired) => Promise<AgentPluginUninstallPreview>;
  /** The confirmed write used when `uninstallAgentPlugin` on the deps is absent. */
  readonly uninstallAgentPlugin: UninstallAgentPlugin;
  readonly approvalToolHandler: AgentPluginUninstallApprovalHandler;
  readonly notConfirmedResult: (outcome: AgentPluginUninstallNotConfirmed) => { cancelled: boolean; reason?: 'expired' | 'abandoned'; note: string };
  readonly describeApproval: (required: { preview: AgentPluginUninstallPreview }, optional: { locale?: string }) => HumanConfirmSpec;
  readonly copy: AgentPluginUninstallCopy;
}

/** The lifecycle inputs and principal-bound locale resolver this branch consumes. */
export interface AgentPluginUninstallToolDeps extends Pick<HostUninstallDeps, 'agentPluginLayout' | 'authorize' | 'workspaceId' | 'uninstallAgentPlugin'> {
  readonly preferences: { locale(input: { workspaceId: string; principalId: string }, options?: Record<string, never>): Promise<string> };
  /** The host's lifecycle owner, approval owner, dialog and model-facing copy. */
  readonly uninstallHost: AgentPluginUninstallHost;
}

/**
 * Re-classifies `uninstallAgentPlugin`'s own domain errors into `ToolInputError` on their way to the
 * model, and passes every other rejection through untouched.
 *
 * Same reasoning as `features/post/tool-registrations.ts`'s `toModelFacingUpdateError`: an unknown
 * `pluginId` and a bundled-plugin refusal are both exactly "the CALLER's input was the problem, and a
 * different input (a real installed id; a different tool call to disable instead) resolves it" — the
 * honest classification, not a trick to defeat `@jini-ai/daemon`'s redaction. Neither message carries
 * anything beyond the plugin id the caller already sent and, for the bundled case, the name of the
 * tool to call instead — nothing internal leaks.
 */
function toModelFacingUninstallError({ error }: { error: unknown }, _optional: Record<string, never> = {}): unknown {
  if (error instanceof AgentPluginNotFoundError || error instanceof AgentPluginNotUninstallableError) {
    return new ToolInputError({ message: error.message });
  }
  return error;
}

/** An interrupted update of this plugin is still waiting for boot recovery (`PLUGIN_UPDATE_PENDING`),
 *  or its recovery record is unreadable: removing it now would let recovery resurrect the old revision.
 *  Nothing was removed, so this is the same ADR-055 Decision 6 result as the refusals below.
 *  @complexity O(1). */
function updateJournalRefusedResult(required: { pluginId: string; error: AgentPluginUpdateError; copy: AgentPluginUninstallCopy }, _optional: Record<string, never> = {}): unknown {
  const { pluginId, error, copy } = required;
  return {
    uninstalled: false,
    cancelled: false,
    pluginId,
    restartRequired: false,
    reason: "update-pending",
    code: error.code,
    note: `Nothing was removed: an interrupted update of '${pluginId}' is still waiting to be recovered, so it was NOT ` +
      `uninstalled. ${updateJournalNextStep({ error, copy })}`,
  };
}

/** Only a pending update recovers at start. Any other journal refusal (an unreadable record, an
 *  unsafe recorded path) survives a restart, so telling the user to restart would loop them.
 *  @complexity O(1). */
function updateJournalNextStep({ error, copy }: { error: AgentPluginUpdateError; copy: AgentPluginUninstallCopy }, _optional: Record<string, never> = {}): string {
  return error.code === "PLUGIN_UPDATE_PENDING"
    ? `Tell the user to restart ${copy.productName} (recovery runs at start) and then try again.`
    : `Its update recovery record needs manual repair (${error.code}); restarting ${copy.productName} will not fix it. Tell the user an operator has to repair it first.`;
}

/**
 * The model-facing outcome of an `uninstall.ts` rejection: a RESULT when this workspace's activation record could
 * not be read, or could not be locked, otherwise `toModelFacingUninstallError`'s classification, thrown.
 *
 * An unreadable or busy activations.json is not the caller's input and not an internal bug the model should see
 * redacted (t91 §7.1/R2): nothing was removed, and there is a concrete next step, so this is the ADR-055 Decision 6
 * not-removed result `plugins_set_enabled`'s `activationsUnreadableResult`/`activationsBusyResult` already return
 * for the sibling family. The error's message names the host path (and, for Busy, the lock file), so it goes to the
 * server log only; `note` is fixed, path-free text.
 *
 * @throws The re-classified error for every other rejection.
 * @complexity O(1).
 */
function uninstallRefusedResult({ pluginId, error, copy }: { pluginId: string; error: unknown; copy: AgentPluginUninstallCopy }, _optional: Record<string, never> = {}): unknown {
  if (error instanceof AgentPluginUpdateError) return updateJournalRefusedResult({ pluginId, error, copy });
  if (error instanceof AgentPluginActivationsBusyError) {
    console.warn(`[agent-plugins] '${pluginId}': ${copy.uninstallToolName} (family agent-plugin) refused — ${error.message}`);
    return {
      uninstalled: false,
      cancelled: false,
      pluginId,
      restartRequired: false,
      reason: "activations-busy",
      note:
        `Nothing was removed: another ${copy.productName} process was writing this workspace's Agent Plugin activation record at the ` +
        `same moment, so '${pluginId}' was NOT uninstalled. Tell the user nothing was changed and to try again in a ` +
        "moment; if it keeps happening, the server log names the lock file.",
    };
  }
  if (error instanceof FileLockTimeoutError) {
    // Layout B (2026-10-04) added a second lock in front of the activations one: the per-plugin state
    // lock (`staging/.plugin-state-<id>.lock`) every install/update/uninstall/memory write of this
    // plugin takes. A timeout means the lock was never acquired, so the uninstall body never ran — or,
    // for an inner lock, `uninstall.ts` already put every staged tree back (a failed put-back throws a
    // different error). Same ADR-055 Decision 6 not-removed RESULT as a busy activations record; the
    // message names the lock path, so it goes to the server log only.
    console.warn(`[agent-plugins] '${pluginId}': ${copy.uninstallToolName} (family agent-plugin) refused — ${error.message}`);
    return {
      uninstalled: false,
      cancelled: false,
      pluginId,
      restartRequired: false,
      reason: "plugin-busy",
      note:
        `Nothing was removed: another ${copy.productName} process was installing, updating or writing memory for '${pluginId}' at the ` +
        "same moment, so it was NOT uninstalled. Tell the user nothing was changed and to try again in a moment; if it " +
        "keeps happening, the server log names the lock file.",
    };
  }
  if (!(error instanceof AgentPluginActivationsUnreadableError)) throw toModelFacingUninstallError({ error });
  console.warn(`[agent-plugins] '${pluginId}': ${copy.uninstallToolName} (family agent-plugin) refused — ${error.message}`);
  return {
    uninstalled: false,
    cancelled: false,
    pluginId,
    restartRequired: false,
    reason: "activations-unreadable",
    note:
      `Nothing was removed: this workspace's Agent Plugin activation record could not be read, so whether '${pluginId}' is ` +
      `bundled with ${copy.productName} cannot be established and it was NOT uninstalled. Tell the user an operator has to repair ` +
      "activations.json first (the server log names the file and the fault); until then every Agent Plugin tool call in " +
      "this workspace is refused.",
  };
}

/** The preview a dialog may show, or the not-removed result to return instead of raising one.
 *  @complexity O(1) beyond `previewAgentPluginUninstall`. */
async function previewOrRefusal(
  request: UninstallAgentPluginRequired,
  { preview, copy }: { preview: AgentPluginUninstallHost['previewAgentPluginUninstall']; copy: AgentPluginUninstallCopy },
): Promise<{ readonly preview: AgentPluginUninstallPreview } | { readonly refusal: unknown }> {
  try {
    return { preview: await preview(request) };
  } catch (error) {
    return { refusal: uninstallRefusedResult({ pluginId: request.pluginId, error, copy }) };
  }
}

// Fails closed when no interactive transport exists: removing bytes and merely mentioning
// that we could not ask would make consent decorative. The shared owner closes cards on abort;
// a cancelled run must not leave a dialog holding a call nobody is listening to.
// The exchange uses the host's merged uninstall id, the ONE id both families redeem through, not a family
// specific id. ADR-055 Decision 6: a no-answer is a RESULT, not an exception — nothing was
// removed either way, and the model is still alive to say so.

/**
 * The post-confirmation half: uninstalls exactly what the human was shown. If the installed archives changed while
 * the dialog was open, that is a not-removed RESULT — the same union member `expired`/`abandoned` use — not a
 * `ToolInputError`: the caller's input was fine, what is installed moved. Every other refusal goes through
 * `uninstallRefusedResult`, like the preview's.
 * @complexity O(1) beyond `uninstallAgentPlugin`.
 */
async function uninstallConfirmedAgentPlugin(
  { request, preview, copy }: { request: UninstallAgentPluginRequired; preview: AgentPluginUninstallPreview; copy: AgentPluginUninstallCopy },
  { deleteMemory = false, uninstall }: { deleteMemory?: boolean; uninstall: UninstallAgentPlugin },
): Promise<unknown> {
  try {
    const result = await uninstall(request, { confirmedPreview: preview, deleteMemory });
    return {
      uninstalled: true,
      cancelled: false,
      pluginId: result.pluginId,
      removedDigests: result.removedDigests,
      restartRequired: true,
      note:
        "Uninstalled. Its files and activation record are gone, new runs no longer load it, and its own agent_plugin_<id> " +
        "tool stops running immediately — every call is refused from now on, with no restart needed. That tool does stay " +
        `LISTED in this already-running daemon until ${copy.productName} restarts, so tell the user it may still appear in tool listings ` +
        "until then, and that calling it will simply be denied. Uninstalling does NOT remove any external MCP server " +
        "connection the plugin set up: if an operator turned one on, its mcp__<server>__* tools keep working until that " +
        `connection is disabled or deleted under ${copy.externalMcpSettingsPath}.`,
    };
  } catch (error) {
    if (error instanceof AgentPluginChangedSincePreviewError) {
      return {
        uninstalled: false,
        cancelled: false,
        pluginId: request.pluginId,
        restartRequired: false,
        reason: "changed-since-confirmation",
        note:
          `'${request.pluginId}' changed after the user was asked: the installed archives are no longer the ones the confirmation showed. ` +
          `Nothing was removed. Call ${copy.uninstallToolName} again with family 'agent-plugin' so the user can review and confirm what is installed now.`,
      };
    }
    return uninstallRefusedResult({ pluginId: request.pluginId, error, copy });
  }
}

/**
 * Runs the Agent Plugin branch of `plugins_uninstall` end to end: permission, preview-or-refusal,
 * confirm, write. `plugin-runtime/tool-registrations.ts`'s handler calls this directly when
 * `family === "agent-plugin"` — see this file's header for why the permission check lives here rather
 * than being hoisted above the family branch (unlike `plugins_set_enabled`'s single pre-branch check):
 * this mirrors the deleted standalone tool's own order exactly, permission then preview then confirm
 * then write, with nothing shared between the two families' checks to hoist.
 *
 * Order is load-bearing, same as the site-runtime branch: parse -> authorize -> preview (so an unknown
 * or bundled id, or an unreadable/busy activations.json, is refused or returned as a not-removed
 * result before any human is asked anything) -> confirm -> re-check and write only if the plugin is
 * still what the dialog showed (t91 F2.2).
 *
 * @complexity O(1) beyond `previewAgentPluginUninstall`/`uninstallAgentPlugin`.
 */
export async function runAgentPluginUninstall(
  { routeDeps, surfaces, ctx, pluginId }: {
    routeDeps: AgentPluginUninstallToolDeps;
    surfaces: AssistantSurfaceDeps;
    ctx: ToolExecutionContext;
    pluginId: string;
  },
  optional: ToolExecutionOptions = {},
): Promise<unknown> {
  ctx = { ...ctx, input: structuredClone(ctx.input), principal: { ...ctx.principal }, run: { ...ctx.run } };
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: "admin.plugins.enable" }, { entityType: "agent-plugin", entityId: pluginId });

  const request = { layout: routeDeps.agentPluginLayout, workspaceId: routeDeps.workspaceId, pluginId };
  const host = routeDeps.uninstallHost;
  const previewed = await previewOrRefusal(request, { preview: host.previewAgentPluginUninstall, copy: host.copy });
  if ("refusal" in previewed) return previewed.refusal;

  const locale = await routeDeps.preferences.locale({ workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id });
  return host.approvalToolHandler({ surfaces,
    prepare: async () => previewed.preview,
    describe: ({ prepared }) => host.describeApproval({ preview: prepared }, { locale }),
    run: async ({ ctx: approvedCtx, prepared, choice }) => {
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: approvedCtx.principal.id, permission: "admin.plugins.enable" }, { entityType: "agent-plugin", entityId: pluginId });
      if (approvedCtx.signal.aborted) return { uninstalled: false, ...host.notConfirmedResult({ confirmed: false, reason: "abandoned" }) };
      return uninstallConfirmedAgentPlugin({ request, preview: prepared, copy: host.copy }, { deleteMemory: choice === "delete-memory", uninstall: routeDeps.uninstallAgentPlugin ?? host.uninstallAgentPlugin });
    },
  }, { flag: "uninstalled", declined: ({ reason }) => ({ uninstalled: false, pluginId, restartRequired: false, ...host.notConfirmedResult({ confirmed: false, reason }) }) })(ctx, optional);
}
