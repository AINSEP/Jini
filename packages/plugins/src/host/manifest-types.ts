/** Manifest data contracts do not depend on validation or host composition. */
import type { PluginIdentityExtension } from '@jini-ai/core/plugin-directory';

export interface BrowserProviderDeclaration {
  readonly id: string;
  readonly kind: 'chart';
  readonly contractVersion: 1;
  readonly kinds: readonly string[];
  readonly javascript: string;
  readonly stylesheet?: string;
}

/** ADR-024 §1 trust-tier vocabulary (1.1.1 REQ-01 fix). Literal encoding reused verbatim from the
 * existing, approved SPEC-032/ADR-023 precedent (`DataModuleDecl.pluginTier`). */
export type PluginTier = "tier-1" | "tier-2" | "tier-3";

/** REQ-04's exactly-three v1 capability vocabulary, as manifest-declared strings (validated
 * against this set by `validateManifest`; `@jini-ai/plugin-sdk`'s `CONTENT_READ`/`CONTENT_EXTEND`/
 * `HOOKS_ATTACH` constants are the same literal values, kept independent here so this module has
 * no dependency on the SDK package per the Module Map). Sourced from `core/`'s
 * `SharedExtensionCapability` — the sibling `site-glue` mechanism's own capability vocabulary
 * declares this same three-member set as its first three members; both import the one shared
 * declaration rather than each retyping the literals (2026-08-20 swarm-consensus synthesis,
 * Result 1). */
export type PluginCapability = string;

/** REQ-06 field declaration — `ext.{pluginId}.{field}` (BR-06). `queryable` MUST be `false` in
 * v1 (EC-04); a `true` value is a validation error (`QUERYABLE_UNSUPPORTED_V1`), not silently
 * coerced. */
export interface PluginManifestFieldDecl {
  readonly path: string;
  readonly type: "string" | "integer" | "number" | "boolean";
  readonly queryable: boolean;
  /**
   * Optional, human-readable, action-oriented description of what this field represents and how an
   * agent should use it (2026-08-26 addition — `features/plugin-runtime/capability-tool-registrations.ts`
   * is the sole consumer: it is folded into the indexed `search_tools` description for this plugin's
   * capability-read tool when the plugin is enabled). Absent on every pre-existing manifest — this
   * is additive, not a widened requirement, so no previously-valid manifest becomes invalid by
   * omitting it; a plugin author who wants their capability to rank well against a real user query
   * simply adds one.
   */
  readonly description?: string;
}

/** `jini.plugin.json` — the ecosystem compatibility surface (state.spec.md §2, ADR-004). */
export interface PluginManifest {
  /** Storage/activation key. Publisher identity lives in extensions[identityNamespace].id. */
  readonly id: string;
  readonly keywords?: readonly string[];
  readonly extensions?: Readonly<Record<string, PluginIdentityExtension>>;
  readonly name: string;
  readonly version: string;
  readonly sdkRange: string;
  readonly engine: number;
  readonly tier: PluginTier;
  readonly capabilities: readonly string[];
  readonly hooks: readonly string[];
  readonly fields: readonly PluginManifestFieldDecl[];
  readonly integrity: Readonly<Record<string, string>>;
  /** Parsed-and-stored, UNUSED in v1 (forward-compat, no behavior — state.spec.md §2). */
  readonly adminSurfaces?: readonly unknown[] | null;
  /** Reviewed bundled chart assets only; host admission supplies trust outside this manifest. */
  readonly browserProviders?: readonly BrowserProviderDeclaration[];
  /** Content types the plugin declares (AW-7 Tier 1, 2026-10-04) — no longer unused: validated by
   *  `declarative-content-types.ts`, claimed by key (`plugin-claims.ts`), created at enable. */
  readonly contentTypes?: readonly unknown[] | null;
  readonly provenance?: { readonly sourceUrl?: string; readonly signature?: string } | null;
  readonly dependencies?: Readonly<Record<string, string>> | null;
  /**
   * What this plugin says it provides, by name (2026-10-04, conflict detection — see
   * `plugin-claims.ts` and `ADS-memory/specs/005-plugin-system/conflicts.spec.md`). Optional and
   * additive: a manifest without it claims only what its other fields already imply (its hooks and,
   * when it declares `fields`, its generated capability tool). Each entry is a CLAIM: two enabled
   * plugins, or a plugin and core, naming the same thing is refused at enable time and quarantined
   * at boot rather than silently letting one overwrite the other. Declaring a surface the runtime
   * does not mount yet (settings, widgets, routes — ADR-025/`adminSurfaces` are still unwired) is
   * still binding for conflicts, so a plugin cannot squat a name today that a future mount would
   * then have to arbitrate.
   */
  readonly contributes?: PluginContributions | null;
}

/** `jini.plugin.json`'s `contributes` block — optional named surfaces and provider declarations. */
export interface PluginContributions {
  /** Server provider factories; identity is exclusive within one contract. */
  readonly providers?: readonly PluginProviderDeclaration[];
  /** `"METHOD /path"` or `"/path"` (every method). Parameter names do not distinguish routes. */
  readonly routes?: readonly string[];
  /** Agent tool ids. The generated prefixes `plugin_capability_`/`agent_plugin_` are reserved. */
  readonly tools?: readonly string[];
  /** Data-module tables — must sit in this plugin's own `p_{id}__` namespace (ADR-023 §5). */
  readonly tables?: readonly string[];
  readonly settings?: readonly string[];
  readonly widgets?: readonly string[];
  /** Permission ids this plugin DEFINES (not ones it merely requires). */
  readonly permissions?: readonly string[];
}

export interface PluginProviderDeclaration {
  readonly contract: string;
  readonly id: string;
  readonly contractVersion: 1;
  /**
   * The settings a host collects (on its own secure settings card) and passes to this provider's
   * factory as `required[name]`. Declared here, not in code, so a host can render the card and decide
   * "configured?" without executing the plugin. Secret fields are sealed by the host and never shown back.
   */
  readonly settings?: readonly PluginProviderSettingField[];
}

/** One declared provider setting; `name` is the factory input key. */
export interface PluginProviderSettingField {
  readonly name: string;
  readonly label: string;
  readonly secret?: boolean;
  readonly required?: boolean;
  /** Waive on an exact choice, or when `orPresent` names a nonblank alternative (kept secrets count). */
  readonly requiredUnless?: { readonly field: string; readonly equals: string; readonly orPresent?: string };
  /** Require this field only when the controlling public setting is one of these values. */
  readonly requiredWhen?: { readonly field: string; readonly in: readonly string[] };
  readonly hint?: string;
  /** Public fields only: the value a host prefills and uses while none is saved (e.g. a vendor's cloud host). */
  readonly default?: string;
  /** Public fields only: a host renders a select of these choices instead of free text. */
  readonly options?: readonly PluginProviderSettingOption[];
  /** With `options`: also offer "Custom…" free text (e.g. a self-hosted URL). */
  readonly allowCustom?: boolean;
}

/** One choice of a {@link PluginProviderSettingField}'s `options`. */
export interface PluginProviderSettingOption {
  readonly value: string;
  readonly label: string;
}

/** One validation-vocabulary entry (errors.spec.md §3). `file` names the offending packaged file
 * when applicable; `null` for manifest-level errors with no single implicated file. This is the
 * shared shape used verbatim by both `PLUGINS_LIST.plugins[].errors[]` and
 * `PLUGIN_INVALID.details.errors[]` (errors.spec.md §4 — "one validator, two surfaces"). */
export interface PluginValidationError {
  readonly code: string;
  readonly file: string | null;
  readonly message: string;
}
