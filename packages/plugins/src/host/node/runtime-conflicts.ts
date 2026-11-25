/**
 * @file Discovery and conflict-gate phase of the plugin runtime core (G08 split): which plugins exist
 * for this workspace and what each would clash with. Reads the shared {@link RuntimeState}; writes none.
 */
import { PluginConflictError, resolvePluginConflicts, type PluginConflict } from "../plugin-claims.js";
import type { PluginDiscoveryRecord } from "../discovery-types.js";
import type { PluginManifest } from "../manifest-types.js";
import { discoverPlugins as discoverPluginRuntimePlugins } from "./discovery.js";
import type { RuntimeState } from "./runtime-state.js";

// Reachability fix (previously always omitted `installDir`, so a plugin placed on disk was
// never scanned no matter how the composition root itself was configured — see this function's
// required-params doc).
export function discoverPlugins<E, O>({ state }: { state: RuntimeState<E, O> }, _options = {}) {
  const { installDir } = state;
  return discoverPluginRuntimePlugins({ ...state.runtimeBinding, builtIns: state.required.sources, ...(installDir === undefined ? {} : { installDir }) });
}

/** Retained versions make the activation row's existing active pointer meaningful at boot
 * and reload. A newly installed version is not running until controlled reload advances it. */
export async function discoverActivePlugins<E, O>({ state }: { state: RuntimeState<E, O> }, _options = {}): Promise<readonly PluginDiscoveryRecord[]> {
  const { installDir } = state;
  const rows = await state.required.activationRepo.listAll();
  const versions = new Map(rows.filter(row => row.workspaceId === state.required.workspaceId && row.enabled).map(row => [row.pluginId, row.version]));
  return discoverPluginRuntimePlugins({ ...state.runtimeBinding, builtIns: state.required.sources, ...(installDir === undefined ? {} : { installDir }) }, { versions });
}

export async function listPluginConflicts<E, O>(
  { state, discovery }: { state: RuntimeState<E, O>; discovery?: readonly PluginDiscoveryRecord[] },
  optional: { candidateId?: string } = {},
): Promise<ReadonlyMap<string, readonly PluginConflict[]>> {
  const [records, activations] = await Promise.all([discovery ?? discoverPlugins({ state }), state.required.activationRepo.listAll()]);
  return resolvePluginConflicts({ ...state.runtimeBinding, workspaceId: state.required.workspaceId, discovery: records, activations, coreClaims: state.coreClaims }, optional);
}

/** Install preview (2026-10-04): what the staged package would clash with if turned on in THIS
 * workspace now. A synthetic valid record stands in for it and REPLACES an installed version of the
 * same id, so an upgrade is judged by its new manifest only. */
export async function installPreviewConflicts<E, O>({ state, manifest }: { state: RuntimeState<E, O>; manifest: PluginManifest }, _options = {}): Promise<readonly PluginConflict[]> {
  const staged: PluginDiscoveryRecord = { id: manifest.id, name: manifest.name, version: manifest.version, source: "site", tier: manifest.tier, status: "valid", errors: [], manifest };
  const discovery = [...(await discoverPlugins({ state })).filter((record) => record.id !== manifest.id), staged];
  return (await listPluginConflicts({ state, discovery }, { candidateId: manifest.id })).get(manifest.id) ?? [];
}

/** Enable-time conflict gate (2026-10-04): runs before `loadPlugin()`, so a plugin that would
 * take a name core or an enabled plugin holds never has its code imported. The candidate is
 * ordered after every enabled plugin — it is the newer one by definition. */
export async function assertNoConflicts<E, O>({ state, pluginId, discovery }: { state: RuntimeState<E, O>; pluginId: string; discovery: readonly PluginDiscoveryRecord[] }, _options = {}): Promise<void> {
  const conflicts = (await listPluginConflicts({ state, discovery }, { candidateId: pluginId })).get(pluginId);
  if (conflicts) throw new PluginConflictError({ pluginId, conflicts });
}
