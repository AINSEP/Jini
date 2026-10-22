/** Host adapters must re-export this shared class to preserve instanceof identity; product
 * refusal copy stays host-owned. */
/**
 * @file Shared plugin save-hook refusal. Callers handling saves and the plugin runtime import
 * this neutral error contract to avoid a dependency cycle or making the save domain plugin-aware.
 */
/** Thrown (and caught by the caller, mapped to 500 `PLUGIN_HOOK_FAILED`) when a filter throws,
 * triggers `CapabilityDeniedError`, or returns an invalid `ext` write (BR-07/EC-10). */
export class PluginHookFailedError extends Error {
  readonly pluginId: string;
  /** The item a multi-item apply was writing when the hook refused (e.g. `post:<id>`), set only by
   * an apply that is NOT all-or-nothing (`publish-content/apply-loop.ts`), so items applied before
   * it stay saved. `null` for a single save, where the refusal means nothing was saved. */
  readonly refusedItemRef: string | null;

  constructor(pluginId: string, message: string, options?: { cause?: unknown; refusedItemRef?: string }) {
    super(message, options);
    this.name = "PluginHookFailedError";
    this.pluginId = pluginId;
    this.refusedItemRef = options?.refusedItemRef ?? null;
  }
}

