/** Chat customization reuses Jini's package fork and the admin upload preview/install owner. */
import { requireInputRecord, requireString, ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
import type { AgentPluginLayout } from "@jini-ai/core/contracts/headless/plugin-host";
import { FolderZipError } from "@jini-ai/agent-plugins/folder-zip";
import { zipCustomizedAgentPluginFolder } from "@jini-ai/agent-plugins/folder-zip/node";

/** The install tool's deps this fork reads: the site layout and the bound workspace. */
export interface CustomizeAgentPluginDeps {
  readonly agentPluginLayout: Pick<AgentPluginLayout, "forWorkspace">;
  readonly workspaceId: string;
}

/** The lifecycle owner's calls this fork uses; the host passes its bound lifecycle functions. */
export interface CustomizeAgentPluginLifecycle<P extends { readonly pluginId: string; readonly packageRoot: string }, B> {
  readonly listInstalledPlugins: (required: { readonly workspaceRoot: string }) => Promise<readonly P[]>;
  readonly readBundledAgentPluginDigests: (required: { readonly workspaceRoot: string }) => Promise<B>;
  readonly preferBundledAgentPluginDigests: (installed: readonly P[], bundled: B) => readonly P[];
  readonly maxAgentPluginInstallArchiveBytes: () => number;
}

/**
 * Prepare a fork after the install tool's authorization; publication stays with that tool's owner.
 * @param required Host deps, the actual assistant tool context and the host's lifecycle calls.
 * @returns ZIP bytes for the existing install flow. Never writes an installed package.
 * @throws {ToolInputError} Unknown/ambiguous source or invalid edit.
 * @complexity O(p + e log e + b) for p installed packages, e files and bounded bytes b; no network.
 */
export async function prepareCustomizedAgentPluginArchive<P extends { readonly pluginId: string; readonly packageRoot: string }, B>(
  { deps, ctx, lifecycle }: { deps: CustomizeAgentPluginDeps; ctx: ToolExecutionContext; lifecycle: CustomizeAgentPluginLifecycle<P, B> },
  _options = {},
): Promise<Uint8Array> {
  const input = requireInputRecord({ input: ctx.input });
  const pluginId = requireString({ input, key: "pluginId" });
  const workspaceRoot = deps.agentPluginLayout.forWorkspace({ workspaceId: deps.workspaceId }).root;
  const installed = lifecycle.preferBundledAgentPluginDigests(await lifecycle.listInstalledPlugins({ workspaceRoot }), await lifecycle.readBundledAgentPluginDigests({ workspaceRoot }));
  const sources = installed.filter(plugin => plugin.pluginId === pluginId);
  const source = sources[0];
  if (sources.length !== 1 || source === undefined) throw new ToolInputError({ message: `Source '${pluginId}' must identify exactly one installed Agent Plugin.` });
  try {
    return await zipCustomizedAgentPluginFolder({ path: source.packageRoot, maxBytes: lifecycle.maxAgentPluginInstallArchiveBytes(), name: requireString({ input, key: "newId" }), identityNamespace: "jini",
      edit: { path: requireString({ input, key: "path" }), oldString: requireString({ input, key: "oldString" }), newString: requireString({ input, key: "newString" }, { allowEmpty: true }) } });
  } catch (error) {
    if (error instanceof FolderZipError) throw new ToolInputError({ message: error.message });
    throw error;
  }
}
