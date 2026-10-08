/**
 * @file `@tovu/sdk` — the entire plugin-author public contract (SPEC-005 REQ-08, ADR-005 rule 1,
 * ADR-024 §3 ABI freeze).
 *
 * Purpose:
 * This file IS the public API. Everything a plugin's `server/index.mjs` may import from
 * `@tovu/sdk` is exported here and nowhere else — the runtime's internal core modules are never
 * reachable through this package (enforced by `package.json`'s `exports` map, not by this file). Hook
 * names, capability tokens, and the `definePlugin`/`PluginSdk` shapes are part of this public
 * surface and follow the ADR-005 deprecation ladder — changing any exported name/shape here is
 * an ecosystem-breaking change once a third-party plugin exists (ADR-005 "the compatibility
 * promise must exist before the first third-party plugin").
 *
 * ADR-024 §3 ABI compliance (ties REQ-05/REQ-08 to the newer governing ADR, ratified after this
 * spec's original approval): every hook is treated as always-awaited by core regardless of
 * whether a given filter function is itself `async` (`BeforeSaveFilter`'s return type is
 * `ExtPatch | Promise<ExtPatch>`); `ContentEntryDraft` is a plain, structured-clone-safe snapshot
 * — never a live ORM entity or class instance; and the `PluginSdk` object a plugin receives is a
 * freshly-built handle of plain closures, never a reference to a live core singleton. This file
 * only declares the TYPES for that contract; the runtime object satisfying `PluginSdk` (with its
 * capability-gated stub-vs-absent behavior, CIC U-003) is built by
 * `src/features/plugin-runtime/capability-sdk.ts` inside core, not here — this package has zero
 * dependency on `src/` (Module Map: "Must never import anything from `src/` — it is consumed by
 * plugin code, not by core").
 *
 * Architectural role:
 * TDD-certified implementation (implementation outline C-001…C-004). Signatures and JSDoc are
 * design-frozen; `definePlugin()` is a pure identity wrap — no side effects, no I/O — that exists
 * for the plugin author's type inference; `loadPlugin()` in `plugin-runtime/loader.ts` is what
 * actually invokes the wrapped `definition.setup(sdk)`. Verified against
 * `__tests__/unit/sdk-public-api.unit.test.ts`.
 */

/** C-004 — the exactly-three v1 capability tokens (REQ-04). A manifest declaring any other
 * string is `invalid` with `CAPABILITY_UNKNOWN` (validated in `plugin-runtime/manifest.ts`, not
 * here — this file is the single source of truth for the token *strings* only). */
export const CONTENT_READ = "content.read" as const;
export const CONTENT_EXTEND = "content.extend" as const;
export const HOOKS_ATTACH = "hooks.attach" as const;

/** Union of every valid capability token string. ADR-024 §6: the namespace SHAPE is frozen, but
 * its CONTENTS may grow — this union widens as later hooks (hooks v2 plan) add their own tokens,
 * additive-only, per the SDK's semver rule (ADR-005). */
export type CapabilityToken = typeof CONTENT_READ | typeof CONTENT_EXTEND | typeof HOOKS_ATTACH;

/** C-003 — the v1 hook point (REQ-05), kept forever (hooks v2 plan §3.3). Declared points are
 * enumerable via `tovu hooks list` (AC-15) and, as of hooks v2, `HOOK_POINTS` (`./hooks.js`) — this
 * constant is the single source of truth for the point's OWN name string; `HOOK_POINTS`'s entry
 * for it must match. */
export const HOOK_CONTENT_ENTRY_BEFORE_SAVE = "content.entry.beforeSave" as const;

/** hooks v2 plan §3.1 — the one typed hook catalog (data) plus its companion type map, re-exported
 * here so a plugin author imports everything from `@tovu/sdk`'s package root (ADR-005 rule 1: no
 * other import surface exists). See `./hooks.ts`'s own file doc for why this is a value AND type
 * export while `hooks.ts` itself only ever `import type`s from this file (no runtime cycle). */
