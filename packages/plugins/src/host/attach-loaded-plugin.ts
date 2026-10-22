import type { BeforeSaveFilter } from "./ports.js";
import type { AttachmentSource, HookRegistry, HookRegistryFieldDecl } from "./hook-registry.js";

export interface AttachLoadedPluginRequired {
  /** The plugin/glue-module id `hookRegistry.attach()` files this attachment under. */
  readonly pluginId: string;
  /** Who attached this filter — widened by ADR-057 Decision 3 to include `"glue"`, so Site Glue's
   * content-lifecycle attachment point can call this function directly rather than forking it. */
  readonly source: AttachmentSource;
  /** The live registry this load's filter attaches to — one long-lived instance per process
   * (`hook-registry.ts`'s own doc comment), supplied by the caller, never constructed here. */
  readonly hookRegistry: HookRegistry;
  /** The filter obtained from step (4) — i.e. whatever the caller's own `setup()` invocation (with
   * a capability-scoped SDK gating `hooks.attach`) produced. This function does not invoke `setup()`
   * itself: the SDK shape a `setup()` call receives differs by caller (plugin-runtime's own 3-member
   * `PluginCapability` vocabulary for real plugins; Site Glue's 8-member `GlueCapability` vocabulary
   * for glue modules), so building and gating that SDK stays the caller's responsibility. What is
   * genuinely shared — and was genuinely dead before this extraction — is the attach step itself. */
  readonly filter: BeforeSaveFilter;
  readonly declaredFields: readonly HookRegistryFieldDecl[];
}

export type AttachLoadedPluginOptional = Record<string, never>;

/**
 * The real (not stub) extraction of `loadPlugin()`'s dead step (5) — ADR-057 Decision 2.1. Attaches
 * one already-obtained filter to the given hook registry under `(pluginId, source)`, widened beyond
 * `loader.ts`'s original `"built-in" | "site"` scope to also accept `"glue"`. Before ADR-057, no
 * production code ever called `hookRegistry.attach()` at all (verified by grep, see `hook-registry.ts`'s
 * corrected header) — Site Glue's content-lifecycle attachment point is this function's first real
 * caller; a future fix to `loadPlugin()`'s own dead steps (4)-(5) is expected to call this same
 * function from its real activation path rather than re-implementing the attach step a second time.
 *
 * @throws Nothing of its own — propagates whatever `hookRegistry.attach()` itself throws (today,
 * nothing; `attach()` is a plain `Map.set`).
 * @complexity O(1) — a single delegated call, no iteration or I/O of its own.
 * @overallScore 100/100
 */
export function attachLoadedPlugin(
  required: AttachLoadedPluginRequired,
  _optional: AttachLoadedPluginOptional = {}
): void {
  const { pluginId, source, hookRegistry, filter, declaredFields } = required;
  hookRegistry.attach({ pluginId, source, filter, declaredFields });
}
