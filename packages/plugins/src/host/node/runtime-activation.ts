/**
 * @file Activation and disposal phases of the plugin runtime core (G08 split): enable, load + attach,
 * publish, disable and shutdown drain. Pure gate decisions (`assert*`) are separate from the effects
 * that mutate the shared {@link RuntimeState}.
 * @agent-note Callback order is unchanged: quarantine writes the activation row, then telemetry;
 * enable loads (integrity, sdkRange, resolver, import, setup) before attach; a disable or newer
 * load during import retires the older epoch.
 * @agent-note Lifecycle: `disposeRuntime` sets closing, drains pending attachments, then releases module
 * snapshots; attachments refused after that reject with `PluginSnapshotLifecycleError`.
 */
import type { PluginSdk } from "@jini-ai/core/contracts/plugin-sdk";
import { createPluginLookupFacade } from "@jini-ai/core/plugin-directory";
import { createPluginContributionCapture } from "../contributions.js";
import type { AdmittedBrowserProvider } from "../browser-providers.js";
import { enableDeclaredPlugin } from "../declarative-enable.js";
import type { PluginDiscoveryRecord } from "../discovery-types.js";
import type { AttachmentSource } from "../hook-registry.js";
import type { PluginManifest } from "../manifest-types.js";
import { quarantinePlugin } from "../quarantine.js";
import { attachLoadedPlugin } from "../attach-loaded-plugin.js";
import { assertPluginInstallIdle } from "./install.js";
import { PluginSnapshotLifecycleError } from "./module-snapshot.js";
import { loadPlugin, PluginLoadError } from "./loader.js";
import { createTier2ImportSeam } from "../worker/import-seam.js";
import { resolveLoadTarget, declaresProviders, withRegisteredPackageRoot, type PluginLoadTarget } from "./runtime-load-target.js";
import { assertNoConflicts, discoverActivePlugins } from "./runtime-conflicts.js";
import type { RuntimeState } from "./runtime-state.js";

type Contributions = ReturnType<ReturnType<typeof createPluginContributionCapture>["seal"]>;
type Capture = ReturnType<typeof createPluginContributionCapture>;
type Invocation = ReturnType<RuntimeState<unknown, unknown>["runtimeBinding"]["createInvocationCoreDeps"]>;

/** The hook registry's failure handler: disable the plugin's live state, then write the quarantine row. */
export async function quarantineHookFailure<E, O>(
  { state, input }: { state: RuntimeState<E, O>; input: { pluginId: string; workspaceId: string; consecutiveFailures: number; reason: string } },
  _options = {},
): Promise<void> {
  onPluginDisabled({ state, pluginId: input.pluginId });
  await quarantinePlugin({ deps: state.quarantineDeps, input });
}

export async function onPluginEnabled<E, O>({ state, pluginId }: { state: RuntimeState<E, O>; pluginId: string }, _options = {}): Promise<void> {
  const { installDir, required, optional, runtimeBinding } = state;
  // A package replacement and an enable cannot race: save-before-callback activation is
  // compensated if install owns the directory lock, while installs refuse an enabled row.
  if (installDir !== undefined) await assertPluginInstallIdle({ installDir });
  const discovery = await discoverActivePlugins({ state });
  const record = discovery.find((candidate) => candidate.id === pluginId);
  if (!record) {
    throw new PluginLoadError(pluginId, "PLUGIN_EXPORT_INVALID");
  }
  await assertNoConflicts({ state, pluginId, discovery });
  // Provider plugins initialize once, at boot, before application work (`loadProviderPlugins`).
  if (declaresProviders({ manifest: record.manifest })) return undefined;
  // No manifest ⇒ an invalid record: `attachPlugin`'s own fail-closed path reports it.
  if (!record.manifest) return attachPlugin({ state, pluginId, record });
  // Declared contributions (AW-7 Tier 1) are applied only now, after the conflict gate; a tier-1
  // plugin's `loadCode` is never called.
  await enableDeclaredPlugin(
    { ...runtimeBinding, pluginId, workspaceId: required.workspaceId, manifest: record.manifest, loadCode: () => attachPlugin({ state, pluginId, record }), unloadCode: () => onPluginDisabled({ state, pluginId }) },
    optional.declaredContentTypes ? { contentTypes: optional.declaredContentTypes } : {},
  );
  state.loadedVersions.set(pluginId, record.version);
  return undefined;
}

/** Load + attach one already-cleared plugin — `onPluginEnabled`'s body after its gates, shared
 * with boot, which clears every enabled plugin in ONE pass instead (see
 * `attachEnabledPluginsAtBoot`: per-plugin "candidate last" ordering would refuse the older
 * winner of a boot-time pair as well as the newer one). */
