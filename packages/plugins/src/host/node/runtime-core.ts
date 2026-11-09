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
import { createPluginLookupFacade, type PluginLookupPort } from "@jini-ai/core/plugin-directory";
import type { Clock as ClockPort } from "@jini-ai/core/primitives";
import { setPluginEnabled, type PluginActivationRepoPort } from "../activation.js";
import { initializeBundledPlugins } from "../bundled-initialization.js";
import { createPluginContributionCapture, createPluginContributionRegistry, type PluginContributionRegistry } from "../contributions.js";
import type { AdmittedBrowserProvider } from "../browser-providers.js";
import type { ArchiveReaderPort, BundledBrowserProviderApproval, DeclarativeContentTypesPort, DeclaredContentTypePorts, PluginModuleImportPort, PluginSdk, PluginSdkBinding, PluginTierPolicy, VerifyDigestPort } from "../ports.js";
import { addedPluginCapabilities, pluginCapabilitySet, type PluginSourcePolicyPort } from "../source-policy.js";
import { enableDeclaredPlugin } from "../declarative-enable.js";
import type { BuiltInPluginSource, PluginDiscoveryRecord } from "../discovery-types.js";
import { createHookRegistry, type AttachmentSource, type HookRegistry } from "../hook-registry.js";
import type { PluginManifest } from "../manifest-types.js";
import { quarantinePlugin } from "../quarantine.js";
import type { ExtensionClaim } from "../claim-conflicts.js";
import { describeBootConflictQuarantine, PluginConflictError, resolvePluginConflicts, type PluginConflict } from "../plugin-claims.js";
import { attachLoadedPlugin } from "../attach-loaded-plugin.js";
import { assertPluginInstallIdle, installSitePlugin, previewSitePluginInstall, pruneSitePluginVersions, type PluginInstallerPort } from "./install.js";
import { createPluginModuleSnapshotLifecycle, PluginSnapshotLifecycleError } from "./module-snapshot.js";
import { createPluginSourceService, type PluginSourcePort } from "./source-drafts.js";
import { discoverPlugins as discoverPluginRuntimePlugins, siteEntryPath } from "./discovery.js";
import { PluginPackagePathError, readPluginPackageFiles as readPluginPackageDirectory, type PluginPackageFiles } from "./package-files.js";
import { loadPlugin, PluginLoadError } from "./loader.js";
import { createTier2ImportSeam } from "../worker/import-seam.js";
import type { Tier2CallRunner } from "../worker/protocol.js";
import type { RunTier2CallRequired } from "../worker/run-call.js";

/** Executable metadata for one compiled-in plugin. Discovery consumes only `manifest`; the enable
 * callback consumes the import seam after integrity/sdkRange checks. Site-artifact sources can use
 * the same shape once their install-dir resolver is composed here.
 * @agent-note `importModule` is reached only through `loadPlugin()` after integrity and `sdkRange`
 * passed; the host owns the entry path and importer. */
export interface PluginRuntimeSource extends BuiltInPluginSource {
  readonly source: "built-in";
  readonly entryPath: string;
  readonly importModule: (entryPath: string) => Promise<unknown>;
  /** The built-in's own source folder, shown read-only by the admin Plugins screen's
   * package-files viewer (a host route). Omitted ⇒ that viewer lists no files. */
  readonly sourceDir?: string;
}

/** What `loadPlugin()` and `attachLoadedPlugin()` need for one enable attempt, resolved by
 * {@link resolveLoadTarget}. `importModule` is omitted (not `undefined`-valued) for a site target
 * so the host binding supplies the contained snapshot importer; only a built-in target carries
 * an explicit scalar override (its test/production seam, unchanged by this type). */
