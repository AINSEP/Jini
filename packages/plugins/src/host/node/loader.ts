/** SDK version, hashing and executable import are required host ports. The importer must retain
 * the fresh snapshot and containment guarantees described below. */
/**
 * @file `loadPlugin()` — BR-01's ordered load pipeline (SPEC-005 REQ-03).
 * The signature and JSDoc are design-frozen under implementation outline C-008.
 * Host-supplied SDK versions respect ADR-005's public-export boundary; do not deep-import the
 * SDK's package.json to discover a version.
 * Verify packaged-file integrity, check the host SDK version against manifest.sdkRange, then
 * import executable code, validate its export and run setup with a capability-scoped SDK.
 * Hook attachment is composition-owned: see the successful return path and attachLoadedPlugin.
 *
 * CIC U-001 (Binding, ESCALATE_SECURITY): integrity and SDK compatibility MUST both pass before
 * any plugin code is evaluated, even at module-evaluation time. Deviating from that ordering
 * requires a recorded [CIC_DEVIATION_APPROVED] entry under
 * reports/pipeline/005-plugin-system/critical-internal-constraints.md U-001.
 *
 * Injectable import and digest ports let checks observe that rejected code was never imported,
 * without depending on real module resolution (CIC Verification Surface Rule).
 */
import { PluginSnapshotIntegrityError } from "./module-snapshot.js";
import path from "node:path";

import * as semver from "semver";

import { buildCapabilityScopedSdk, type CapabilityScopedSdkCoreDeps } from "../capability-sdk.js";
import type { PluginDiscoveryRecord } from "../discovery-types.js";
import type { PluginManifest } from "../manifest.js";
import type { HookPoints, PluginSdkBinding, PluginModuleImportPort, VerifyDigestPort, PluginTierPolicy } from "../ports.js";
export { attachLoadedPlugin } from "../attach-loaded-plugin.js";

/** A packaged artifact's file layout is fixed (ADR-004): `tovu.plugin.json` + `server/index.mjs` at
 * the plugin root. `entryPath` is always `<pluginRoot>/server/index.mjs`, so the root two
 * directories up from it is where `manifest.integrity`'s relative file paths resolve from. */
function derivePluginRoot(entryPath: string): string {
  return path.dirname(path.dirname(entryPath));
}

/**
 * True when a site plugin's entry file exists but `manifest.integrity` has no hash for it. Without
 * this, an empty (or entry-less) map passes step (1) vacuously and step (3) imports unverified code.
 * A MISSING entry is left to step (3), which reports it as `CODE_ENTRY_MISSING` (AC-12).
 * @complexity One file hash.
 */
async function isUncoveredExistingEntry(
  manifest: PluginManifest,
  pluginRoot: string,
  entryPath: string,
  computeFileHash: (absoluteFilePath: string) => Promise<string>
): Promise<boolean> {
  const entryKey = path.relative(pluginRoot, entryPath).split(path.sep).join("/");
  if (Object.hasOwn(manifest.integrity, entryKey)) return false;
  try {
    await computeFileHash(entryPath);
    return true;
  } catch {
    return false;
  }
}

/** Host-owned SDK, import, digest and tier-admission contracts for one ordered load. */
export interface LoadPluginRequired<H extends HookPoints = HookPoints> {
  readonly pluginSdkBinding: PluginSdkBinding<H>;
  readonly importModule: PluginModuleImportPort;
  readonly verifyDigest: VerifyDigestPort;
  readonly tierPolicy: PluginTierPolicy;
  /** The plugin's already-discovered, statically-valid record (a plugin with a non-`valid` static
   * `status` must never reach `loadPlugin` at all — that guard lives in the caller, BR-05). */
  readonly record: PluginDiscoveryRecord;
  readonly manifest: PluginManifest;
  /** Absolute filesystem path (or, for a built-in, an in-process module identifier) to the
   * plugin's entry point — the exact thing step (3) `import()`s. */
  readonly entryPath: string;
  /** Per-load core handles composed by the application root. `loadPlugin()` owns the imported
   * module and therefore owns building the capability-scoped SDK passed to its `setup()` call;
   * the root owns what each granted handle actually delegates to. */
  readonly coreDeps: CapabilityScopedSdkCoreDeps;
}

export type LoadPluginOptional = Record<string, never>;

export type PluginLoadFailureReason =
  | "INTEGRITY_FAILED"
  | "SDK_RANGE_UNSATISFIED"
  | "CODE_ENTRY_MISSING"
  | "PLUGIN_EXPORT_INVALID"
  | "PLUGIN_SETUP_FAILED";

export type PluginEnableFailureReason = PluginLoadFailureReason | "PLUGIN_HOOK_NOT_ATTACHED" | "PLUGIN_HOOK_ATTACH_FAILED";

/** Raised by the composition root after converting `loadPlugin()`'s expected early-return result
 * into the enable path's error channel. HTTP maps this to `PLUGIN_LOAD_FAILED`; agent tools receive
 * the same typed error directly. */
export class PluginLoadError extends Error {
  readonly pluginId: string;
  readonly reason: PluginEnableFailureReason;