export function attachPlugin<E, O>({ state, pluginId, record }: { state: RuntimeState<E, O>; pluginId: string; record: PluginDiscoveryRecord }, _options = {}): Promise<void> {
  if (state.closing) return Promise.reject(new PluginSnapshotLifecycleError({ code: "SNAPSHOTS_CLOSED" }));
  const attachment = performPluginAttachment({ state, pluginId, record });
  state.pendingAttachments.add(attachment);
  void attachment.then(() => state.pendingAttachments.delete(attachment), () => state.pendingAttachments.delete(attachment));
  return attachment;
}

/** Shutdown: refuse new attachments, drain in-flight ones, then release the module snapshots. */
export async function disposeRuntime<E, O>(
  { state, input }: { state: RuntimeState<E, O>; input: Parameters<NonNullable<RuntimeState<E, O>["snapshots"]>["dispose"]>[0] },
  options: Parameters<NonNullable<RuntimeState<E, O>["snapshots"]>["dispose"]>[1] = {},
): Promise<void> {
  state.closing = true;
  await Promise.allSettled([...state.pendingAttachments]);
  await state.snapshots?.dispose(input, options);
}

/** Keep import and setup in the same shutdown drain: setup may make late graph imports too. */
async function performPluginAttachment<E, O>({ state, pluginId, record }: { state: RuntimeState<E, O>; pluginId: string; record: PluginDiscoveryRecord }, _options = {}): Promise<void> {
  const { epoch, target, invocation, capture } = beginAttachment({ state, pluginId, record });
  const { manifest, attachmentSource } = target;
  const sdkSlot: { sdk: PluginSdk | undefined } = { sdk: undefined };
  const result = await loadPlugin(buildLoadInput({ state, record, target, invocation, capture, sdkSlot }), state.runtimeBinding);
  if (!result.loaded) {
    throw new PluginLoadError(pluginId, result.reason);
  }

  // A disable or a newer load during import/setup must not resurrect the retired generation.
  const scopedSdk = assertAttachmentCurrent({ state, pluginId, epoch, scopedSdk: sdkSlot.sdk });
  const contributions = capture.seal({ sdk: scopedSdk });
  const filter = invocation.capturedFilter();
  assertBeforeSaveFilterAttached({ state, pluginId, manifest, filter });
  publishPluginAttachment({ state, pluginId, manifest, attachmentSource, filter, contributions,
    providers: result.browserProviders ?? [], version: record.version });
}

/** Bump the load epoch (retiring any older generation), then resolve what to load. */
function beginAttachment<E, O>({ state, pluginId, record }: { state: RuntimeState<E, O>; pluginId: string; record: PluginDiscoveryRecord }, _options = {}) {
  const epoch = (state.loadEpochs.get(pluginId) ?? 0) + 1;
  state.loadEpochs.set(pluginId, epoch);
  const target = resolveLoadTarget({ pluginId, sources: state.required.sources, record, installDir: state.installDir });
  if (!target) {
    throw new PluginLoadError(pluginId, "PLUGIN_EXPORT_INVALID");
  }
  // The SDK backing (content.read/extend bound to the running filter, single declared beforeSave
  // filter) is shared with the Tier-2 worker — see `invocation-core-deps.ts`.
  const invocation = state.runtimeBinding.createInvocationCoreDeps({ pluginId, declaredHooks: target.manifest.hooks });
  const capture = createPluginContributionCapture({ manifest: target.manifest });
  return { epoch, target, invocation, capture };
}

/** The `loadPlugin` argument for one attachment. `sdkSlot` receives the scoped SDK the plugin was built with. */
function buildLoadInput<E, O>({ state, record, target, invocation, capture, sdkSlot }: {
  state: RuntimeState<E, O>; record: PluginDiscoveryRecord; target: PluginLoadTarget; invocation: Invocation; capture: Capture;
  sdkSlot: { sdk: PluginSdk | undefined };
}, _options = {}): Parameters<typeof loadPlugin>[0] {
  const { runtimeBinding, optional } = state;
  const { manifest, entryPath } = target;
  const coreDeps = { ...invocation.coreDeps, contributions: capture };
  // The importer FACTORY runs here, before loadPlugin's integrity/sdkRange checks, so
  // it must stay inert; loadPlugin invokes the returned importer only after those checks. A site
  // target takes the contained immutable snapshot; built-in seams retain their original path.
  const moduleImporter = resolveRuntimeImporter({ state, target, record });
  return { ...runtimeBinding, record, manifest, entryPath, coreDeps, importModule: moduleImporter,
    browserProviderApprovals: optional.browserProviderApprovals ?? [],
    providerContributions: { registry: state.providerContributions, isSelected: ({ pluginId: id }) => state.selectedProviders.has(id) },
    pluginSdkBinding: { ...runtimeBinding.pluginSdkBinding,
      buildSdk: ({ sdk }) => {
        const host = optional.lookup?.();
        sdkSlot.sdk = { ...runtimeBinding.pluginSdkBinding.buildSdk({ sdk }),
          ...(host ? { plugins: createPluginLookupFacade({ lookup: host }) } : {}),
        };
        return sdkSlot.sdk;
      },
    },
  };
}

