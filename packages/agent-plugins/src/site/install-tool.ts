import { createAgentPluginUpdateEffects, requireUpdateMcpDeps, type UpdateMcpDeps } from "./update-effects.js";
import { AgentPluginUpdateError, AgentPluginHostIncompatibleError, isAgentPluginName, type UpdateAgentPluginRequired } from "@jini-ai/agent-plugins/lifecycle";
import { adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, requireString, ToolInputError, type AgentToolDefinition, type DerivedRiskByToolId, type ToolRegistration, type ToolExecutionContext } from "@jini-ai/core";
import { FolderZipError } from "@jini-ai/agent-plugins/folder-zip";
import type { zipLocalFolder } from "@jini-ai/agent-plugins/folder-zip/node";
import type { ToolContributor } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { InstallAttachmentReader, PluginInstallSourcePort } from "@jini-ai/core/contracts/headless/plugin-install-source";
import { AgentPluginInstallError, type createAgentPluginLifecycle } from "../lifecycle/index.js";
import { AgentPluginUploadError, UPLOADED_AGENT_PLUGIN_TRUST_WARNING, previewUploadedAgentPlugin, installUploadedAgentPlugin, type InstallUploadedAgentPluginOptional } from "./install-upload.js";
import type { AgentPluginLayout } from "@jini-ai/core/contracts/headless/plugin-host";
import type { listBundledAgentPluginServers } from "../connect/new-site-agent-plugin-tokens.js";
const CUSTOMIZE_AGENT_PLUGIN_TOOL = 'agent_plugins_customize';
import type { prepareCustomizedAgentPluginArchive } from './customize-tool.js';

/** The assistant uses the same uploaded-package service as the Agent Plugins admin add tab.
 * Customization prepares a new package and enters this same install flow, without replacement.
 * No opt-in for this family: only bundled digests may run code. Preview verifies the full archive,
 * install verifies the pinned bytes again, and every fresh/replacement install remains disabled. */
export type AgentPluginsInstallToolDeps = {
  readonly pluginInstallSource: PluginInstallSourcePort;
  readonly snapshotAgentPluginSettings?: UpdateAgentPluginRequired["snapshotSettings"];
  readonly pluginHost?: import("@jini-ai/core/contracts/headless/plugin-host").PluginHostPort;
  readonly workspaceId: string;
  readonly authorize: AuthorizeFn;
  readonly readInstallAttachment?: InstallAttachmentReader;
  readonly agentPluginLayout: AgentPluginLayout;
  readonly bundledAgentPluginsSourceRoot: string;
  readonly catalog: readonly AgentToolDefinition[];
  readonly catalogModule: string;
  readonly toolMetadata: Parameters<typeof buildDomainRegistrations>[0]['metadata'];
  readonly installPermission: string;
  readonly zipLocalFolder: typeof zipLocalFolder;
  readonly maxAgentPluginInstallArchiveBytes: () => number;
  readonly listInstalledPlugins: ReturnType<typeof createAgentPluginLifecycle>['listInstalledPlugins'];
  readonly seedBundledAgentPlugins: ReturnType<typeof createAgentPluginLifecycle>['seedBundledAgentPlugins'];
  readonly listBundledAgentPluginServers: (input: { bundledSourceRoot: string }) => ReturnType<typeof listBundledAgentPluginServers>;
  readonly agentPluginActivations: Pick<InstallUploadedAgentPluginOptional['lifecycle'], 'resolveAgentPluginActivation' | 'isAgentPluginRecordedAsBundled'>;
  readonly uploadOptions: InstallUploadedAgentPluginOptional;
  readonly resolveServers: Parameters<typeof createAgentPluginUpdateEffects>[0]['resolveServers'];
  readonly provisionServers: Parameters<typeof createAgentPluginUpdateEffects>[0]['provisionServers'];
  readonly prepareCustomizedAgentPluginArchive: (input: { deps: AgentPluginsInstallToolDeps; ctx: ToolExecutionContext }) => ReturnType<typeof prepareCustomizedAgentPluginArchive>;
} & Partial<UpdateMcpDeps>;

export const AGENT_PLUGINS_UPDATE_TOOL_ID = "agent_plugins_update";
export const AGENT_PLUGINS_INSTALL_TOOL_ID = "agent_plugins_install";
export const derivedRisk: DerivedRiskByToolId = new Map([[AGENT_PLUGINS_INSTALL_TOOL_ID, "mutates-durable-state"], [AGENT_PLUGINS_UPDATE_TOOL_ID, "mutates-durable-state"], [CUSTOMIZE_AGENT_PLUGIN_TOOL, "mutates-durable-state"]]);

