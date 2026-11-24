import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import type { TrustedPluginPackage } from "@jini-ai/agent-plugins/lifecycle";

/**
 * @file The hermetic bundled-contribution source policy: which product-owned plugin source packages
 * contribute a given manifest file. The host injects its `retired` bundled plugin ids (its catalog) and
 * binds the result as its `sources` port; see `README.md` `## Wiring`.
 */

/** The host's bound bundled-source policy, as the readers that take `sources` consume it. */
export type BundledContributionSources = (required: { readonly sourceRoot: string; readonly filename: string }) => readonly TrustedPluginPackage[];

/** Hermetic bundled contribution sources, in plugin-id order. Requires both the package
 * manifest and category file; stale retired packages and non-packages never contribute. Only pass
 * product-owned source roots, never operator-writable installed directories. Synchronous so CLI
 * help and async category loaders use the same selection policy. @complexity O(p) directories.
 * @param required - `retired`: the host's retired bundled plugin ids (any id-keyed set or map), which never contribute.
 * @example listBundledContributionSources({ sourceRoot, filename: "plugin-data.json", retired: new Set(["old-id"]) });
 */
export function listBundledContributionSources(
  required: { readonly sourceRoot: string; readonly filename: string; readonly retired: Pick<ReadonlySet<string>, "has"> }, _optional: Record<string, never> = {},
): readonly TrustedPluginPackage[] {
  return readdirSync(required.sourceRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !required.retired.has(entry.name))
    .map(entry => ({ pluginId: entry.name, packageRoot: path.join(required.sourceRoot, entry.name) }))
    .filter(plugin => existsSync(path.join(plugin.packageRoot, "plugin.json")) && existsSync(path.join(plugin.packageRoot, required.filename)))
    .sort((a, b) => a.pluginId.localeCompare(b.pluginId, "en"));
}
