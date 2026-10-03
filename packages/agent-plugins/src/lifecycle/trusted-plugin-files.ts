/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createActivationModule } from "./activation.js";
import { createBundledDigestsModule } from "./bundled-digests.js";
import { PackagePathViolation } from "./package-paths.js";
import { createPackagePathsModule } from "./package-paths.js";
import { createResolveAgentPluginRefsModule } from "./resolve-agent-plugin-refs.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";

export interface TrustedPluginPackage {
  readonly pluginId: string;
  readonly packageRoot: string;
}

export interface TrustedPluginPackagesQuery {
  readonly workspaceId: string;

  readonly filename: string;

  readonly contribution: string;

  readonly requireActive: boolean;

  readonly orderByPluginId?: (boolean) | undefined;

  readonly onInactive?: ((required: { readonly plugin: TrustedPluginPackage }) => Promise<void>) | undefined;
}

export type TrustedPluginVerdict = { readonly trusted: TrustedPluginPackage } | { readonly refusal: string };

function buildModule(ports: AgentPluginLifecyclePorts) {
  const readFile = ports.filesystem.readFile.bind(ports.filesystem);
  const { resolveAgentPluginActivation } = createActivationModule(ports);
  const { preferBundledAgentPluginDigests, readBundledAgentPluginDigests } = createBundledDigestsModule(ports);
  const { assertContainedOnDisk } = createPackagePathsModule(ports);
  const { listInstalledPlugins } = createResolveAgentPluginRefsModule(ports);
  async function findTrustedPluginPackages(query: TrustedPluginPackagesQuery): Promise<readonly TrustedPluginVerdict[]> {
    const layout = ports.layout.forWorkspace({ workspaceId: query.workspaceId });
    const bundled = await readBundledAgentPluginDigests(layout.root);
    const preferred = preferBundledAgentPluginDigests(await listInstalledPlugins(layout.packages), bundled);
    const installed = query.orderByPluginId ? [...preferred].sort((a, b) => a.pluginId.localeCompare(b.pluginId)) : preferred;

    const verdicts: TrustedPluginVerdict[] = [];
    for (const plugin of installed) {
      if (!plugin.files.includes(query.filename)) continue;
      const refusal = await trustRefusal(query, plugin, bundled.get(plugin.pluginId), layout.root);
      const trusted = { pluginId: plugin.pluginId, packageRoot: plugin.packageRoot };
      if (refusal === null) verdicts.push({ trusted });
      else if (refusal === "inactive") await query.onInactive?.({ plugin: trusted });
      else verdicts.push({ refusal: `${query.contribution} from '${plugin.pluginId}' were not loaded: ${refusal}` });
    }
    return verdicts;
  }

  async function trustRefusal(
    query: TrustedPluginPackagesQuery,
    plugin: { readonly pluginId: string; readonly archiveDigest: string },
    bundledDigest: string | undefined,
    workspaceRoot: string
  ): Promise<string | null> {
    if (query.requireActive) {
      const activation = await resolveAgentPluginActivation(workspaceRoot, plugin.pluginId);
      if (activation.verdict === "inactive") return "inactive";
      if (activation.verdict === "undetermined") return `its activation could not be read (${activation.reason})`;
    }
    if (bundledDigest !== plugin.archiveDigest) {
      return `only plugins shipped with ${ports.productName} may add ${query.contribution} (installed digest ${plugin.archiveDigest.slice(0, 12)} is not the one this build shipped)`;
    }
    return null;
  }

  async function readTrustedPluginFile(plugin: TrustedPluginPackage, filename: string): Promise<string> {
    const absolute = await assertContainedOnDisk(plugin.packageRoot, filename);
    return readFile(absolute, "utf8");
  }

  async function importContainedModule(plugin: TrustedPluginPackage, modulePath: string): Promise<{ readonly exported: unknown } | string> {
    let resolved: string;
    try {
      resolved = await assertContainedOnDisk(plugin.packageRoot, modulePath);
    } catch (error) {
      if (error instanceof PackagePathViolation) return `module path '${modulePath}' escapes the plugin root`;
      throw error;
    }
    try {
      const imported = (await import(pathToFileURL(resolved).href)) as { readonly default?: unknown };
      return { exported: imported.default };
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  return { findTrustedPluginPackages, readTrustedPluginFile, importContainedModule };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createTrustedPluginFilesModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