export function buildRegistrations(deps: AgentPluginsInstallToolDeps, _optional: Record<string, never> = {}): ToolRegistration[] {
  return buildDomainRegistrations({ ...(deps.toolMetadata === undefined ? {} : { metadata: deps.toolMetadata }), domain: "agent-plugins-install", catalogModule: deps.catalogModule, catalog: indexCatalogById({ catalog: deps.catalog }), derivedRisk,
    handlers: {
      [AGENT_PLUGINS_INSTALL_TOOL_ID]: ctx => runInstallTool({ deps, ctx, operation: "install" }),
      [AGENT_PLUGINS_UPDATE_TOOL_ID]: ctx => runInstallTool({ deps, ctx, operation: "update" }),
      [CUSTOMIZE_AGENT_PLUGIN_TOOL]: ctx => runInstallTool({ deps, ctx, operation: 'customize' }),
    },
  });
}

/** Gate all three entry points before any source read or package publication. */
async function runInstallTool({ deps, ctx, operation }: { deps: AgentPluginsInstallToolDeps; ctx: ToolExecutionContext; operation: "install" | "update" | 'customize' }, _optional = {}) {
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: deps.installPermission }, { entityType: "plugin" });
  const input = requireInputRecord({ input: ctx.input });
  if (operation === 'customize') return installArchivePlugin({ deps, ctx }, { archive: await deps.prepareCustomizedAgentPluginArchive({ deps, ctx }) });
  if (operation === "update") return updateArchivePlugin({ deps, ctx, update: readUpdateTarget({ input }) });
  const source = input.source as Record<string, unknown> | undefined;
  if (source?.kind === "bundled") return installBundledPlugin({ input, deps });
  if (source && Object.hasOwn(source, "bundledId")) throw new ToolInputError({ message: "source.bundledId requires kind 'bundled' and cannot be combined with a path or attachmentRef." });
  return installArchivePlugin({ deps, ctx });
}

/** The update's target, checked before any file is read. @complexity O(1). */
function readUpdateTarget({ input }: { input: Record<string, unknown> }, _optional: Record<string, never> = {}) {
  const pluginId = requireString({ input, key: "pluginId" });
  // Jini's manifest grammar, checked before the id names anything on disk.
  if (!isAgentPluginName({ value: pluginId })) throw new ToolInputError({ message: "pluginId is not a valid Agent Plugin id." });
  const expectedOldDigest = requireString({ input, key: "expectedOldDigest" });
  if (!/^[a-f0-9]{64}$/.test(expectedOldDigest)) throw new ToolInputError({ message: "expectedOldDigest must be the installed archiveDigest (lowercase hex SHA-256)." });
  return { pluginId, expectedOldDigest };
}

/** The MCP effects an update re-provisions through. Missing deps are a host wiring fault, so this
 *  throws a plain error (redacted to the model), not a caller-input error. @complexity O(1). */
function updateMcpEffects({ deps, actor }: { deps: AgentPluginsInstallToolDeps; actor: string }, _optional = {}) {
  return createAgentPluginUpdateEffects({ actor, deps: requireUpdateMcpDeps({ deps }), resolveServers: deps.resolveServers, provisionServers: deps.provisionServers });
}

/** The candidate's bytes from a folder, a local zip or a chat attachment, size-capped before reading. */
async function readToolArchive({ deps, ctx }: { deps: AgentPluginsInstallToolDeps; ctx: ToolExecutionContext }, _optional = {}) {
  const request = deps.pluginInstallSource.readRequest({ input: ctx.input });
  let archive;
  if (request.kind === "folder") {
    if (request.path === undefined) throw new ToolInputError({ message: "Agent Plugin folder source has no path" });
    archive = await deps.zipLocalFolder({ path: request.path, maxBytes: deps.maxAgentPluginInstallArchiveBytes() });
  } else {
    archive = await deps.pluginInstallSource.readArchive({ request, ownerId: ctx.principal.id, runId: ctx.run.id, maxBytes: deps.maxAgentPluginInstallArchiveBytes() }, { ...(deps.readInstallAttachment ? { readAttachment: deps.readInstallAttachment } : {}) });
  }
  return { request, archive, expectedSha256: deps.uploadOptions.sha256(archive) };
}