  constructor(pluginId: string, reason: PluginEnableFailureReason, options?: { cause?: unknown }) {
    super(`plugin '${pluginId}' failed to load (${reason})`, options);
    this.name = "PluginLoadError";
    this.pluginId = pluginId;
    this.reason = reason;
  }
}

export type LoadPluginResult =
  | { readonly loaded: true }
  | {
      readonly loaded: false;
      readonly reason: PluginLoadFailureReason;
    };

/**
 * Executes BR-01's 5-step ordered pipeline for one plugin. See CIC U-001 above for the binding
 * ordering constraint this function's statement order must never invert.
 *
 * @throws Never for an expected pipeline failure (those are reported via the returned `reason`);
 * may propagate an unexpected infrastructure error (e.g. a real filesystem I/O failure unrelated
 * to integrity mismatch).
 * @complexity O(file count) for integrity hashing; the `import()`/`setup()` cost beyond that is
 * plugin-defined and unbounded — no latency budget is specified (ADR `scalability` axis, a
 * disclosed open gap, not a defect of this function).
 */
export async function loadPlugin<H extends HookPoints>(
  required: LoadPluginRequired<H>,
  _optional: LoadPluginOptional = {}
): Promise<LoadPluginResult> {
  const { record, manifest, entryPath, coreDeps } = required;
  const { importModule, tierPolicy, pluginSdkBinding } = required;
  const computeFileHash = (absoluteFilePath: string) => required.verifyDigest({ absoluteFilePath });
  const runtimeSdkVersion = pluginSdkBinding.runtimeSdkVersion;
  // --- CIC U-001-ORD1: step (1), integrity, MUST complete successfully before step (2)/(3). ---
  const pluginRoot = derivePluginRoot(entryPath);
  if (record.source === "site" && (await isUncoveredExistingEntry(manifest, pluginRoot, entryPath, computeFileHash))) {
    return { loaded: false, reason: "INTEGRITY_FAILED" };
  }
  for (const [relativeFilePath, expectedHash] of Object.entries(manifest.integrity)) {
    let actualHash: string;
    try {
      actualHash = await computeFileHash(path.join(pluginRoot, relativeFilePath));
    } catch {
      return { loaded: false, reason: "INTEGRITY_FAILED" };
    }
    if (actualHash !== expectedHash) {
      return { loaded: false, reason: "INTEGRITY_FAILED" };
    }
  }

  // --- CIC U-001-ORD1: step (2), sdkRange, MUST complete successfully before step (3). ---
  if (!semver.satisfies(runtimeSdkVersion, manifest.sdkRange)) {
    return { loaded: false, reason: "SDK_RANGE_UNSATISFIED" };
  }

  // Declarative plugins never reach an executable importer. A worker port is mandatory for tier-2,
  // and tier-3 must be admitted explicitly by the host (CMS-JINI-MODULAR-DESIGN Rev 3 §5).
  if (manifest.tier === "tier-1") return { loaded: true };
  if ((manifest.tier === "tier-2" && tierPolicy.execution !== "worker") || !tierPolicy.allowLoad({ record, manifest })) {
    return { loaded: false, reason: "CODE_ENTRY_MISSING" };
  }

  // --- Step (3): only now, after both prior checks pass, is the plugin's code ever evaluated. ---
  let importedModule: unknown;
  try {
    // Same-version replacement must evaluate the reviewed package again. Build this URL only at
    // step (3), after integrity and SDK compatibility have passed (CIC U-001 order unchanged).
    // Injected import seams keep their original path contract. A fresh filesystem graph refreshes
    // ALL packaged helpers (including nested/dynamic imports and CommonJS require caches).
    const imported = await importModule({ plugin: { pluginId: record.id, packageRoot: pluginRoot }, modulePath: entryPath });
    if (typeof imported === "string") return { loaded: false, reason: "CODE_ENTRY_MISSING" };
    importedModule = { default: imported.exported };
  } catch (error) {
    if (error instanceof PluginSnapshotIntegrityError) return { loaded: false, reason: "INTEGRITY_FAILED" };
    return { loaded: false, reason: "CODE_ENTRY_MISSING" };
  }

  // --- Step (4): validate the `definePlugin()` export, build the per-load gated SDK, run setup. ---
  const plugin = pluginSdkBinding.readDefinedPlugin({ moduleValue: importedModule });
  if (!plugin) {
    return { loaded: false, reason: "PLUGIN_EXPORT_INVALID" };
  }

  const sdk = buildCapabilityScopedSdk({
    pluginId: record.id,
    capabilities: manifest.capabilities as readonly import("../manifest.js").PluginCapability[],
    coreDeps,
    pluginSdkBinding,
  });
  try {
    await plugin.definition.setup(sdk);
  } catch {
    return { loaded: false, reason: "PLUGIN_SETUP_FAILED" };
  }

  // Step (5) remains composition-owned: setup's gated `addFilter()` handle captures the filter in
  // the caller's `coreDeps`; only after this successful return does the root call the shared
  // `attachLoadedPlugin()` path below. That split prevents a late setup failure from leaving a
  // partially-attached filter behind.
  return { loaded: true };
}

