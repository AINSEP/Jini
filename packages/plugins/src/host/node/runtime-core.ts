/**
 * @file The plugin-owned runtime core: discovery, conflict gates, enable/load/attach, boot re-attach,
 * provider admission, install/source/reload wiring and package-file location for ONE host runtime.
 * Moved from the host composition root (extract-s6 L1c; seamed in place in L1b) with its original
 * text. Every host value (env/policy, Tier-2 runner and worker entry, SDK binding, importer, archive
 * reader, telemetry vocabulary, lookup/admission and wording) is a required or optional input.
 * @agent-note Second-host rule: a host calls {@link createPluginRuntimeCore} once per runtime and wires
 * its own values; nothing here reads env, names a host tool/route/manifest file, or imports a host.
 */
import { lstat } from "node:fs/promises";
import path from "node:path";
import type { PluginDiscoveryRecord } from "../discovery-types.js";
import { readPluginPackageFiles as readPluginPackageDirectory, type PluginPackageFiles } from "./package-files.js";
import type { PluginRuntimeCoreRequired, PluginRuntimeCoreOptional, PluginRuntimeCoreBindings } from "./runtime-contracts.js";
import { SAFE_PLUGIN_ID_SEGMENT, PluginUninstallPathError, resolvePackageLocation } from "./runtime-package-location.js";
import { disposeRuntime, onPluginDisabled, onPluginEnabled, quarantineHookFailure } from "./runtime-activation.js";
import { attachEnabledPluginsAtBoot, listProviderPlugins, loadProviderPlugins } from "./runtime-boot.js";
import { discoverActivePlugins, discoverPlugins, listPluginConflicts } from "./runtime-conflicts.js";
import { composeSourceService, createPluginInstaller } from "./runtime-reload.js";
import { createRuntimeState, type RuntimeState } from "./runtime-state.js";

/**
 * The plugin-owned runtime algorithm behind the host's composition wrapper (extract-s6 L1b seam,
 * moved here in L1c). Reads no host module: every host value arrives through
 * {@link PluginRuntimeCoreRequired}/{@link PluginRuntimeCoreOptional}.
 * @agent-note Callback order is unchanged: quarantine writes the activation row, then telemetry;
 * enable loads (integrity, sdkRange, resolver, import, setup) before attach; a disable or newer
 * load during import retires the older epoch.
 * @agent-note Shared state: ONE `activationRepo`/`workspaceId`, ONE hook registry (save AND preview),
 * ONE contribution and provider registry and ONE pending-attachment set per call; the host must not
 * build a second registry or queue beside it. Each plugin load asks the host's
 * `hostBinding.createInvocationCoreDeps` once, so there is exactly one invocation AsyncLocalStorage
 * per load.
 * @agent-note Lifecycle: `dispose()` sets closing, drains pending attachments, then releases module
 * snapshots; attachments refused after that reject with `PluginSnapshotLifecycleError`. Load epochs
 * retire stale generations; version pins come from enabled activation rows (never fall forward).
 * @agent-note Reload: a source reload that widens capabilities throws the host's
 * `text.reloadApprovalRequired` and keeps the approved version running; a failed reload re-enters the
 * same loader for the restored row, and if that fails too the plugin is quarantined with
 * `text.restoreFailedReason`.
 * @agent-note Import order: `loadPlugin()` runs integrity and `sdkRange` before the importer; a Tier-2
 * plugin is never imported in-process (the host runner registers its SDK resolver before importing).
 * Preview (`previewPluginBeforeSave`) writes nothing and counts nothing toward quarantine.
 * @agent-note The host owns the SDK binding, the Tier-2 worker entry/runner/timeout, env and source
 * policy, telemetry vocabulary, lookup/admission and all wording. Errors keep their identity:
 * `PluginLoadError`, `PluginConflictError`, `PluginSnapshotLifecycleError`, `PluginPackagePathError`
 * and {@link PluginUninstallPathError} are thrown as the same classes the package exports.
 * @example createPluginRuntimeCore({ workspaceId, clock, activationRepo, sources, pluginSourcePolicy, tier2CallRunner, pluginSdkBinding, hostBinding, createModuleImporter, text, quarantineTelemetry }, { installDir })
 */
export function createPluginRuntimeCore<TEvent, TOptions>(
  required: PluginRuntimeCoreRequired<TEvent, TOptions>,
  optional: PluginRuntimeCoreOptional<TEvent, TOptions> = {},
): PluginRuntimeCoreBindings {
  const state: RuntimeState<TEvent, TOptions> = createRuntimeState({
    required, optional, onHookQuarantine: (input) => quarantineHookFailure({ state, input }),
  });
  const pluginInstaller = createPluginInstaller({ state });
  const pluginSource = composeSourceService({ state, pluginInstaller });
  return bindRuntime({ state, pluginInstaller, pluginSource });
}

