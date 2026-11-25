/**
 * @file The ONE typed state object every phase helper of the plugin runtime core shares (G08 split of
 * `createPluginRuntimeCore`). Built once per runtime; helpers take it as an argument instead of
 * capturing a half-built factory closure.
 * @agent-note Shared state: ONE hook registry (save AND preview), ONE contribution and provider
 * registry and ONE pending-attachment set per runtime. `closing` and `browserGeneration` are the only
 * scalars that change after construction.
 */
import path from "node:path";
import { createPluginContributionRegistry } from "../contributions.js";
import type { AdmittedBrowserProvider } from "../browser-providers.js";
import { createHookRegistry } from "../hook-registry.js";
import { createPluginModuleSnapshotLifecycle } from "./module-snapshot.js";
import type { PluginRuntimeCoreRequired, PluginRuntimeCoreOptional } from "./runtime-contracts.js";

export interface RuntimeState<TEvent, TOptions> {
  readonly required: PluginRuntimeCoreRequired<TEvent, TOptions>;
  readonly optional: PluginRuntimeCoreOptional<TEvent, TOptions>;
  readonly runtimeBinding: PluginRuntimeCoreRequired<TEvent, TOptions>["hostBinding"] & { pluginSdkBinding: PluginRuntimeCoreRequired<TEvent, TOptions>["pluginSdkBinding"] };
  readonly installDir: string | undefined;
  readonly quarantineDeps: QuarantineDeps;
  readonly snapshots: ReturnType<typeof createPluginModuleSnapshotLifecycle> | undefined;
  readonly pendingAttachments: Set<Promise<void>>;
  closing: boolean;
  readonly loadedVersions: Map<string, string>;
  readonly browserProviders: Map<string, readonly AdmittedBrowserProvider[]>;
  browserGeneration: number;
  readonly pluginContributions: ReturnType<typeof createPluginContributionRegistry>;
  readonly providerContributions: ReturnType<typeof createPluginContributionRegistry>;
  // Only boot's configured selection may admit provider factories (`loadProviderPlugins`).
  readonly selectedProviders: Set<string>;
  readonly loadEpochs: Map<string, number>;
  readonly hookRegistry: ReturnType<typeof createHookRegistry>;
  readonly coreClaims: NonNullable<PluginRuntimeCoreOptional["coreClaims"]>;
}

type QuarantineDeps = ReturnType<typeof createQuarantineDeps>;

function createQuarantineDeps<TEvent, TOptions>(
  { required, optional }: { required: PluginRuntimeCoreRequired<TEvent, TOptions>; optional: PluginRuntimeCoreOptional<TEvent, TOptions> },
  _options = {},
) {
  return { clock: required.clock, repo: required.activationRepo, onQuarantined: ({ pluginId }: { pluginId: string; workspaceId: string }) => {
    const tracker = optional.tracker?.();
    if (!tracker) return undefined;
    const { event, options } = required.quarantineTelemetry({ pluginId });
    return tracker.capture(event, options);
  } };
}

/** `onHookQuarantine` is the activation phase's hook-failure handler; it closes over the state this
 * function returns, so the registry and the state can reference each other without a half-built factory. */
export function createRuntimeState<TEvent, TOptions>(
  { required, optional, onHookQuarantine }: {
    required: PluginRuntimeCoreRequired<TEvent, TOptions>;
    optional: PluginRuntimeCoreOptional<TEvent, TOptions>;
    onHookQuarantine: (input: { pluginId: string; workspaceId: string; consecutiveFailures: number; reason: string }) => Promise<void>;
  },
  _options = {},
): RuntimeState<TEvent, TOptions> {
  const { installDir } = optional;
  return {
    required,
    optional,
    quarantineDeps: createQuarantineDeps({ required, optional }),
    runtimeBinding: { ...required.hostBinding, pluginSdkBinding: required.pluginSdkBinding },
    installDir,
    // The install directory owns versions; its sibling runtime directory owns executable graphs.
    snapshots: installDir === undefined ? undefined : createPluginModuleSnapshotLifecycle({ runtimeRoot: path.resolve(installDir) + "-runtime" }),
    pendingAttachments: new Set<Promise<void>>(),
    closing: false,
    loadedVersions: new Map<string, string>(),
    browserProviders: new Map<string, readonly AdmittedBrowserProvider[]>(),
    browserGeneration: 0,
    pluginContributions: createPluginContributionRegistry({}),
    providerContributions: createPluginContributionRegistry({}),
    selectedProviders: new Set<string>(),
    loadEpochs: new Map<string, number>(),
    hookRegistry: createHookRegistry({ pluginSdkBinding: required.pluginSdkBinding }, {
      ...(optional.failureThreshold === undefined ? {} : { failureThreshold: optional.failureThreshold }),
      onQuarantine: onHookQuarantine,
    }),
    coreClaims: optional.coreClaims ?? [],
  };
}
