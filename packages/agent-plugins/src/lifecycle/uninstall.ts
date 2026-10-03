/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import type { Dirent } from "node:fs";
import path from "node:path";
import { createActivationModule } from "./activation.js";
import type { InstalledAgentPlugin } from "./install.js";
import type { AgentPluginLayout } from "./layout.js";
import { createResolveAgentPluginRefsModule } from "./resolve-agent-plugin-refs.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";

export class AgentPluginNotFoundError extends Error {
  constructor({ message }: { readonly message: string }, optional: ErrorOptions = {}) { super(message, optional); }
}

export class AgentPluginNotUninstallableError extends Error {
  constructor({ message }: { readonly message: string }, optional: ErrorOptions = {}) { super(message, optional); }
}

export class AgentPluginChangedSincePreviewError extends Error {
  constructor({ message }: { readonly message: string }, optional: ErrorOptions = {}) { super(message, optional); }
}

export interface UninstallAgentPluginRequired {
  readonly layout: AgentPluginLayout;
  readonly workspaceId: string;
  readonly pluginId: string;
}

export interface UninstallAgentPluginOptional {

  readonly confirmedPreview?: (AgentPluginUninstallPreview) | undefined;

  readonly retiredBundled?: (boolean) | undefined;
}

export interface UninstallAgentPluginResult {
  readonly pluginId: string;

  readonly removedDigests: readonly string[];
}

export interface AgentPluginUninstallPreview {
  readonly pluginId: string;

  readonly versions: readonly string[];
  readonly archiveDigests: readonly string[];
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const randomUUID = () => ports.ids.newId();
  const chmod = ports.filesystem.chmod.bind(ports.filesystem);
  const readdir = ports.filesystem.readdir.bind(ports.filesystem);
  const rename = ports.filesystem.rename.bind(ports.filesystem);
  const rm = ports.filesystem.rm.bind(ports.filesystem);
  const stat = ports.filesystem.stat.bind(ports.filesystem);
  const { deleteAgentPluginActivation, isAgentPluginRecordedAsBundled, resolveAgentPluginActivation } = createActivationModule(ports);
  const { listInstalledPlugins } = createResolveAgentPluginRefsModule(ports);
  interface UninstallTargets {
    readonly workspaceRoot: string;

    readonly packagesDir: string;
    readonly matches: readonly InstalledAgentPlugin[];
  }

  interface StagedTree {
    readonly quarantined: string;
    readonly original: string;
    readonly originalMode: number;
  }

  const STAGED_DIRNAME_PREFIX = ".uninstalling-";

  async function previewAgentPluginUninstall(required: UninstallAgentPluginRequired): Promise<AgentPluginUninstallPreview> {
    const { matches } = await resolveUninstallTargets(required);
    const versions = [...new Set(matches.flatMap((plugin) => (plugin.version === undefined ? [] : [plugin.version])))];
    return { pluginId: required.pluginId, versions, archiveDigests: matches.map((plugin) => plugin.archiveDigest) };
  }

  async function uninstallAgentPlugin(
    required: UninstallAgentPluginRequired,
    optional: UninstallAgentPluginOptional = {},
  ): Promise<UninstallAgentPluginResult> {
    const { workspaceRoot, packagesDir, matches } = await resolveUninstallTargets(required, optional.retiredBundled === true);
    assertUnchangedSincePreview(required.pluginId, optional.confirmedPreview, matches);

    const staged: StagedTree[] = [];
    try {
      for (const plugin of matches) {
        staged.push(await stageForRemoval(packagesDir, plugin.packageRoot));
      }
      await deleteAgentPluginActivation({ workspaceRoot, pluginId: required.pluginId });
    } catch (error) {
      throw await restoreStagedTrees(staged, error);
    }

    for (const tree of staged) {
      await removeFrozenPackageTree(tree.quarantined);
    }

    return { pluginId: required.pluginId, removedDigests: matches.map((plugin) => plugin.archiveDigest) };
  }