interface PluginLoadTarget {
  readonly manifest: PluginManifest;
  readonly entryPath: string;
  readonly attachmentSource: AttachmentSource;
  readonly importModule?: (entryPath: string) => Promise<unknown>;
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
 * CIC U-001 requires them, inside `loadPlugin()`'s own fixed step order. This function only decides
 * WHICH manifest/entryPath/import-hook `loadPlugin()` is handed; it never calls `import()` itself
 * and never lets a caller reach one without going through `loadPlugin()`'s ordering first.
 *
 * @returns `null` when the id is neither a known built-in nor a valid, installDir-reachable site
 * record — the caller's existing fail-closed `PLUGIN_EXPORT_INVALID` behavior is unchanged.
 * @complexity O(sources.length) — one linear scan of the static built-in list; no I/O of its own.
 */
function resolveLoadTarget(params: {
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
const SAFE_PLUGIN_ID_SEGMENT = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

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
function resolvePackageLocation(params: {
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

/** What {@link createPluginRuntimeCore} returns: one runtime's shared handles.
 * @agent-note Every member closes over the SAME repo, workspace, hook/contribution/provider registries
 * and pending-attachment set; hosts adapt members (e.g. positional SDK types) without rebuilding them. */
export interface PluginRuntimeCoreBindings {
  /** Call after provider teardown and stopped hook users; drains copies and releases owned graphs. */
  readonly dispose: (required: Record<string, never>, optional?: Record<string, never>) => Promise<void>;
  /** Successfully attached, admitted providers only; disable/quarantine retires their assets. */
  readonly browserProviders: (input: Record<string, never>, options?: Record<string, never>) => { generation: number; providers: readonly AdmittedBrowserProvider[] };
  readonly pluginSource?: PluginSourcePort;
  readonly pluginSourcePolicy: PluginSourcePolicyPort;
  /** Actual loaded snapshot revision, used by the existing cross-process activation poll. */
  readonly pluginLoadedVersion: (required: { id: string }, optional?: Record<string, never>) => string | undefined;
  readonly pluginInstaller?: PluginInstallerPort;
  readonly hookRegistry: HookRegistry;
  readonly pluginContributions: PluginContributionRegistry;
  /** Provider factories of admitted provider plugins only (`createPluginProviderHost` reads this).
   * Separate from `pluginContributions`, whose route/tool/widget snapshots carry no providers. */
  readonly providerContributions: PluginContributionRegistry;
  /**
   * Boot-only: loads the given provider plugins when each is installed and enabled here, admitting
   * their factories into `providerContributions`. Provider plugins are loaded nowhere else (boot
   * re-attach and enable skip them), so a running provider is never replaced mid-process; enabling
   * one takes effect at the next boot, disabling or quarantining one retires it immediately.
   * @returns The ids actually loaded. Per-plugin failures are logged and skipped, never thrown.
   */
  readonly loadProviderPlugins: (required: { pluginIds: readonly string[] }, optional?: { timeoutMs?: number }) => Promise<readonly string[]>;
  /** Installed + enabled plugins here that declare providers, with their declarations (manifest only). */
  readonly listProviderPlugins: (required: Record<string, never>, optional?: Record<string, never>) => Promise<readonly { pluginId: string; providers: NonNullable<NonNullable<PluginManifest["contributes"]>["providers"]> }[]>;
  readonly discoverPlugins: () => Promise<readonly PluginDiscoveryRecord[]>;
  /** Discovery with the enabled activations' version pins: the versions boot runs (a pin never falls forward). */
  readonly discoverActivePlugins: () => Promise<readonly PluginDiscoveryRecord[]>;
  readonly onPluginEnabled: (pluginId: string) => Promise<void>;
  readonly onPluginDisabled: (pluginId: string) => void;
  readonly locatePluginPackageDirs: (pluginId: string) => Promise<{
    liveParent: string;
    liveNames: readonly string[];
    parkedDir: string;
  }>;
  /** Lists one discovered plugin's own files, read-only and bounded, for the admin Plugins
   * screen's package-files viewer — see {@link resolvePackageLocation} and
   * `Jini/packages/plugins/src/host/node/package-files.ts`. Rejects with `PluginPackagePathError` for an
   * unsafe id/version or a directory that resolves outside its container. */
  readonly readPluginPackageFiles: (record: PluginDiscoveryRecord) => Promise<PluginPackageFiles>;
  /** @agent-note Positional adapter over the shared hook registry; the entry object is passed
   * through untouched so every host payload field reaches each filter. */
  readonly beforeSaveHook: (entry: Parameters<HookRegistry["runBeforeSave"]>[0]["entry"]) => ReturnType<HookRegistry["runBeforeSave"]>;
  /** Admin preview (AW-7): one attached plugin's beforeSave patch for a draft, nothing saved or
   * counted toward quarantine. `null` ⇒ not attached. See `HookRegistry.previewBeforeSave`.
   * @agent-note Preview writes nothing and counts nothing toward quarantine. */
  readonly previewPluginBeforeSave: (pluginId: string, entry: Parameters<HookRegistry["previewBeforeSave"]>[0]["entry"]) => ReturnType<HookRegistry["previewBeforeSave"]>;
  /**
   * P0a fix (2026-09-23): re-runs `onPluginEnabled` for every plugin `activationRepo` durably
   * marks `enabled` for THIS composition's `workspaceId`. Before this existed, nothing replayed
   * that durable state into a freshly-constructed (empty) `hookRegistry` — a plugin enabled in a
   * prior process looked enabled in the admin UI and in `listAll()`, but its filter/action/
   * contribution never fired again until an operator disabled and re-enabled it. Best-effort: one
   * plugin failing to re-attach (e.g. its package was removed from disk) is logged and skipped, not
   * thrown, so it can never block the rest of boot (mirrors `seedBundledAgentPlugins`'s own
   * per-package isolation).
   */
  readonly attachEnabledPluginsAtBoot: () => Promise<void>;
  /** Every discovered plugin that has a name conflict right now — an enabled loser, or a plugin that
   * is off and WOULD be refused if turned on — for the admin screen and the host's plugin-list tool. See
   * `Jini/packages/plugins/src/host/plugin-claims.ts`'s `resolvePluginConflicts`. */
  readonly listPluginConflicts: () => Promise<ReadonlyMap<string, readonly PluginConflict[]>>;
}


/**
 * The host bag spread into discovery, conflicts, enable, load, the Tier-2 seam, install and the
 * source service. Extract-s6 L1b: a local port so the runtime core imports no host module.
 * @agent-note Second-host rule: build ONE bag per runtime and keep it for the runtime's lifetime;
 * every member is host-owned (capability vocabulary, declared content types, core owner name,
 * identity namespace, install-disabled wording, tier policy, archive reader, digest format and the
 * per-load invocation binding factory). The archive reader is always host-supplied (no fallback).
 */
export interface PluginRuntimeHostBinding {
  readonly capabilityVocabulary: readonly string[];
  readonly declarativeContentTypes: DeclarativeContentTypesPort;
  readonly coreOwnerName: string;
  readonly identityNamespace: string;
  readonly localInstallDisabledMessage: string;
  readonly tierPolicy: PluginTierPolicy;
  readonly archiveReader: ArchiveReaderPort;
  readonly verifyDigest: VerifyDigestPort;
  readonly createInvocationCoreDeps: RunTier2CallRequired["createInvocationCoreDeps"];
}

/** Only the tracker member the runtime calls. @agent-note The host supplies the event vocabulary
 * through `quarantineTelemetry`; the runtime never names an event, user or property itself. */
export interface PluginRuntimeTracker<TEvent, TOptions> {
  capture(event: TEvent, options: TOptions): unknown;
}

/** Install admission + plugin lookup. @agent-note `withInstallIdentity` must serialize admission
 * of one candidate identity and run `run` at most once; it is read per install, never cached. */
export interface PluginRuntimeLookup extends PluginLookupPort {
  /**
   * Admits one site-runtime publisher identity, then publishes it by running `run`.
   * @agent-note Second-host rule: the runtime only names the candidate; identity custody is the
   * host's, and this port must perform the WHOLE sequence, in this order:
   * 1. take ONE lock shared by every publisher of every plugin family the host runs, across all
   *    processes that can publish into the same install (a per-process or per-family mutex is not
   *    enough: two families could then both publish the same `publisher/local` identity);
   * 2. under that lock, read a FRESH admission inventory of all families (never a cached list),
   *    including disabled installs, reserved/built-in identities and any other reservation;
   * 3. assert the candidate identity is available against that inventory, refusing a clash with any
   *    other family or owner and allowing only a permitted upgrade of the same plugin's identity;
   * 4. run `run` (which publishes the install) while STILL holding the same lock, at most once,
   *    and release the lock only after it settles. The site installer itself checks only its own
   *    install directory and built-ins; it cannot see another family's reservation.
   */
  withInstallIdentity<T>(required: { candidate: { id: string; localId: string; family: "site-runtime" }; run: () => Promise<T> }): Promise<T>;
}

/** Host wording the runtime surfaces. @agent-note Exact host bytes; names of host tools, manifest
 * file names and route prefixes live here, never in the runtime. */
export interface PluginRuntimeText {
  /** Source written to a new local plugin draft. */
  readonly scaffoldEntry: string;
  /** Reload refusal when a re-sealed version widens capabilities (`added` in manifest order). */
  readonly reloadApprovalRequired: (required: { added: readonly string[] }) => string;
  /** Quarantine reason when a source reload and the restored-version reload both failed. */
  readonly restoreFailedReason: string;
}

/**
 * Required inputs of the plugin-owned runtime core (extract-s6 L1b seam; moved here in L1c).
 * @agent-note Second-host rule: `pluginSourcePolicy`, `tier2CallRunner` and `pluginSdkBinding` have
 * NO defaults here — the host owns env/policy, the worker entry/runner/timeout, and the SDK (hook
 * ids, version, `beforeSaveHook`). `activationRepo` and the hook registry built here are shared by
 * save AND preview of this one runtime. The Tier-2 runner must register its SDK resolver before
 * importing. `createModuleImporter` is two-stage; see its own note.
 */
export interface PluginRuntimeCoreRequired<TEvent = unknown, TOptions = unknown> {
  readonly workspaceId: string;
  readonly clock: ClockPort;
  readonly activationRepo: PluginActivationRepoPort;
  readonly sources: readonly PluginRuntimeSource[];
  readonly pluginSourcePolicy: PluginSourcePolicyPort;
  readonly tier2CallRunner: Tier2CallRunner;
  readonly pluginSdkBinding: PluginSdkBinding;
  readonly hostBinding: PluginRuntimeHostBinding;
  /**
   * Builds the module importer for one load target.
   * @agent-note Second-host rule: two stages, with different guarantees.
   * 1. Factory call: the runtime calls this while preparing the `loadPlugin` arguments, BEFORE that
   *    load's integrity and `sdkRange` checks run, and possibly for a package those checks then
   *    reject. The call must therefore only build a closure: no import, no snapshot, no file read,
   *    no executable loading of any kind.
   * 2. Returned importer: invoked by the loader only AFTER admission (integrity, `sdkRange`). For a
   *    site package it must (a) enforce containment: the resolved entry stays inside the plugin's
   *    real package root, with links refused; (b) import a FRESH identity of the entire dependency
   *    graph on every load, never a cached module, so a replaced package never runs stale helpers;
   *    (c) keep any snapshot it takes, when `snapshots` is given, alive for late/lazy imports until
   *    that lifecycle is disposed. A plain cached `import()` adapter violates (b). An injected
   *    `importModule` seam (built-in, worker or test) keeps its original path.
   */
  readonly createModuleImporter: (
    required: { manifest: PluginManifest; source: "built-in" | "site" },
    optional?: { importModule?: (entryPath: string) => Promise<unknown>; snapshots?: NonNullable<ReturnType<typeof createPluginModuleSnapshotLifecycle>> },
  ) => PluginModuleImportPort;
  readonly text: PluginRuntimeText;
  /** Host projection of one quarantine into its own telemetry event; called only when `tracker` is set. */
  readonly quarantineTelemetry: (required: { pluginId: string }) => { event: TEvent; options: TOptions };
}

/** Optional inputs; each omitted value keeps the documented default.
 * @agent-note `dispose()` must run after provider teardown and stopped hook users; it drains
 * pending attachments, then releases module snapshots. Load epochs retire stale generations. */
export interface PluginRuntimeCoreOptional<TEvent = unknown, TOptions = unknown> {
  readonly tracker?: () => PluginRuntimeTracker<TEvent, TOptions>;
  readonly lookup?: () => PluginRuntimeLookup | undefined;
  readonly browserProviderApprovals?: readonly BundledBrowserProviderApproval[];
  readonly bundledEnabledIds?: readonly string[];
  readonly failureThreshold?: number;
  readonly installDir?: string;
  readonly coreClaims?: readonly ExtensionClaim[];
  readonly declaredContentTypes?: DeclaredContentTypePorts;
}

/** True when a manifest declares provider factories (`contributes.providers`). */
function declaresProviders({ manifest }: { manifest: PluginManifest | undefined }): boolean {
  return (manifest?.contributes?.providers?.length ?? 0) > 0;
}

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
  const { activationRepo, clock, sources } = required;
  const { installDir } = optional;
  const quarantineDeps = { clock, repo: activationRepo, onQuarantined: ({ pluginId }: { pluginId: string; workspaceId: string }) => {
    const tracker = optional.tracker?.();
    if (!tracker) return undefined;
    const { event, options } = required.quarantineTelemetry({ pluginId });
    return tracker.capture(event, options);
  } };
  const runtimeBinding = { ...required.hostBinding, pluginSdkBinding: required.pluginSdkBinding };
  // The install directory owns versions; its sibling runtime directory owns executable graphs.
  const snapshots = installDir === undefined ? undefined : createPluginModuleSnapshotLifecycle({ runtimeRoot: path.resolve(installDir) + "-runtime" });
  const pendingAttachments = new Set<Promise<void>>();
  let closing = false;
  const { pluginSourcePolicy } = required;
  const loadedVersions = new Map<string, string>();
  const browserProviders = new Map<string, readonly AdmittedBrowserProvider[]>();
  let browserGeneration = 0;
  const pluginContributions = createPluginContributionRegistry({});
  const providerContributions = createPluginContributionRegistry({});
  // Only boot's configured selection may admit provider factories (`loadProviderPlugins`).
  const selectedProviders = new Set<string>();
  const loadEpochs = new Map<string, number>();
  const { tier2CallRunner } = required;
  const hookRegistry = createHookRegistry({ pluginSdkBinding: required.pluginSdkBinding }, {
    ...(optional.failureThreshold === undefined ? {} : { failureThreshold: optional.failureThreshold }),
    onQuarantine: async (input) => {
      onPluginDisabled(input.pluginId);
      await quarantinePlugin({ deps: quarantineDeps, input });
    },
  });
  // Reachability fix (previously always omitted `installDir`, so a plugin placed on disk was
  // never scanned no matter how the composition root itself was configured — see this function's
  // required-params doc).
  const discoverPlugins = () =>
    discoverPluginRuntimePlugins({ ...runtimeBinding, builtIns: sources, ...(installDir === undefined ? {} : { installDir }) });

  /** Retained versions make the activation row's existing active pointer meaningful at boot
   * and reload. A newly installed version is not running until controlled reload advances it. */
  async function discoverActivePlugins(): Promise<readonly PluginDiscoveryRecord[]> {
    const rows = await activationRepo.listAll();
    const versions = new Map(rows.filter(row => row.workspaceId === required.workspaceId && row.enabled).map(row => [row.pluginId, row.version]));
    return discoverPluginRuntimePlugins({ ...runtimeBinding, builtIns: sources, ...(installDir === undefined ? {} : { installDir }) }, { versions });
  }

  const coreClaims = optional.coreClaims ?? [];

  async function listPluginConflicts(
    discovery?: readonly PluginDiscoveryRecord[],
    optional: { candidateId?: string } = {},
  ): Promise<ReadonlyMap<string, readonly PluginConflict[]>> {
    const [records, activations] = await Promise.all([discovery ?? discoverPlugins(), activationRepo.listAll()]);
    return resolvePluginConflicts({ ...runtimeBinding, workspaceId: required.workspaceId, discovery: records, activations, coreClaims }, optional);
  }

  /** Install preview (2026-10-04): what the staged package would clash with if turned on in THIS
   * workspace now. A synthetic valid record stands in for it and REPLACES an installed version of the
   * same id, so an upgrade is judged by its new manifest only. */
  async function installPreviewConflicts(required: { manifest: PluginManifest }): Promise<readonly PluginConflict[]> {
    const { manifest } = required;
    const staged: PluginDiscoveryRecord = { id: manifest.id, name: manifest.name, version: manifest.version, source: "site", tier: manifest.tier, status: "valid", errors: [], manifest };
    const discovery = [...(await discoverPlugins()).filter((record) => record.id !== manifest.id), staged];
    return (await listPluginConflicts(discovery, { candidateId: manifest.id })).get(manifest.id) ?? [];
  }

  /** Enable-time conflict gate (2026-10-04): runs before `loadPlugin()`, so a plugin that would
   * take a name core or an enabled plugin holds never has its code imported. The candidate is
   * ordered after every enabled plugin — it is the newer one by definition. */
  async function assertNoConflicts(pluginId: string, discovery: readonly PluginDiscoveryRecord[]): Promise<void> {
    const conflicts = (await listPluginConflicts(discovery, { candidateId: pluginId })).get(pluginId);
    if (conflicts) throw new PluginConflictError({ pluginId, conflicts });
  }

  async function onPluginEnabled(pluginId: string): Promise<void> {
    // A package replacement and an enable cannot race: save-before-callback activation is
    // compensated if install owns the directory lock, while installs refuse an enabled row.
    if (installDir !== undefined) await assertPluginInstallIdle({ installDir });
    const discovery = await discoverActivePlugins();
    const record = discovery.find((candidate) => candidate.id === pluginId);
    if (!record) {
      throw new PluginLoadError(pluginId, "PLUGIN_EXPORT_INVALID");
    }
    await assertNoConflicts(pluginId, discovery);
    // Provider plugins initialize once, at boot, before application work (`loadProviderPlugins`).
    if (declaresProviders({ manifest: record.manifest })) return undefined;
    // No manifest ⇒ an invalid record: `attachPlugin`'s own fail-closed path reports it.
    if (!record.manifest) return attachPlugin(pluginId, record);
    // Declared contributions (AW-7 Tier 1) are applied only now, after the conflict gate; a tier-1
    // plugin's `loadCode` is never called.
    await enableDeclaredPlugin(
      { ...runtimeBinding, pluginId, workspaceId: required.workspaceId, manifest: record.manifest, loadCode: () => attachPlugin(pluginId, record), unloadCode: () => onPluginDisabled(pluginId) },
      optional.declaredContentTypes ? { contentTypes: optional.declaredContentTypes } : {},
    );
    loadedVersions.set(pluginId, record.version);
    return undefined;
  }

  /** Load + attach one already-cleared plugin — `onPluginEnabled`'s body after its gates, shared
   * with boot, which clears every enabled plugin in ONE pass instead (see
   * `attachEnabledPluginsAtBoot`: per-plugin "candidate last" ordering would refuse the older
   * winner of a boot-time pair as well as the newer one). */
  function attachPlugin(pluginId: string, record: PluginDiscoveryRecord): Promise<void> {
    if (closing) return Promise.reject(new PluginSnapshotLifecycleError({ code: "SNAPSHOTS_CLOSED" }));
    const attachment = performPluginAttachment(pluginId, record);
    pendingAttachments.add(attachment);
    void attachment.then(() => pendingAttachments.delete(attachment), () => pendingAttachments.delete(attachment));
    return attachment;
  }

  /** Keep import and setup in the same shutdown drain: setup may make late graph imports too. */
  async function performPluginAttachment(pluginId: string, record: PluginDiscoveryRecord): Promise<void> {
    const epoch = (loadEpochs.get(pluginId) ?? 0) + 1;
    loadEpochs.set(pluginId, epoch);
    const target = resolveLoadTarget({ pluginId, sources, record, installDir });
    if (!target) {
      throw new PluginLoadError(pluginId, "PLUGIN_EXPORT_INVALID");
    }
    const { manifest, entryPath, attachmentSource } = target;
    // The SDK backing (content.read/extend bound to the running filter, single declared beforeSave
    // filter) is shared with the Tier-2 worker — see `invocation-core-deps.ts`.
    const invocation = runtimeBinding.createInvocationCoreDeps({ pluginId, declaredHooks: manifest.hooks });
    const capture = createPluginContributionCapture({ manifest });
    let scopedSdk: PluginSdk | undefined;
    const coreDeps = { ...invocation.coreDeps, contributions: capture };

    // CIC U-001: the importer FACTORY runs here, before loadPlugin's integrity/sdkRange checks, so
    // it must stay inert; loadPlugin invokes the returned importer only after those checks. A site
    // target takes the contained immutable snapshot; built-in seams retain their original path.
    const moduleImporter = resolveRuntimeImporter({ target, record });
    const result = await loadPlugin(
      { ...runtimeBinding, record, manifest, entryPath, coreDeps, importModule: moduleImporter,
        browserProviderApprovals: optional.browserProviderApprovals ?? [],
        providerContributions: { registry: providerContributions, isSelected: ({ pluginId: id }) => selectedProviders.has(id) },
        pluginSdkBinding: { ...runtimeBinding.pluginSdkBinding,
          buildSdk: ({ sdk }) => {
            const host = optional.lookup?.();
            scopedSdk = { ...runtimeBinding.pluginSdkBinding.buildSdk({ sdk }),
              ...(host ? { plugins: createPluginLookupFacade({ lookup: host }) } : {}),
            };
            return scopedSdk;
          },
        },
      },
      {},
    );
    if (!result.loaded) {
      throw new PluginLoadError(pluginId, result.reason);
    }

    // A disable or a newer load during import/setup must not resurrect the retired generation.
    if (loadEpochs.get(pluginId) !== epoch || !scopedSdk) throw new PluginLoadError(pluginId, 'PLUGIN_SETUP_FAILED');
    const contributions = capture.seal({ sdk: scopedSdk });
    const filter = invocation.capturedFilter();
    if (manifest.hooks.includes(required.pluginSdkBinding.beforeSaveHook) && filter === null) {
      throw new PluginLoadError(pluginId, "PLUGIN_HOOK_NOT_ATTACHED");
    }
    publishPluginAttachment({ pluginId, manifest, attachmentSource, filter, contributions,
      providers: result.browserProviders ?? [], version: record.version });
  }

  function resolveRuntimeImporter({ target, record }: { target: PluginLoadTarget; record: PluginDiscoveryRecord }, _options = {}) {
    // Tier 2 (ADR-024 §3/§4): the plugin's code must never be imported into this process. Its
    // import seam probes it in a fresh worker and hands `loadPlugin()` a proxy whose filter is an
    // RPC; supplied as `loadPlugin()`'s required `importModule` port, so integrity + sdkRange
    // still run first (CIC U-001). Only a built-in reaches here as tier-2: discovery marks a site
    // tier-2 package invalid (the worker is no sandbox yet). Were site tier-2 ever allowed, its worker
    // would need the seam's `resolveWorkerEntry` pointed at the integrity-checked module snapshot,
    // since an injected worker seam bypasses the host's default snapshot importer.
    return target.manifest.tier === "tier-2"
      ? createTier2ImportSeam({ ...runtimeBinding, manifest: target.manifest, runCall: tier2CallRunner })
      : required.createModuleImporter({ manifest: target.manifest, source: record.source }, {
          ...(target.importModule === undefined ? {} : { importModule: target.importModule }),
          ...(snapshots === undefined ? {} : { snapshots }),
        });
  }

  function publishPluginAttachment({ pluginId, manifest, attachmentSource, filter, contributions, providers, version }: {
    pluginId: string; manifest: PluginManifest; attachmentSource: AttachmentSource;
    filter: Parameters<typeof attachLoadedPlugin>[0]["filter"] | null;
    contributions: ReturnType<ReturnType<typeof createPluginContributionCapture>["seal"]>;
    providers: readonly AdmittedBrowserProvider[]; version: string;
  }, _options = {}): void {
    if (filter === null) {
      pluginContributions.replace({ contributions });
      retainBrowserProviders({ pluginId, providers });
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
      retainBrowserProviders({ pluginId, providers });
      loadedVersions.set(pluginId, version);
    } catch (error) {
      hookRegistry.detach({ pluginId });
      throw new PluginLoadError(pluginId, "PLUGIN_HOOK_ATTACH_FAILED", { cause: error });
    }
  }

  /** Publish admission only after successful attachment; no partial setup can leak assets.
   * @complexity O(1) map replacement; Jini already owns the immutable asset bytes.
   */
  function retainBrowserProviders({ pluginId, providers }: { pluginId: string; providers: readonly AdmittedBrowserProvider[] }): void {
    if (providers.length === 0 && !browserProviders.has(pluginId)) return;
    browserProviders.set(pluginId, providers);
    browserGeneration++;
  }

  function onPluginDisabled(pluginId: string): void {
    if (browserProviders.delete(pluginId)) browserGeneration++;
    loadEpochs.set(pluginId, (loadEpochs.get(pluginId) ?? 0) + 1);
    pluginContributions.detach({ pluginId });
    // Retires the provider generation: the provider host disposes its initialized resources.
    selectedProviders.delete(pluginId);
    providerContributions.detach({ pluginId });
    hookRegistry.detach({ pluginId });
    loadedVersions.delete(pluginId);
  }

  /** Boot-time conflict pass (2026-10-04): the newer plugin of every conflicting pair is turned off
   * through the same durable quarantine record hook failures use, with the clash as its reason, so
   * it shows on the admin row and stays off on the next boot instead of racing the older one. */
  async function quarantineConflictingAtBoot(
    conflicts: ReadonlyMap<string, readonly PluginConflict[]>,
    enabledIds: ReadonlySet<string>,
  ): Promise<ReadonlySet<string>> {
    const quarantined = new Set<string>();
    for (const [pluginId, pluginConflicts] of conflicts) {
      if (!enabledIds.has(pluginId)) continue;
      const reason = describeBootConflictQuarantine({ conflicts: pluginConflicts });
      await quarantinePlugin({ deps: quarantineDeps, input: { pluginId, workspaceId: required.workspaceId, consecutiveFailures: 0, reason } });
      onPluginDisabled(pluginId);
      // eslint-disable-next-line no-console
      console.warn(`[plugin-runtime] '${pluginId}' quarantined at boot: ${reason}`);
      quarantined.add(pluginId);
    }
    return quarantined;
  }

  async function initializeBootDefaults(_required: Record<string, never>, _options = {}) {
    // Serialize first-boot defaults with boot attachment. Existing disabled/quarantined rows win.
    const initialized = await initializeBundledPlugins({
      deps: { clock, repo: activationRepo, discovery: optional.bundledEnabledIds?.length ? await discoverPlugins().catch((error: unknown) => {
        console.warn("[plugin-runtime] bundled discovery failed; chart providers remain unavailable", error);
        return [];
      }) : [], onEnabled: onPluginEnabled, onDisabled: onPluginDisabled },
      input: { workspaceId: required.workspaceId, pluginIds: optional.bundledEnabledIds ?? [] },
    });
    for (const failure of initialized.failed) console.warn(`[plugin-runtime] bundled initialization failed for '${failure.pluginId}'`, failure.error);
    return initialized;
  }

  async function attachEnabledPluginsAtBoot(): Promise<void> {
    await snapshots?.ready;
    const initialized = await initializeBootDefaults({}, {});
    const records = await activationRepo.listAll();
    const enabledHere = records.filter(
      (record) => record.workspaceId === required.workspaceId && record.enabled
    );
    if (enabledHere.length === 0) return;
    let discovery: readonly PluginDiscoveryRecord[];
    let quarantined: ReadonlySet<string>;
    try {
      discovery = await discoverActivePlugins();
      quarantined = await quarantineConflictingAtBoot(
        await listPluginConflicts(discovery),
        new Set(enabledHere.map((record) => record.pluginId)),
      );
    } catch (error) {
      // Fail closed: without a finished conflict pass there is no telling which of two clashing
      // plugins should run, so none is attached this boot (each would previously have failed its
      // own discovery read here anyway). Logged, not thrown — same isolation as a per-plugin failure.
      // eslint-disable-next-line no-console
      console.warn(`[plugin-runtime] boot conflict check failed, no plugin attached: ${error instanceof Error ? error.message : String(error)}`);
      for (const record of enabledHere) onPluginDisabled(record.pluginId);
      return;
    }
    for (const record of enabledHere) {
      // The initializer already attached it.
      if (quarantined.has(record.pluginId) || initialized.enabled.includes(record.pluginId)) continue;
      await reattachBootPlugin({ pluginId: record.pluginId, discovery });
    }
  }

  async function reattachBootPlugin({ pluginId, discovery }: { pluginId: string; discovery: readonly PluginDiscoveryRecord[] }, _options = {}): Promise<void> {
    try {
      if (installDir !== undefined) await assertPluginInstallIdle({ installDir });
      const discovered = discovery.find((candidate) => candidate.id === pluginId);
      if (!discovered) throw new PluginLoadError(pluginId, "PLUGIN_EXPORT_INVALID");
      // A tier-1 plugin has no code to re-attach; its declared types were stored at enable.
      // Provider plugins were already loaded by `loadProviderPlugins`, ahead of application work.
      if (discovered.manifest?.tier === "tier-1" || declaresProviders({ manifest: discovered.manifest })) return;
      await attachPlugin(pluginId, discovered);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(
        `[plugin-runtime] boot re-attach failed for '${pluginId}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /** Import + setup of one selected provider plugin, bounded: boot never waits on a stalled plugin. On the
   *  deadline the caller revokes the selection (`onPluginDisabled`), so a late setup cannot publish. */
  async function attachProviderWithin({ record, timeoutMs }: { record: PluginDiscoveryRecord; timeoutMs: number }): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`provider plugin load timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    const attached = attachPlugin(record.id, record);
    // Observed even after the deadline wins, so a late failure is never an unhandled rejection.
    attached.catch(() => {});
    try { await Promise.race([attached, deadline]); } finally { clearTimeout(timer); }
  }

  async function listProviderPlugins(_required: Record<string, never>, _options = {}) {
    const enabled = new Set((await activationRepo.listAll())
      .filter((row) => row.workspaceId === required.workspaceId && row.enabled).map((row) => row.pluginId));
    return (await discoverActivePlugins())
      .filter((record) => enabled.has(record.id) && declaresProviders({ manifest: record.manifest }))
      .map((record) => ({ pluginId: record.id, providers: record.manifest!.contributes!.providers! }));
  }

  async function loadProviderPlugins({ pluginIds }: { pluginIds: readonly string[] }, options: { timeoutMs?: number } = {}): Promise<readonly string[]> {
    const wanted = new Set(pluginIds);
    if (wanted.size === 0) return [];
    const enabled = new Set((await activationRepo.listAll())
      .filter((row) => row.workspaceId === required.workspaceId && row.enabled).map((row) => row.pluginId));
    const loaded: string[] = [];
    for (const record of await discoverActivePlugins()) {
      if (!wanted.has(record.id) || !enabled.has(record.id) || !declaresProviders({ manifest: record.manifest })) continue;
      selectedProviders.add(record.id);
      try {
        await attachProviderWithin({ record, timeoutMs: options.timeoutMs ?? 10_000 });
        loaded.push(record.id);
      } catch (error) {
        onPluginDisabled(record.id);
        console.warn(`[plugin-runtime] provider plugin '${record.id}' failed to load; its contract stays on the noop: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return loaded;
  }

  async function locatePluginPackageDirs(pluginId: string): Promise<{
    liveParent: string;
    liveNames: readonly string[];
    parkedDir: string;
  }> {
    if (installDir === undefined) {
      throw new Error(`locatePluginPackageDirs: no installDir configured for this composition root — cannot remove '${pluginId}'`);
    }
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
    const liveNames = await lstat(liveDir).then(
      () => [pluginId],
      (error: unknown) => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
        throw error;
      },
    );
    return { liveParent: installRoot, liveNames, parkedDir };
  }

  async function readPluginPackageFiles(record: PluginDiscoveryRecord): Promise<PluginPackageFiles> {
    const location = resolvePackageLocation({ record, sources, installDir });
    if (location === null) return { files: [], truncated: false };
    return readPluginPackageDirectory({ input: location });
  }

  const pluginInstaller: PluginInstallerPort | undefined = installDir === undefined ? undefined : {
      preview: (input, options = {}) => previewSitePluginInstall({ ...input, deps: { ...runtimeBinding, ...options, installDir, builtInIds: sources.map((source) => source.manifest.id), builtInManifests: sources.map((source) => source.manifest), repo: activationRepo, conflicts: installPreviewConflicts } }),
      install: async (input, options = {}) => {
        const deps = { ...runtimeBinding, ...options, installDir, builtInIds: sources.map((source) => source.manifest.id), builtInManifests: sources.map((source) => source.manifest), repo: activationRepo, conflicts: installPreviewConflicts };
        const preview = await previewSitePluginInstall({ ...input, deps });
        // Admission uses this manifest's identity; publication must retain those exact bytes.
        const run = () => installSitePlugin({ ...input, expectedDigest: input.expectedDigest ?? preview.digest, deps });
        const host = optional.lookup?.();
        if (!host) return run();
        return host.withInstallIdentity({ candidate: { id: preview.publisherId ?? `unknown/${preview.id}`, localId: preview.id, family: "site-runtime" }, run });
      },
  };
  async function reloadActivation({ row, id, discovery }: {
    row: Awaited<ReturnType<PluginActivationRepoPort["listAll"]>>[number]; id: string; discovery: readonly PluginDiscoveryRecord[];
  }, _options = {}): Promise<void> {
    const here = row.workspaceId === required.workspaceId;
    try {
      await setPluginEnabled({ deps: { clock, repo: activationRepo, discovery,
        onEnabled: here ? onPluginEnabled : async () => {}, onDisabled: here ? onPluginDisabled : () => {} },
        input: { workspaceId: row.workspaceId, pluginId: id, enabled: true } });
    } catch (error) {
      if (here) await restoreReloadedPlugin({ id, workspaceId: row.workspaceId });
      throw error;
    }
  }

  async function assertReloadApproved({ id, enabledCount, discovery }: {
    id: string; enabledCount: number; discovery: readonly PluginDiscoveryRecord[];
  }, _options = {}): Promise<void> {
    // Consent gap (2026-10-12): a re-seal that widens what a running plugin can reach waits for
    // the owner. Thrown here, the source service reports it as reloadError and keeps every
    // retained version; the approved version keeps running until the owner re-approves it.
    const next = discovery.find(record => record.id === id)?.manifest;
    const added = enabledCount > 0 && next ? addedPluginCapabilities({ approved: await pluginSource?.readApproval({ id }, {}), next: pluginCapabilitySet({ manifest: next }) }) : [];
    if (added.length > 0) throw new Error(required.text.reloadApprovalRequired({ added }));
  }

  async function restoreReloadedPlugin({ id, workspaceId }: { id: string; workspaceId: string }, _options = {}): Promise<void> {
    // setPluginEnabled already restored the old activation row. Re-enter the same loader
    // to pin its retained bytes, rather than turning a working plugin off for a bad update.
    try { await onPluginEnabled(id); }
    catch (rollbackError) {
      console.warn(`[plugin-runtime] Plugin '${id}' restored-version reload failed`, rollbackError);
      onPluginDisabled(id);
      await quarantinePlugin({ deps: quarantineDeps, input: { pluginId: id, workspaceId, consecutiveFailures: 0, reason: required.text.restoreFailedReason } });
    }
  }

  const pluginSource = composeSourceService({}, {});

  function composeSourceService(_required: Record<string, never>, _options = {}): PluginSourcePort | undefined {
    if (installDir === undefined || pluginInstaller === undefined) return undefined;
    return createPluginSourceService({
      ...runtimeBinding, installDir, installer: pluginInstaller, policy: pluginSourcePolicy,
      pruneVersions: ({ id }) => pruneSitePluginVersions({ id, installDir, repo: activationRepo }),
      builtInIds: sources.map(source => source.manifest.id),
      scaffoldEntry: required.text.scaffoldEntry,
      reload: async ({ id }) => {
        const enabled = (await activationRepo.listAll()).filter(row => row.pluginId === id && row.enabled);
        const discovery = await discoverPlugins();
        await assertReloadApproved({ id, enabledCount: enabled.length, discovery });
        // Load here before publishing active pointers to other processes. Their existing poll sees
        // a version change and re-enters the same validated loader, replacing module snapshots.
        enabled.sort((a, b) => Number(b.workspaceId === required.workspaceId) - Number(a.workspaceId === required.workspaceId));
        for (const row of enabled) {
          await reloadActivation({ row, id, discovery });
        }
        return enabled.some(row => row.workspaceId === required.workspaceId);
      },
    });
  }

  return {
    dispose: async (input, options = {}) => {
      closing = true;
      await Promise.allSettled([...pendingAttachments]);
      await snapshots?.dispose(input, options);
    },
    browserProviders: () => ({ generation: browserGeneration, providers: [...browserProviders.values()].flat() }),
    ...(pluginInstaller === undefined ? {} : { pluginInstaller }),
    ...(pluginSource === undefined ? {} : { pluginSource }),
    pluginSourcePolicy,
    pluginLoadedVersion: ({ id }) => loadedVersions.get(id),
    hookRegistry,
    pluginContributions,
    providerContributions,
    loadProviderPlugins,
    listProviderPlugins,
    discoverPlugins,
    discoverActivePlugins,
    onPluginEnabled,
    onPluginDisabled,
    locatePluginPackageDirs,
    readPluginPackageFiles,
    beforeSaveHook: (entry) => hookRegistry.runBeforeSave({ entry }),
    previewPluginBeforeSave: (pluginId, entry) => hookRegistry.previewBeforeSave({ pluginId, entry }),
    attachEnabledPluginsAtBoot,
    listPluginConflicts: () => listPluginConflicts(),
  };
}