/** Decision: the attachment is still the newest generation and produced an SDK, else the setup failed. */
function assertAttachmentCurrent<E, O>({ state, pluginId, epoch, scopedSdk }: { state: RuntimeState<E, O>; pluginId: string; epoch: number; scopedSdk: PluginSdk | undefined }, _options = {}): PluginSdk {
  if (state.loadEpochs.get(pluginId) !== epoch || !scopedSdk) throw new PluginLoadError(pluginId, 'PLUGIN_SETUP_FAILED');
  return scopedSdk;
}

/** Decision: a plugin that declares the beforeSave hook must actually have attached its filter. */
function assertBeforeSaveFilterAttached<E, O>({ state, pluginId, manifest, filter }: { state: RuntimeState<E, O>; pluginId: string; manifest: PluginManifest; filter: unknown }, _options = {}): void {
  if (manifest.hooks.includes(state.required.pluginSdkBinding.beforeSaveHook) && filter === null) {
    throw new PluginLoadError(pluginId, "PLUGIN_HOOK_NOT_ATTACHED");
  }
}

function resolveRuntimeImporter<E, O>({ state, target, record }: { state: RuntimeState<E, O>; target: PluginLoadTarget; record: PluginDiscoveryRecord }, _options = {}) {
  const { snapshots } = state;
  // Tier 2: the plugin's code must never be imported into this process. Its
  // import seam probes it in a fresh worker and hands `loadPlugin()` a proxy whose filter is an
  // RPC; supplied as `loadPlugin()`'s required `importModule` port, so integrity + sdkRange
  // still run first. Only a built-in reaches here as tier-2: discovery marks a site
  // tier-2 package invalid (the worker is no sandbox yet). Were site tier-2 ever allowed, its worker
  // would need the seam's `resolveWorkerEntry` pointed at the integrity-checked module snapshot,
  // since an injected worker seam bypasses the host's default snapshot importer.
  return target.manifest.tier === "tier-2"
    ? withRegisteredPackageRoot({ importModule: createTier2ImportSeam({ ...state.runtimeBinding, manifest: target.manifest, runCall: state.required.tier2CallRunner }), packageRoot: target.packageRoot })
    : state.required.createModuleImporter({ manifest: target.manifest, source: record.source }, {
        legacyManifestFilenames: state.runtimeBinding.legacyManifestFilenames,
        ...(target.importModule === undefined ? {} : { importModule: target.importModule }),
        ...(snapshots === undefined ? {} : { snapshots }),
      });
}

function publishPluginAttachment<E, O>({ state, pluginId, manifest, attachmentSource, filter, contributions, providers, version }: {
  state: RuntimeState<E, O>; pluginId: string; manifest: PluginManifest; attachmentSource: AttachmentSource;
  filter: Parameters<typeof attachLoadedPlugin>[0]["filter"] | null;
  contributions: Contributions;
  providers: readonly AdmittedBrowserProvider[]; version: string;
}, _options = {}): void {
  const { hookRegistry, pluginContributions, loadedVersions } = state;
  if (filter === null) {
    pluginContributions.replace({ contributions });
    retainBrowserProviders({ state, pluginId, providers });
    hookRegistry.detach({ pluginId });
    loadedVersions.set(pluginId, version);
    return;
  }

  try {
    attachLoadedPlugin({
      pluginId,
      source: attachmentSource,
      hookRegistry,
      filter,
      declaredFields: manifest.fields,
    });
    pluginContributions.replace({ contributions });
    retainBrowserProviders({ state, pluginId, providers });
    loadedVersions.set(pluginId, version);
  } catch (error) {
    hookRegistry.detach({ pluginId });
    throw new PluginLoadError(pluginId, "PLUGIN_HOOK_ATTACH_FAILED", { cause: error });
  }
}

/** Publish admission only after successful attachment; no partial setup can leak assets.
 * @complexity O(1) map replacement; Jini already owns the immutable asset bytes.
 */
function retainBrowserProviders<E, O>({ state, pluginId, providers }: { state: RuntimeState<E, O>; pluginId: string; providers: readonly AdmittedBrowserProvider[] }, _options = {}): void {
  if (providers.length === 0 && !state.browserProviders.has(pluginId)) return;
  state.browserProviders.set(pluginId, providers);
  state.browserGeneration++;
}

export function onPluginDisabled<E, O>({ state, pluginId }: { state: RuntimeState<E, O>; pluginId: string }, _options = {}): void {
  if (state.browserProviders.delete(pluginId)) state.browserGeneration++;
  state.loadEpochs.set(pluginId, (state.loadEpochs.get(pluginId) ?? 0) + 1);
  state.pluginContributions.detach({ pluginId });
  // Retires the provider generation: the provider host disposes its initialized resources.
  state.selectedProviders.delete(pluginId);
  state.providerContributions.detach({ pluginId });
  state.hookRegistry.detach({ pluginId });
  state.loadedVersions.delete(pluginId);
}