  function assertUnchangedSincePreview(
    pluginId: string,
    confirmedPreview: AgentPluginUninstallPreview | undefined,
    matches: readonly InstalledAgentPlugin[],
  ): void {
    if (confirmedPreview === undefined) return;
    const previewed = [...confirmedPreview.archiveDigests].sort();
    const installedNow = matches.map((plugin) => plugin.archiveDigest).sort();
    if (previewed.join(",") === installedNow.join(",")) return;
    throw new AgentPluginChangedSincePreviewError({ message: `Agent Plugin '${pluginId}' changed after its uninstall was previewed (previewed archive digests: ${previewed.join(", ")}; ` +
        `installed now: ${installedNow.join(", ")}) — nothing was removed` });
  }

  async function stageForRemoval(packagesDir: string, packageRoot: string): Promise<StagedTree> {
    const quarantined = path.join(packagesDir, `${STAGED_DIRNAME_PREFIX}${randomUUID()}`);
    const originalMode = (await stat(packageRoot)).mode & 0o777;

    await chmod(packageRoot, originalMode | 0o700);
    try {
      await rename(packageRoot, quarantined);
    } catch (error) {
      await chmod(packageRoot, originalMode).catch(() => undefined);
      throw error;
    }

    return { quarantined, original: packageRoot, originalMode };
  }

  async function restoreStagedTrees(staged: readonly StagedTree[], cause: unknown): Promise<unknown> {
    const stranded: string[] = [];
    for (const tree of [...staged].reverse()) {
      try {
        await rename(tree.quarantined, tree.original);
        await chmod(tree.original, tree.originalMode).catch(() => undefined);
      } catch {
        stranded.push(tree.quarantined);
      }
    }
    if (stranded.length === 0) return cause;

    const reason = cause instanceof Error ? cause.message : String(cause);
    return new Error(
      `Agent Plugin uninstall failed (${reason}) and ${stranded.length} package tree(s) could not be put back. ` +
        `They still hold the package bytes and were left in place for recovery: ${stranded.join(", ")}`,
      { cause },
    );
  }

  async function resolveUninstallTargets(required: UninstallAgentPluginRequired, retiredBundled = false): Promise<UninstallTargets> {
    const { layout, workspaceId, pluginId } = required;

    const workspaceLayout = layout.forWorkspace({ workspaceId });

    const installed = await listInstalledPlugins(workspaceLayout.packages);
    const matches = installed.filter((plugin) => plugin.pluginId === pluginId);
    if (matches.length === 0) {
      throw new AgentPluginNotFoundError({ message: `Agent Plugin '${pluginId}' is not installed in this workspace — nothing to uninstall` });
    }

    if (!retiredBundled && (await isAgentPluginRecordedAsBundled(workspaceLayout.root, pluginId))) {
      throw new AgentPluginNotUninstallableError({ message: bundledRefusalMessage(pluginId) });
    }

    if ((await resolveAgentPluginActivation(workspaceLayout.root, pluginId)).verdict === "undetermined") {
      throw new AgentPluginNotUninstallableError({ message: malformedEntryRefusalMessage(pluginId) });
    }

    return { workspaceRoot: workspaceLayout.root, packagesDir: workspaceLayout.packages, matches };
  }

  function bundledRefusalMessage(pluginId: string): string {
    return (
      `Agent Plugin '${pluginId}' is bundled with ${ports.productName} and cannot be uninstalled — it is re-seeded on every boot ` +
      "(seed-bundled.ts), so removing its files now would silently reappear on the next restart. To stop it being " +
      "used, disable it through the host's activation control."
    );
  }

  function malformedEntryRefusalMessage(pluginId: string): string {
    return (
      `Agent Plugin '${pluginId}' cannot be uninstalled: its entry in this workspace's activation record is malformed, so ` +
      `whether it is bundled with ${ports.productName} (and would be re-seeded on the next boot) cannot be established. Nothing was ` +
      "removed. Tell the user an operator has to repair that entry in activations.json first; until then this " +
      "plugin's tool calls and plugin-pinned runs are refused."
    );
  }

  async function removeFrozenPackageTree(root: string): Promise<void> {
    await makeTreeWritable(root);
    await rm(root, { recursive: true, force: true });
  }

  async function makeTreeWritable(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await chmod(dir, 0o700).catch(() => undefined);
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await makeTreeWritable(absolute);
      } else {
        await chmod(absolute, 0o600).catch(() => undefined);
      }
    }
  }

  return { previewAgentPluginUninstall, uninstallAgentPlugin };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createUninstallModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
