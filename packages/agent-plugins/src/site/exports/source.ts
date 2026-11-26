/** Public-export catalog over the lifecycle's bundled digest and containment gates. */
import { orFallback } from "@jini-ai/core/errors/idioms";
import type { parseAgentPluginManifest } from "../../lifecycle/manifest.js";
import type { TrustedPluginPackage, createAgentPluginLifecycle } from "../../lifecycle/index.js";
import type { AgentPluginExport } from "@jini-ai/core/contracts/site/agent-plugins-manifest";
import type { AgentPluginExportMetadata } from "@jini-ai/core/contracts/site/agent-plugins-lifecycle";

export interface PluginExportPackage extends AgentPluginExportMetadata {
  readonly plugin: TrustedPluginPackage;
  readonly id: string;
  readonly displayName?: string;
  readonly enabled: boolean;
  readonly exports: Readonly<Record<string, AgentPluginExport>>;
}
export interface PluginExportSource {
  list(required: { workspaceId: string }, options?: Record<string, never>): Promise<readonly PluginExportPackage[]>;
  readFile(required: { plugin: TrustedPluginPackage; filename: string }, options?: Record<string, never>): Promise<string>;
  readAsset(required: { plugin: TrustedPluginPackage; filename: string }, options?: Record<string, never>): Promise<string | Uint8Array>;
}

/** Encode declared ids/paths; URL inputs are never converted into filesystem paths. O(path length). */
export function pluginExportFileUrl(required: { prefix: string; pluginId: string; component: string; filename: string }, _options = {}): string {
  return `${required.prefix}/${encodeURIComponent(required.pluginId)}/${encodeURIComponent(required.component)}/${required.filename.split("/").map(encodeURIComponent).join("/")}`;
}

/** One broken bundled package cannot hide the other exports. No raw parse/read errors escape.
 * @complexity O(m) manifest bytes, one contained read.
 */
async function readPackage(required: { lifecycle: Parameters<typeof createPluginExportSource>[0]["lifecycle"]; plugin: TrustedPluginPackage; enabled: boolean; parseAgentPluginManifest: typeof parseAgentPluginManifest }, _options = {}): Promise<PluginExportPackage | undefined> {
  return orFallback({
    work: async () => {
      const raw = await required.lifecycle.readTrustedPluginFile({ plugin: required.plugin, filename: "plugin.json" });
      const result = required.parseAgentPluginManifest({ value: JSON.parse(raw) });
      if (!result.ok || !result.manifest.id) return undefined;
      const displayName = result.manifest.displayName;
      return { ...result.manifest, ...(typeof displayName === "string" ? { displayName } : {}),
        plugin: required.plugin, id: result.manifest.id, enabled: required.enabled, exports: result.manifest.exports ?? {} };
    },
    fallback: undefined,
    step: "read plugin export manifest",
  });
}

/** Discover disabled declarations through the same digest gate so editors can explain fallback.
 * Activation is a separate admitted set: the lifecycle's inactive callback runs before its digest
 * check and therefore must never be used as a trusted catalog.
 * @complexity O(p + m) packages plus manifest bytes; two bounded lifecycle catalog scans.
 */
export function createPluginExportSource(required: {
  lifecycle: Pick<ReturnType<typeof createAgentPluginLifecycle>, 'findTrustedPluginPackages' | 'readTrustedPluginFile' | 'assertContainedOnDisk'>;
  parseAgentPluginManifest: typeof parseAgentPluginManifest; readAssetFile(path: string): Promise<Uint8Array>;
}, _options = {}): PluginExportSource {
  const { lifecycle } = required;
  return {
    list: async ({ workspaceId }, _options = {}) => {
      const query = { workspaceId, filename: "plugin.json", contribution: "public page exports", orderByPluginId: true };
      const admitted = await lifecycle.findTrustedPluginPackages({ ...query, requireActive: false });
      const active = await lifecycle.findTrustedPluginPackages({ ...query, requireActive: true });
      const enabled = new Set(active.flatMap(verdict => "trusted" in verdict ? [verdict.trusted.packageRoot] : []));
      const packages: PluginExportPackage[] = [];
      for (const verdict of admitted) {
        if (!("trusted" in verdict)) continue;
        const item = await readPackage({ lifecycle, plugin: verdict.trusted, enabled: enabled.has(verdict.trusted.packageRoot), parseAgentPluginManifest: required.parseAgentPluginManifest });
        if (item) packages.push(item);
      }
      return packages;
    },
    readFile: ({ plugin, filename }, _options = {}) => lifecycle.readTrustedPluginFile({ plugin, filename }),
    readAsset: async ({ plugin, filename }, _options = {}) => {
      if (!filename.endsWith(".png")) return lifecycle.readTrustedPluginFile({ plugin, filename });
      // Jini's trusted text reader is UTF-8 only. Preserve PNG bytes using its same path owner;
      // do not duplicate containment or join a request path to a package directory here.
      return required.readAssetFile(await lifecycle.assertContainedOnDisk({ packageRoot: plugin.packageRoot, entryPath: filename }));
    },
  };
}