/** Every named lifecycle refusal is a result the model can act on; anything else stays redacted. */
function toToolInputError({ error }: { error: unknown }, _optional: Record<string, never> = {}): unknown {
  if (error instanceof FolderZipError) return new ToolInputError({ message: error.message });
  const named = error instanceof AgentPluginUpdateError || error instanceof AgentPluginHostIncompatibleError || error instanceof AgentPluginInstallError || error instanceof AgentPluginUploadError;
  return named ? new ToolInputError({ message: `${error.code}: ${error.message}` }) : error;
}

/** The same transaction as the admin Update button (`installUploadedAgentPlugin({ update })`). */
async function updateArchivePlugin(
  { deps, ctx, update }: { deps: AgentPluginsInstallToolDeps; ctx: ToolExecutionContext; update: { pluginId: string; expectedOldDigest: string } },
  _optional: Record<string, never> = {},
) {
  try {
    const { archive, expectedSha256 } = await readToolArchive({ deps, ctx });
    const result = await installUploadedAgentPlugin({ archive, expectedSha256, workspaceId: deps.workspaceId, actor: ctx.principal.id, update }, {
      ...deps.uploadOptions, layout: deps.agentPluginLayout, ...(deps.pluginHost ? { pluginHost: deps.pluginHost } : {}),
      ...(deps.snapshotAgentPluginSettings ? { snapshotSettings: deps.snapshotAgentPluginSettings } : {}),
      mcpProvisioning: updateMcpEffects({ deps, actor: ctx.principal.id }),
    });
    // No preview here: its replace checks refuse an enabled plugin, which an update keeps enabled.
    // The trust warning is the same static text install's preview carries, minus "stays OFF".
    // `enabled`/`warnings` are always present on the update path (`UpdatedUploadedAgentPlugin`: the
    // lifecycle owner's `updateAgentPlugin` result carries both), so no `null`/`[]` fallback is needed.
    return { updated: !result.alreadyInstalled, alreadyInstalled: result.alreadyInstalled, enabled: result.enabled, warnings: result.warnings,
      plugin: { id: result.plugin.pluginId, ...(result.plugin.version ? { version: result.plugin.version } : {}) },
      warning: UPLOADED_AGENT_PLUGIN_TRUST_WARNING,
      note: result.alreadyInstalled ? "These exact bytes are already installed; nothing changed."
        : "Updated. Memory is kept. Running chats keep the guidance they already loaded; MCP calls in progress may fail." };
  } catch (error) {
    throw toToolInputError({ error });
  }
}

/** Shared preview, publication and activation report for uploads and customized copies.
 * @throws Model-facing input errors for named install/upload/folder refusals.
 * @complexity O(b) bounded archive bytes; the existing installer owns extraction and locking.
 */
async function installArchivePlugin(
  { deps, ctx }: { deps: AgentPluginsInstallToolDeps; ctx: ToolExecutionContext },
  prepared: { archive?: Uint8Array } = {},
) {
  try {
    // Customized copies enter the SAME preview/install/state-reporting sequence as folder uploads.
    const { request, archive, expectedSha256 } = prepared.archive
      ? { request: { replace: false }, archive: prepared.archive, expectedSha256: deps.uploadOptions.sha256(prepared.archive) }
      : await readToolArchive({ deps, ctx });
    const required = { archive, expectedSha256, workspaceId: deps.workspaceId, actor: ctx.principal.id, replace: request.replace };
    const optional = { ...deps.uploadOptions, layout: deps.agentPluginLayout, ...(deps.pluginHost ? { pluginHost: deps.pluginHost } : {}) };
    const preview = await previewUploadedAgentPlugin(required, optional);
    const result = await installUploadedAgentPlugin({ ...required, expectedSha256: preview.digest }, optional);
    // Identical bytes are a no-op, including activation. Do not falsely report OFF for a
    // package the operator already enabled; malformed activation remains explicitly unknown.
    const verdict = result.alreadyInstalled
      ? (await deps.agentPluginActivations.resolveAgentPluginActivation({ workspaceRoot: deps.agentPluginLayout.forWorkspace({ workspaceId: deps.workspaceId }).root, pluginId: result.plugin.pluginId })).verdict
      : "inactive";
    return uploadedInstallResult({ result, verdict, warning: preview.warning });
  } catch (error) {
    throw toToolInputError({ error });
  }
}