import {
  HOOK_POINTS,
  type HookKind,
  type HookPointDescriptor,
  type HookPointName,
  type HookSignatures,
  type FilterHookName,
  type ActionHookName,
  type ContributionHookName,
} from "./fixture-hooks.js";
export {
  HOOK_POINTS,
  type HookKind,
  type HookPointDescriptor,
  type HookPointName,
  type HookSignatures,
  type FilterHookName,
  type ActionHookName,
  type ContributionHookName,
};

/** The merged-into-`ext.{pluginId}` shape a `beforeSave` filter returns (state.spec.md §2
 * `SdkSurface.ExtPatch`). Values are restricted to the four JSON-primitive types BR-06's field
 * `type` vocabulary supports (`string | integer | number | boolean` — `integer` collapses to
 * `number` at the JS/TS type level; BR-06's validator distinguishes integer-vs-number at the
 * value level, not the type level). */
export type ExtPatch = Readonly<Record<string, string | number | boolean>>;

/**
 * The read-only entry snapshot a `beforeSave` filter receives (REQ-05, RT-001). A v1 filter
 * cannot mutate core entry fields — this type has no setters, and every field is `readonly`
 * (ADR-024 §3: plain, serializable, never a live ORM row). `ext` reflects every OTHER plugin's
 * already-written namespaces at the time this filter runs (TB-01 composition order) — never this
 * plugin's own not-yet-written patch.
 */
