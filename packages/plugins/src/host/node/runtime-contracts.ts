import type { PluginManifestReadOptions } from "../plugin-format.js";
import type { PluginLookupPort } from "@jini-ai/core/plugin-directory";
import type { Clock as ClockPort } from "@jini-ai/core/primitives";
import type { FileLockPort } from "@jini-ai/core/contracts/runtime";
import type { PluginActivationRepoPort } from "../activation.js";
import type { PluginContributionRegistry } from "../contributions.js";
import type { AdmittedBrowserProvider } from "../browser-providers.js";
import type { ArchiveReaderPort, BundledBrowserProviderApproval, DeclarativeContentTypesPort, DeclaredContentTypePorts, PluginModuleImportPort, PluginSdkBinding, PluginTierPolicy, VerifyDigestPort } from "../ports.js";
import type { PluginSourcePolicyPort } from "../source-policy.js";
import type { BuiltInPluginSource, PluginDiscoveryRecord } from "../discovery-types.js";
import type { HookRegistry } from "../hook-registry.js";
import type { PluginManifest } from "../manifest-types.js";
import type { ExtensionClaim } from "../claim-conflicts.js";
import type { PluginConflict } from "../plugin-claims.js";
import type { PluginInstallerPort } from "./install.js";
import type { createPluginModuleSnapshotLifecycle } from "./module-snapshot.js";
import type { PluginSourcePort } from "./source-drafts.js";
import type { PluginPackageFiles } from "./package-files.js";
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
export interface PluginRuntimeHostBinding extends PluginManifestReadOptions {
  readonly capabilityVocabulary: readonly string[];
  readonly declarativeContentTypes: DeclarativeContentTypesPort;
  readonly coreOwnerName: string;
  readonly identityNamespace: string;
  readonly legacyIdentityNamespace?: string;
  readonly localInstallDisabledMessage: string;
  readonly tierPolicy: PluginTierPolicy;
  readonly archiveReader: ArchiveReaderPort;
  readonly verifyDigest: VerifyDigestPort;
  readonly createInvocationCoreDeps: RunTier2CallRequired["createInvocationCoreDeps"];
  /** Serializes plugin source edits with seal snapshots; Node hosts pass `createFileLockPort({ withFileLock })` of `@jini-ai/node-adapters/fs`. */
  readonly fileLock: FileLockPort;
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
    optional?: PluginManifestReadOptions & { importModule?: (entryPath: string) => Promise<unknown>; snapshots?: NonNullable<ReturnType<typeof createPluginModuleSnapshotLifecycle>> },
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