/** The public bindings: each phase helper partially applied to the one shared state. */
function bindRuntime<TEvent, TOptions>({ state, pluginInstaller, pluginSource }: {
  state: RuntimeState<TEvent, TOptions>;
  pluginInstaller: ReturnType<typeof createPluginInstaller>;
  pluginSource: ReturnType<typeof composeSourceService>;
}, _options = {}): PluginRuntimeCoreBindings {
  const { hookRegistry } = state;
  return {
    dispose: async (input, options = {}) => disposeRuntime({ state, input }, options),
    browserProviders: () => ({ generation: state.browserGeneration, providers: [...state.browserProviders.values()].flat() }),
    ...(pluginInstaller === undefined ? {} : { pluginInstaller }),
    ...(pluginSource === undefined ? {} : { pluginSource }),
    pluginSourcePolicy: state.required.pluginSourcePolicy,
    pluginLoadedVersion: ({ id }) => state.loadedVersions.get(id),
    hookRegistry,
    pluginContributions: state.pluginContributions,
    providerContributions: state.providerContributions,
    loadProviderPlugins: (input, options) => loadProviderPlugins({ state, ...input }, options),
    listProviderPlugins: (_required, _options) => listProviderPlugins({ state }),
    discoverPlugins: () => discoverPlugins({ state }),
    discoverActivePlugins: () => discoverActivePlugins({ state }),
    onPluginEnabled: (pluginId) => onPluginEnabled({ state, pluginId }),
    onPluginDisabled: (pluginId) => onPluginDisabled({ state, pluginId }),
    locatePluginPackageDirs: (pluginId) => locatePluginPackageDirs({ installDir: state.installDir, pluginId }),
    readPluginPackageFiles: (record) => readPluginPackageFiles({ state, record }),
    beforeSaveHook: (entry) => hookRegistry.runBeforeSave({ entry }),
    previewPluginBeforeSave: (pluginId, entry) => hookRegistry.previewBeforeSave({ pluginId, entry }),
    attachEnabledPluginsAtBoot: () => attachEnabledPluginsAtBoot({ state }),
    listPluginConflicts: () => listPluginConflicts({ state }),
  };
}

/** Decision: the live and parked directories for `pluginId`, both proven to stay inside their roots. */
function resolveUninstallPaths({ installDir, pluginId }: { installDir: string; pluginId: string }, _options = {}) {
  if (!SAFE_PLUGIN_ID_SEGMENT.test(pluginId)) {
    throw new PluginUninstallPathError(pluginId);
  }
  const installRoot = path.resolve(installDir);
  const liveDir = path.resolve(installRoot, pluginId);
  if (liveDir === installRoot || !liveDir.startsWith(installRoot + path.sep)) {
    throw new PluginUninstallPathError(pluginId);
  }
  const parkedRoot = path.resolve(path.dirname(installRoot), `${path.basename(installRoot)}-trash`);
  const parkedDir = path.resolve(parkedRoot, pluginId);
  if (parkedDir === parkedRoot || !parkedDir.startsWith(parkedRoot + path.sep)) {
    throw new PluginUninstallPathError(pluginId);
  }
  return { installRoot, liveDir, parkedDir };
}

async function locatePluginPackageDirs({ installDir, pluginId }: { installDir: string | undefined; pluginId: string }, _options = {}): Promise<{
  liveParent: string;
  liveNames: readonly string[];
  parkedDir: string;
}> {
  if (installDir === undefined) {
    throw new Error(`locatePluginPackageDirs: no installDir configured for this composition root — cannot remove '${pluginId}'`);
  }
  const { installRoot, liveDir, parkedDir } = resolveUninstallPaths({ installDir, pluginId });
  const liveNames = await lstat(liveDir).then(
    () => [pluginId],
    (error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
      throw error;
    },
  );
  return { liveParent: installRoot, liveNames, parkedDir };
}

async function readPluginPackageFiles<TEvent, TOptions>({ state, record }: { state: RuntimeState<TEvent, TOptions>; record: PluginDiscoveryRecord }, _options = {}): Promise<PluginPackageFiles> {
  const location = resolvePackageLocation({ record, sources: state.required.sources, installDir: state.installDir });
  if (location === null) return { files: [], truncated: false };
  return readPluginPackageDirectory({ input: location });
}