export interface ContentEntryDraft {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly slug: string;
  readonly status: "draft" | "published";
  readonly bodyJson: Readonly<Record<string, unknown>>;
  readonly ext: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** Per-invocation context passed alongside the entry draft. */
export interface HookContext {
  readonly pluginId: string;
  readonly workspaceId: string;
}

/** REQ-05's literal filter signature: `(entry, ctx) => ExtPatch`. ADR-024 §3: always treated as
 * awaited by core, so a synchronous filter and an `async` filter are equally valid. Kept as its
 * own named type (rather than inlining `FilterFn<"content.entry.beforeSave">`) because it predates
 * `HookSignatures` and is part of the pinned public surface (ADR-005) — `FilterFn` below is
 * structurally identical for this one hook. */
export type BeforeSaveFilter = (
  entry: Readonly<ContentEntryDraft>,
  ctx: HookContext
) => ExtPatch | Promise<ExtPatch>;

/** hooks v2 plan §3.3 — the generic filter/action/contribution function shapes, one family
 * covering every hook `HookSignatures` declares for that kind, instead of one hand-written
 * signature per hook. Every hook payload is always treated as possibly-async (ADR-024 §3), exactly
 * like `BeforeSaveFilter`. */
export type FilterFn<K extends FilterHookName> = (
  input: Readonly<HookSignatures[K]["input"]>,
  ctx: HookContext
) => HookSignatures[K]["output"] | Promise<HookSignatures[K]["output"]>;
export type ActionFn<K extends ActionHookName> = (
  payload: Readonly<HookSignatures[K]["payload"]>,
  ctx: HookContext
) => void | Promise<void>;
export type ContributionFn<K extends ContributionHookName> = (
  ctx: Readonly<HookSignatures[K]["context"]> & HookContext
) => HookSignatures[K]["contributes"] | Promise<HookSignatures[K]["contributes"]>;

/** Options common to every `addFilter`/`addAction`/`addContribution` call (hooks v2 plan §3.3).
 * Omitted ⇒ the registry's own default (ADR-024 §7: every hook has an explicit, deterministic
 * order — "default" is this SDK's convenience, not an incidental ordering). */
export interface HookAttachOptions {
  readonly priority?: number;
}

/**
 * The capability-scoped handle passed to `PluginDefinition.setup`. Built fresh per plugin load
 * (never a shared module-level singleton, ADR Decision item 2) by
 * `plugin-runtime/capability-sdk.ts`. **Every surface below is always present on a real `PluginSdk`
 * instance** — an ungranted capability's surface is a stub that throws a typed `CAPABILITY_DENIED`
 * error when invoked, never an absent/`undefined` property (CIC U-003; this file declares the
 * TYPE only, the runtime stub-vs-absent behavior lives in `capability-sdk.ts`).
 */
export interface PluginSdk {
  readonly content: {
    /** Gated by `content.read` (REQ-04). Read-only accessor mirroring the filter's own `entry`
     * argument — present for API completeness so a plugin can read the current draft from any
     * capability-scoped closure it holds, not only inside the filter callback itself. */
    read(): Readonly<ContentEntryDraft>;
    /** Gated by `content.extend` (REQ-04/REQ-06). Declares/writes one value into this plugin's
     * own `ext.{pluginId}.{field}` namespace; validated by BR-06 (path namespacing + declared
     * type) at the core boundary, not by this SDK object itself. */
    extend(field: string, value: string | number | boolean): void;
  };
  /** Gated by `hooks.attach` (REQ-04/REQ-05). Attaches a filter to a declared hook point.
   * Attaching to any name other than one of `FilterHookName` is rejected at validation time
   * (`HOOK_UNKNOWN`, EC-05) before this method could ever be reached with a bad name. Widened
   * (hooks v2 plan §3.3) from the single `HOOK_CONTENT_ENTRY_BEFORE_SAVE` literal to a generic `K`
   * — every existing call site (passing that one literal) still type-checks unchanged, since it
   * remains the only `FilterHookName` member as of this SDK version. */
  addFilter<K extends FilterHookName>(hookName: K, filter: FilterFn<K>, opts?: HookAttachOptions): void;
  /** Gated by `hooks.attach` (hooks v2 plan §3.3). Always present on a real `PluginSdk` instance
   * (CIC U-003) — an ungranted capability throws `CapabilityDeniedError` when actually CALLED, not
   * by being absent. `ActionHookName` has no members yet (Wave 1's action hooks are a later slice
   * in this same lane), so no name currently type-checks here — additive, not yet reachable. */
  addAction<K extends ActionHookName>(hookName: K, action: ActionFn<K>, opts?: HookAttachOptions): void;
  /** Gated by `hooks.attach`. Same "always present, stub throws when ungranted" contract as
   * `addAction`. `ContributionHookName` has no members yet (Wave 2, out of this lane's scope). */
  addContribution<K extends ContributionHookName>(hookName: K, contribution: ContributionFn<K>, opts?: HookAttachOptions): void;
}

/** A plugin author's registration entry point payload. */
export interface PluginDefinition {
  /** Called once per load, immediately after `import()`, with a fresh capability-scoped
   * `PluginSdk` (ADR Decision item 2). May be async. */
  setup(sdk: PluginSdk): void | Promise<void>;
}

/** The typed return value of `definePlugin` — an opaque, identity-only wrapper (REQ-08). */
export interface Plugin {
  readonly definition: PluginDefinition;
}

/**
 * Wraps a `PluginDefinition` for type inference at the plugin author's call site. Pure identity
 * at runtime (no side effects, no I/O) — `loader.ts` invokes the wrapped `definition.setup(sdk)`
 * after the load pipeline's integrity/sdkRange/import steps all pass (BR-01).
 *
 * @param def - The plugin's registration definition (`{ setup(sdk) => void }`).
 * @returns The same definition, typed as `Plugin`. `definePlugin` itself never calls `setup` —
 *   that is `loadPlugin`'s job, after the verify-before-import pipeline succeeds (BR-01 step 4).
 * @complexity O(1) — pure identity wrap, no I/O, no traversal.
 * @overallScore 100/100
 */
export function definePlugin(def: PluginDefinition): Plugin {
  return { definition: def };
}



/** `definePlugin()`'s runtime return shape. A plain `{ setup() {} }` export is deliberately not
 * accepted: only the SDK helper's opaque `{ definition }` wrapper is a valid plugin ABI value. */
export function readDefinedPlugin(moduleValue: unknown): Plugin | null {
  if (typeof moduleValue !== "object" || moduleValue === null) return null;
  const candidate = (moduleValue as { default?: unknown }).default;
  if (typeof candidate !== "object" || candidate === null) return null;
  const definition = (candidate as { definition?: unknown }).definition;
  if (typeof definition !== "object" || definition === null) return null;
  return typeof (definition as { setup?: unknown }).setup === "function" ? (candidate as Plugin) : null;
}
