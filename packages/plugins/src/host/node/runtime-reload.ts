/**
 * @file Install, source and reload phases of the plugin runtime core (G08 split): the installer port,
 * the source service and the approval-gated reload with its restore rollback.
 * @agent-note Reload: a source reload that widens capabilities throws the host's
 * `text.reloadApprovalRequired` and keeps the approved version running; a failed reload re-enters the
 * same loader for the restored row, and if that fails too the plugin is quarantined with
 * `text.restoreFailedReason`.
 */
import { describeErrorForLog } from "@jini-ai/core";
import { setPluginEnabled, type PluginActivationRepoPort } from "../activation.js";
import type { PluginDiscoveryRecord } from "../discovery-types.js";
import { quarantinePlugin } from "../quarantine.js";
import { addedPluginCapabilities, pluginCapabilitySet } from "../source-policy.js";
import { installSitePlugin, previewSitePluginInstall, pruneSitePluginVersions, type PluginInstallerPort } from "./install.js";
import { createPluginSourceService, type PluginSourcePort } from "./source-drafts.js";
import { onPluginDisabled, onPluginEnabled } from "./runtime-activation.js";
import { discoverPlugins, installPreviewConflicts } from "./runtime-conflicts.js";
import type { RuntimeState } from "./runtime-state.js";

type RuntimeArgs<E, O> = { state: RuntimeState<E, O> };

/** The install deps shared by preview and install. */
function installDeps<E, O>({ state, installDir, options }: RuntimeArgs<E, O> & { installDir: string; options: object }, _options = {}) {
  const { sources, activationRepo } = state.required;
  return { ...state.runtimeBinding, ...options, installDir, builtInIds: sources.map((source) => source.manifest.id), builtInManifests: sources.map((source) => source.manifest), repo: activationRepo, conflicts: ({ manifest }: { manifest: Parameters<typeof installPreviewConflicts>[0]["manifest"] }) => installPreviewConflicts({ state, manifest }) };
}

export function createPluginInstaller<E, O>({ state }: RuntimeArgs<E, O>, _options = {}): PluginInstallerPort | undefined {
  const { installDir } = state;
  if (installDir === undefined) return undefined;
  return {
      preview: (input, options = {}) => previewSitePluginInstall({ ...input, deps: installDeps({ state, installDir, options }) }),
      install: async (input, options = {}) => {
        const deps = installDeps({ state, installDir, options });
        const preview = await previewSitePluginInstall({ ...input, deps });
        // Admission uses this manifest's identity; publication must retain those exact bytes.
        const run = () => installSitePlugin({ ...input, expectedDigest: input.expectedDigest ?? preview.digest, deps });
        const host = state.optional.lookup?.();
        if (!host) return run();
        return host.withInstallIdentity({ candidate: { id: preview.publisherId ?? `unknown/${preview.id}`, localId: preview.id, family: "site-runtime" }, run });
      },
  };
}

/** Callbacks for one row: only this workspace's rows touch live runtime state; other workspaces just re-seal. */
function activationCallbacks<E, O>({ state, here }: RuntimeArgs<E, O> & { here: boolean }, _options = {}) {
  if (!here) return { onEnabled: async () => {}, onDisabled: () => {} };
  return { onEnabled: (pluginId: string) => onPluginEnabled({ state, pluginId }), onDisabled: (pluginId: string) => onPluginDisabled({ state, pluginId }) };
}

async function reloadActivation<E, O>({ state, row, id, discovery }: RuntimeArgs<E, O> & {
  row: Awaited<ReturnType<PluginActivationRepoPort["listAll"]>>[number]; id: string; discovery: readonly PluginDiscoveryRecord[];
}, _options = {}): Promise<void> {
  const here = row.workspaceId === state.required.workspaceId;
  try {
    await setPluginEnabled({ deps: { clock: state.required.clock, repo: state.required.activationRepo, discovery,
      ...activationCallbacks({ state, here }) },
      input: { workspaceId: row.workspaceId, pluginId: id, enabled: true } });
  } catch (error) {
    if (here) await restoreReloadedPlugin({ state, id, workspaceId: row.workspaceId });
    throw error;
  }
}