function uploadedInstallResult(
  { result, verdict, warning }: { result: Awaited<ReturnType<typeof installUploadedAgentPlugin>>; verdict: Awaited<ReturnType<AgentPluginsInstallToolDeps["agentPluginActivations"]["resolveAgentPluginActivation"]>>["verdict"]; warning: string },
  _optional: Record<string, never> = {},
) {
  return { installed: true, enabled: verdict === "undetermined" ? null : verdict === "active", alreadyInstalled: result.alreadyInstalled,
    plugin: { id: result.plugin.pluginId, ...(result.plugin.version ? { version: result.plugin.version } : {}), ...(result.upgradeFrom ? { upgradeFrom: result.upgradeFrom } : {}) },
    warning,
    note: result.alreadyInstalled ? "These exact bytes are already installed; activation was not changed." : "Installed OFF. Enable with plugins_set_enabled (family 'agent-plugin') if requested.",
  };
}

/** Bundled plugins are seeded into every workspace at boot, so this normally finds the plugin
 * installed and only reports its state. When it is missing (its boot seed failed), it re-runs that
 * same idempotent boot seeder rather than a second install path, so provenance, digests and default
 * activation stay the seeder's. An operator-installed namesake is never given bundled trust.
 * @throws {ToolInputError} Unknown id, a namesake from another source, or a failed seed.
 */
async function installBundledPlugin(
  { input, deps }: { input: Record<string, unknown>; deps: AgentPluginsInstallToolDeps },
  _optional: Record<string, never> = {},
) {
  const id = readBundledPluginId({ input });
  const sourceRoot = deps.bundledAgentPluginsSourceRoot;
  const bundledIds = (await deps.listBundledAgentPluginServers({ bundledSourceRoot: sourceRoot })).map(plugin => plugin.pluginId).sort();
  if (!bundledIds.includes(id)) throw new ToolInputError({ message: `Unknown bundled plugin id '${id}'. Bundled ids: ${bundledIds.join(", ")}.` });
  const workspaceRoot = deps.agentPluginLayout.forWorkspace({ workspaceId: deps.workspaceId }).root;
  const existing = (await deps.listInstalledPlugins({ workspaceRoot })).some(plugin => plugin.pluginId === id);
  if (existing && !await deps.agentPluginActivations.isAgentPluginRecordedAsBundled({ workspaceRoot, pluginId: id })) {
    throw new ToolInputError({ message: `Plugin id '${id}' is already installed from another source; bundled plugins cannot replace it.` });
  }
  if (!existing) {
    await seedMissingBundledPlugin({ deps, sourceRoot, id });
  }
  const { verdict } = await deps.agentPluginActivations.resolveAgentPluginActivation({ workspaceRoot, pluginId: id });
  const installedNote = verdict === "active" ? "Installed ON (seeded enabled by default)." : "Installed OFF. Enable with plugins_set_enabled (family 'agent-plugin') if requested.";
  return { installed: true, alreadyInstalled: existing, enabled: verdict === "undetermined" ? null : verdict === "active", plugin: { id },
    note: existing ? `Bundled plugin '${id}' is already installed; activation was not changed.`
      : installedNote,
  };
}

export function contributeAgentPluginsInstallTools(
  required: Pick<AgentPluginsInstallToolDeps, "readInstallAttachment" | "pluginInstallSource">,
  _optional: Record<string, never> = {},
): ToolContributor<Omit<AgentPluginsInstallToolDeps, "pluginInstallSource">, unknown> {
  return { domain: "agent-plugins-install", build: deps => buildRegistrations({ ...deps, ...required }), risk: derivedRisk };
}

function readBundledPluginId({ input }: { input: Record<string, unknown> }, _optional: Record<string, never> = {}): string {
  const source = input.source as Record<string, unknown>;
  const id = source.bundledId;
  if (typeof id !== "string" || Object.keys(source).some(key => key !== "kind" && key !== "bundledId")) {
    throw new ToolInputError({ message: "Bundled source requires only kind:'bundled' and a bundledId; no path or attachmentRef." });
  }
  if (input.replace === true) throw new ToolInputError({ message: "Bundled plugins cannot be replaced." });
  return id;
}

async function seedMissingBundledPlugin(
  { deps, sourceRoot, id }: { deps: AgentPluginsInstallToolDeps; sourceRoot: string; id: string },
  _optional: Record<string, never> = {},
) {
  const outcome = (await deps.seedBundledAgentPlugins({ layout: deps.agentPluginLayout, workspaceId: deps.workspaceId, sourceRoot })).outcomes.find(plugin => plugin.pluginId === id);
  if (outcome?.status !== "seeded") throw new ToolInputError({ message: `Bundled plugin '${id}' could not be installed: ${outcome?.status === "failed" ? outcome.reason : "bundled package unavailable"}` });
}
