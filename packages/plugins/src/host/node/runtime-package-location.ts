import path from "node:path";
import type { PluginDiscoveryRecord } from "../discovery-types.js";
import { PluginPackagePathError } from "./package-files.js";
import type { PluginRuntimeSource } from "./runtime-contracts.js";

/**
 * A plugin id safe to use as a single filesystem path segment (Milestone 2, 2026-08-20) — the same
 * character class `src/features/agent-plugins/layout.ts`'s `SAFE_PLUGIN_ID_PATTERN` uses,
 * independently declared here rather than imported: that module is a DIFFERENT, unrelated plugin
 * system (agent-plugins.org format; see this file's own `PluginRuntimeSource` doc history and
 * Milestone 1's handoff for why the two are never wired together), and importing from it would
 * create exactly that coupling for a one-line regex. `.` and `-` are allowed mid-string (matching
 * real semver-adjacent plugin ids like `word-count`) but the pattern has no `/`, no `..`, and no
 * leading/trailing separator — it cannot itself produce a path-traversal segment.
 */
export const SAFE_PLUGIN_ID_SEGMENT = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

/** Thrown when `pluginId` is not safe to use as a filesystem path segment
 * under `installDir` — either it fails {@link SAFE_PLUGIN_ID_SEGMENT}'s allowlist, or (defense in
 * depth, in case some future caller's id validation elsewhere ever drifts) the resolved absolute
 * path would land outside `installDir` after resolution. Deliberately fails closed on EITHER
 * check independently, not just the one presumed sufficient.
 * @agent-note Error identity: hosts re-export this ONE class (never a copy) so `instanceof` and
 * `name === "PluginUninstallPathError"` hold across the host's routes and tests. */
export class PluginUninstallPathError extends Error {
  constructor(pluginId: string) {
    super(`plugin id '${pluginId}' is not a safe filesystem path segment — refusing to remove it`);
    this.name = "PluginUninstallPathError";
  }
}

/** A site plugin's version folder name as discovery read it from disk: one segment, no
 * separator, no leading dot. Checked together with {@link SAFE_PLUGIN_ID_SEGMENT} before either is
 * joined into a path. */
const SAFE_VERSION_SEGMENT = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;

/**
 * Where one discovered plugin's files live, for the package-files viewer: a built-in's own
 * `sourceDir`, or a site plugin's `<installDir>/<id>/<version>/` (REQ-02's layout, the same one
 * `siteEntryPath()` joins). The directory is its own container for a built-in; `installDir` is the
 * container for a site plugin, so `readPluginPackageFiles()`'s realpath check keeps a symlinked id
 * or version folder from reaching outside it.
 *
 * @returns `null` when there is no directory to show: a built-in without `sourceDir`, or a site
 *   record while `installDir` is unset.
 * @throws {PluginPackagePathError} a site record's id or version is not one safe path segment — a
 *   site record's id comes from its own manifest, so it is untrusted text until checked here.
 * @complexity O(sources.length).
 */
export function resolvePackageLocation(params: {
  record: PluginDiscoveryRecord;
  sources: readonly PluginRuntimeSource[];
  installDir: string | undefined;
}): { rootDir: string; containerDir: string } | null {
  const { record, sources, installDir } = params;
  if (record.source === "built-in") {
    const sourceDir = sources.find((candidate) => candidate.manifest.id === record.id)?.sourceDir;
    return sourceDir === undefined ? null : { rootDir: sourceDir, containerDir: sourceDir };
  }
  if (installDir === undefined) return null;
  if (!SAFE_PLUGIN_ID_SEGMENT.test(record.id) || !SAFE_VERSION_SEGMENT.test(record.version)) {
    throw new PluginPackagePathError(`plugin '${record.id}' version '${record.version}' is not a safe path segment`);
  }
  return { rootDir: path.join(installDir, record.id, record.version), containerDir: installDir };
}
