/** The required SDK binding supplies hook ids and definePlugin. The importer accepts the
 * shared contribution-loader object contract and yields { exported }. */
/**
 * @file `createTier2ImportSeam()` — the `importModule` a Tier-2 plugin's `loadPlugin()` call is
 * given (ADR-024 §3/§4). It never imports the plugin's code into the server process. Instead it
 * probes the plugin in a fresh worker (import + setup + report attached hooks) and returns a
 * PROXY `definePlugin()` module whose `setup()` attaches an RPC filter: each filter call is one
 * more fresh worker that imports, sets up, runs the real filter and replies.
 *
 * Injected through `loadPlugin()`'s own `importModule` option, so CIC U-001 is untouched: integrity
 * and sdkRange are verified before this function is ever called (it IS step 3), and the proxy then
 * goes through the same export validation, capability-scoped `setup()` and attach path as an
 * in-process plugin. Probe failures are mapped onto the loader's own reasons rather than new ones:
 * a failed import rejects (`CODE_ENTRY_MISSING`), a missing export returns a module without one
 * (`PLUGIN_EXPORT_INVALID`), a failed setup returns a proxy whose setup throws (`PLUGIN_SETUP_FAILED`).
 *
 * A failed or timed-out filter call throws, so `hook-registry.ts` fails the save closed and counts
 * the failure toward quarantine exactly as it does for a throwing Tier-3 filter.
 */
import type { ExtPatch, PluginSdkBinding, PluginModuleImportPort } from "../ports.js";

import type { PluginCapability, PluginManifest } from "../manifest.js";
import type { Tier2CallRunner, Tier2PluginRef } from "./protocol.js";

export interface CreateTier2ImportSeamRequired {
  readonly pluginSdkBinding: PluginSdkBinding;
  /** The loader-validated manifest; its id, capabilities and hooks are what the worker enforces. */
  readonly manifest: PluginManifest;
  /** Runs one request in a fresh isolated worker (`server/runtime/plugin-tier2/run-in-worker.ts`). */
  readonly runCall: Tier2CallRunner;
}

export interface CreateTier2ImportSeamOptional {
  /** Maps the loader's entry path to what the worker imports. A site plugin passes its
   * integrity-checked module snapshot here (the loader skips its own snapshot when an import seam
   * is injected); a built-in omits it and the worker imports `entryPath` itself. */
  readonly resolveWorkerEntry?: (required: { entryPath: string }, optional?: Record<string, never>) => Promise<string>;
}

function invalidReply(): Error {
  return new Error("invalid tier-2 worker reply");
}

/**
 * Builds the Tier-2 `importModule` seam for one plugin load.
 *
 * @returns An importer resolving to a proxy module; see the file header for the failure mapping.
 * @complexity O(1) plus one worker round trip per import and per filter call.
 */
export function createTier2ImportSeam(
  required: CreateTier2ImportSeamRequired,
  optional: CreateTier2ImportSeamOptional = {},
): PluginModuleImportPort {
  const { manifest, runCall, pluginSdkBinding } = required;
  const HOOK_CONTENT_ENTRY_BEFORE_SAVE = pluginSdkBinding.beforeSaveHook;
  const definePlugin = (definition: Parameters<typeof pluginSdkBinding.definePlugin>[0]) => pluginSdkBinding.definePlugin(definition);

  return async ({ modulePath: entryPath }) => {
    const plugin: Tier2PluginRef = {
      pluginId: manifest.id,
      entryPath: optional.resolveWorkerEntry ? await optional.resolveWorkerEntry({ entryPath }) : entryPath,
      // Same cast `loadPlugin()` makes: validateManifest() has already checked every token.
      capabilities: manifest.capabilities as readonly PluginCapability[],
      hooks: manifest.hooks,
    };

    const probe = await runCall({ kind: "probe", plugin });
    if (!probe.ok) {
      if (probe.stage === "import") throw new Error(probe.error);
      if (probe.stage === "export") return { exported: {} };
      return { exported: definePlugin({ setup() { throw new Error(probe.error); } }) };
    }
    if (probe.kind !== "probe") throw invalidReply();

    const attachesBeforeSave = probe.hooks.includes(HOOK_CONTENT_ENTRY_BEFORE_SAVE);
    return {
      exported: definePlugin({
        setup(sdk) {
          if (!attachesBeforeSave) return;
          sdk.addFilter(HOOK_CONTENT_ENTRY_BEFORE_SAVE, async (entry, ctx) => {
            const reply = await runCall({ kind: "beforeSave", plugin, entry, ctx });
            if (!reply.ok) throw new Error(reply.error);
            if (reply.kind !== "beforeSave") throw invalidReply();
            // hook-registry validates the patch against the manifest's declared fields (BR-06).
            return reply.patch as ExtPatch;
          });
        },
      }),
    };
  };
}
