/**
 * @file `buildCapabilityScopedSdk()` — builds the per-load `PluginSdk` handle (SPEC-005 REQ-04;
 * CIC U-003, `ESCALATE_SECURITY`).
 *
 * Purpose:
 * REQ-04: "the SDK object handed to the plugin exposes ONLY the granted surface. A plugin
 * invoking a surface it did not declare fails at the SDK boundary (`CAPABILITY_DENIED`)."
 *
 * **CIC U-003 (Binding, ESCALATE_SECURITY):** a naive reading of REQ-04 could satisfy "exposes
 * only the granted surface" by simply OMITTING ungranted properties (`sdk.content = granted ?
 * {...} : undefined`). That is the wrong implementation — AC-05's contract requires a classified,
 * catchable `CAPABILITY_DENIED` error, not a bare `TypeError` from calling a method on
 * `undefined`. This function must therefore always expose a callable at every one of the three
 * v1 capability positions (`content.read`, `content.extend`, `addFilter`) — granted capabilities
 * get the real implementation (delegating to `coreDeps`), ungranted capabilities get a stub that
 * SYNCHRONOUSLY throws a typed `CapabilityDeniedError` naming the missing capability. Any
 * deviation from "always present, never absent" requires a recorded
 * `[CIC_DEVIATION_APPROVED]` entry — see
 * `reports/pipeline/005-plugin-system/critical-internal-constraints.md` U-003.
 *
 * Built fresh per plugin load (never a shared module-level singleton, ADR Decision item 2) — a
 * new `PluginSdk` object is constructed for every `loadPlugin()` call, closing over that one
 * plugin's own `pluginId` and granted capability set only.
 *
 * Architectural role:
 * TDD-certified implementation (implementation outline C-009, CIC U-003). Signature and JSDoc are
 * design-frozen; `buildCapabilityScopedSdk()` returns fresh per-plugin delegates for granted
 * capabilities and present, typed-denial stubs for every ungranted surface.
 */
import type { BeforeSaveFilter, ContentEntryDraft, PluginSdk, HookPoints, PluginSdkBinding } from "./ports.js";
import type { PluginCapability } from "./manifest.js";

/** Thrown synchronously when a plugin invokes an SDK surface it did not declare a capability for
 * (REQ-04, INV-02). Classified so `hook-registry.ts` can catch it specifically and map the
 * containing content operation to `PLUGIN_HOOK_FAILED` (BR-07), distinct from any other thrown
 * error a plugin's own code might raise. */
export class CapabilityDeniedError extends Error {
  readonly pluginId: string;
  readonly capability: PluginCapability;

  constructor(pluginId: string, capability: PluginCapability) {
    super(`plugin '${pluginId}' invoked '${capability}' without declaring it in its manifest capabilities`);
    this.name = "CapabilityDeniedError";
    this.pluginId = pluginId;
    this.capability = capability;
  }
}

/** The three real, plugin-instance-scoped callbacks `capability-sdk.ts` wraps with capability
 * gating. Supplied by the caller (the loader, at load time, closing over that specific plugin
 * load's `hook-registry.ts` state) — this module never reaches into `hook-registry.ts` directly. */
export interface CapabilityScopedSdkCoreDeps {
  /** Backing implementation for the granted `content.read()` surface. */
  getCurrentEntry(): Readonly<ContentEntryDraft>;
  /** Backing implementation for the granted `content.extend()` surface — writes into this
   * plugin's own `ext.{pluginId}.{field}` namespace (validated by BR-06 at the caller). */
  writeExtField(field: string, value: string | number | boolean): void;
  /** Backing implementation for the granted `addFilter()` surface. */
  attachFilter(hookName: string, filter: BeforeSaveFilter): void;
}

export interface BuildCapabilityScopedSdkRequired<H extends HookPoints = HookPoints> {
  readonly pluginSdkBinding: PluginSdkBinding<H>;
  readonly pluginId: string;
  /** The manifest's declared capability set (already validated against the v1 vocabulary by
   * `validateManifest()` — this function trusts its input is well-formed capability strings). */
  readonly capabilities: readonly PluginCapability[];
  readonly coreDeps: CapabilityScopedSdkCoreDeps;
}

export type BuildCapabilityScopedSdkOptional = Record<string, never>

/**
 * Builds one plugin's capability-scoped `PluginSdk` handle. Every one of the three v1 surfaces is
 * always present on the returned object (CIC U-003) — granted surfaces delegate to `coreDeps`,
 * ungranted surfaces are stubs that throw `CapabilityDeniedError` when invoked (never at build
 * time — the stub itself is a normal, present function; only CALLING it throws).
 *
 * @throws Nothing at build time. The returned object's ungranted-surface stubs throw
 * `CapabilityDeniedError` synchronously when invoked by the plugin.
 * @complexity O(1) — three capability checks, trivially small and bounded regardless of
 * plugin-declared array length (the vocabulary itself is fixed-size at exactly three).
 */
export function buildCapabilityScopedSdk<H extends HookPoints>(
  required: BuildCapabilityScopedSdkRequired<H>,
  _optional: BuildCapabilityScopedSdkOptional = {}
): PluginSdk<H> {
  const { pluginId, capabilities, coreDeps } = required;
  const granted = new Set<PluginCapability>(capabilities);

  /**
   * Wraps one capability-gated surface: returns `real` when `capability` is granted, otherwise a
   * stub that synchronously throws `CapabilityDeniedError` when invoked. CIC U-003's binding
   * property — every surface is always a present, callable function, never an absent property.
   */
  function gate<Fn extends (...args: never[]) => unknown>(capability: PluginCapability, real: Fn): Fn {
    if (granted.has(capability)) {
      return real;
    }
    return ((..._args: never[]) => {
      throw new CapabilityDeniedError(pluginId, capability);
    }) as unknown as Fn;
  }

  const sdk: PluginSdk<H> = {
    content: {
      read: gate("content.read", () => coreDeps.getCurrentEntry()),
      extend: gate("content.extend", (field: string, value: string | number | boolean) =>
        coreDeps.writeExtField(field, value)
      ),
    },
    addFilter: gate("hooks.attach", (hookName: string, filter: BeforeSaveFilter) =>
      coreDeps.attachFilter(hookName, filter)
    ) as PluginSdk<H>["addFilter"],
    // `ActionHookName`/`ContributionHookName` (@tovu/sdk hooks.ts) have no catalog members yet
    // (hooks v2 plan §3.3 Waves 1/2 land in a later slice), so no name type-checks as an argument
    // to either surface today -- both are present-but-unreachable, same "always present" contract
    // as `addFilter`, gated on the same `hooks.attach` capability. No `coreDeps` backing exists
    // yet because there is nothing real to delegate to until a hook is cataloged.
    addAction: gate("hooks.attach", (..._args: never[]) => undefined),
    addContribution: gate("hooks.attach", (..._args: never[]) => undefined),
  };
  return required.pluginSdkBinding.buildSdk({ sdk });
}
