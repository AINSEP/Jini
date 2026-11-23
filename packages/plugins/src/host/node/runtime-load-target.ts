import type { PluginManifest } from "../manifest-types.js";
import type { PluginDiscoveryRecord } from "../discovery-types.js";
import type { AttachmentSource } from "../hook-registry.js";
import { siteEntryPath } from "./discovery.js";
import type { PluginRuntimeSource } from "./runtime-contracts.js";
import type { PluginModuleImportPort } from "../ports.js";

/** What `loadPlugin()` and `attachLoadedPlugin()` need for one enable attempt, resolved by
 * {@link resolveLoadTarget}. `importModule` is omitted (not `undefined`-valued) for a site target
 * so the host binding supplies the contained snapshot importer; only a built-in target carries
 * an explicit scalar override (its test/production seam, unchanged by this type). */
export interface PluginLoadTarget {
  readonly manifest: PluginManifest;
  readonly entryPath: string;
  readonly attachmentSource: AttachmentSource;
  readonly importModule?: (entryPath: string) => Promise<unknown>;
  /** A built-in's declared `sourceDir`: its registered package root for the Tier-2 worker's import
   * policy. Omitted ⇒ the loader's root derived from the entry's `<root>/server/index.mjs` layout. */
  readonly packageRoot?: string;
}

/**
 * Resolves ONE enable attempt's load target (Milestone 1b, 2026-08-20): a compiled-in built-in
 * plugin uses the composition root's own static `PluginRuntimeSource` — entirely unchanged from
 * before this slice, so every existing built-in test (including ones that inject a synthetic
 * `entryPath`/`importModule`, e.g. the auto-quarantine fixture) keeps behaving identically. A
 * site-installed plugin has no static source to find, so its target is derived instead from the
 * SAME discovery record `onPluginEnabled` already fetched this call — reusing `record.manifest`
 * (see that field's own doc for why this, not a second file read, is the TOCTOU-safe choice) and
 * `siteEntryPath()`'s REQ-02 layout convention.
 *
 * Deliberately does not itself touch integrity/`sdkRange`/`import()` — those stay exactly where
 * they are required, inside `loadPlugin()`'s own fixed step order. This function only decides
 * WHICH manifest/entryPath/import-hook `loadPlugin()` is handed; it never calls `import()` itself
 * and never lets a caller reach one without going through `loadPlugin()`'s ordering first.
 *
 * @returns `null` when the id is neither a known built-in nor a valid, installDir-reachable site
 * record — the caller's existing fail-closed `PLUGIN_EXPORT_INVALID` behavior is unchanged.
 * @complexity O(sources.length) — one linear scan of the static built-in list; no I/O of its own.
 */
export function resolveLoadTarget(params: {
  pluginId: string;
  sources: readonly PluginRuntimeSource[];
  record: PluginDiscoveryRecord;
  installDir: string | undefined;
}): PluginLoadTarget | null {
  const { pluginId, sources, record, installDir } = params;

  const builtIn = sources.find((candidate) => candidate.manifest.id === pluginId);
  if (builtIn) {
    return {
      manifest: builtIn.manifest,
      entryPath: builtIn.entryPath,
      attachmentSource: builtIn.source,
      importModule: builtIn.importModule,
      // A built-in's entry may sit directly in its sourceDir, where the loader's layout guess would
      // name the folder holding EVERY built-in as this one's package.
      ...(builtIn.sourceDir === undefined ? {} : { packageRoot: builtIn.sourceDir }),
    };
  }

  if (record.source === "site" && installDir !== undefined && record.manifest !== undefined) {
    return {
      manifest: record.manifest,
      entryPath: siteEntryPath({ installDir, id: record.id, version: record.version }),
      attachmentSource: record.source,
    };
  }

  return null;
}

/** True when a manifest declares provider factories (`contributes.providers`). */
export function declaresProviders({ manifest }: { manifest: PluginManifest | undefined }): boolean {
  return (manifest?.contributes?.providers?.length ?? 0) > 0;
}

/**
 * The importer with the target's registered package root in place of the loader's layout-derived
 * one; unchanged when the target declares none. Applied to the Tier-2 worker seam only, whose
 * import policy scopes "the plugin's own files" to that root.
 * @complexity O(1) per import.
 */
export function withRegisteredPackageRoot(
  required: { importModule: PluginModuleImportPort; packageRoot: string | undefined },
  _optional: Record<string, never> = {},
): PluginModuleImportPort {
  const { importModule, packageRoot } = required;
  if (packageRoot === undefined) return importModule;
  return (call) => importModule({ ...call, plugin: { ...call.plugin, packageRoot } });
}