async function assertReloadApproved<E, O>({ id, enabledCount, discovery, state, readApproval }: RuntimeArgs<E, O> & {
  id: string; enabledCount: number; discovery: readonly PluginDiscoveryRecord[];
  readApproval: (input: { id: string }) => ReturnType<PluginSourcePort["readApproval"]>;
}, _options = {}): Promise<void> {
  // Consent gap (2026-10-12): a re-seal that widens what a running plugin can reach waits for
  // the owner. Thrown here, the source service reports it as reloadError and keeps every
  // retained version; the approved version keeps running until the owner re-approves it.
  const next = discovery.find(record => record.id === id)?.manifest;
  const added = enabledCount > 0 && next ? addedPluginCapabilities({ approved: await readApproval({ id }), next: pluginCapabilitySet({ manifest: next }) }) : [];
  if (added.length > 0) throw new Error(state.required.text.reloadApprovalRequired({ added }));
}

async function restoreReloadedPlugin<E, O>({ state, id, workspaceId }: RuntimeArgs<E, O> & { id: string; workspaceId: string }, _options = {}): Promise<void> {
  // setPluginEnabled already restored the old activation row. Re-enter the same loader
  // to pin its retained bytes, rather than turning a working plugin off for a bad update.
  try { await onPluginEnabled({ state, pluginId: id }); }
  catch (rollbackError) {
    console.warn(`[plugin-runtime] Plugin '${id}' restored-version reload failed`, describeErrorForLog({ err: rollbackError }));
    onPluginDisabled({ state, pluginId: id });
    await quarantinePlugin({ deps: state.quarantineDeps, input: { pluginId: id, workspaceId, consecutiveFailures: 0, reason: state.required.text.restoreFailedReason } });
  }
}

/** The reload callback: approval gate, then every enabled row (this workspace first) re-enters the loader. */
async function reloadPlugin<E, O>({ state, id, readApproval }: RuntimeArgs<E, O> & { id: string; readApproval: (input: { id: string }) => ReturnType<PluginSourcePort["readApproval"]> }, _options = {}): Promise<boolean> {
  const enabled = (await state.required.activationRepo.listAll()).filter(row => row.pluginId === id && row.enabled);
  const discovery = await discoverPlugins({ state });
  await assertReloadApproved({ state, id, enabledCount: enabled.length, discovery, readApproval });
  // Load here before publishing active pointers to other processes. Their existing poll sees
  // a version change and re-enters the same validated loader, replacing module snapshots.
  enabled.sort((a, b) => Number(b.workspaceId === state.required.workspaceId) - Number(a.workspaceId === state.required.workspaceId));
  for (const row of enabled) {
    await reloadActivation({ state, row, id, discovery });
  }
  return enabled.some(row => row.workspaceId === state.required.workspaceId);
}

export function composeSourceService<E, O>({ state, pluginInstaller }: RuntimeArgs<E, O> & { pluginInstaller: PluginInstallerPort | undefined }, _options = {}): PluginSourcePort | undefined {
  const { installDir } = state;
  if (installDir === undefined || pluginInstaller === undefined) return undefined;
  const { activationRepo, sources } = state.required;
  const service: PluginSourcePort = createPluginSourceService({
    ...state.runtimeBinding, installDir, installer: pluginInstaller, policy: state.required.pluginSourcePolicy,
    pruneVersions: ({ id }) => pruneSitePluginVersions({ id, installDir, repo: activationRepo }),
    builtInIds: sources.map(source => source.manifest.id),
    scaffoldEntry: state.required.text.scaffoldEntry,
    reload: ({ id }) => reloadPlugin({ state, id, readApproval: (input) => service.readApproval(input, {}) }),
  });
  return service;
}
