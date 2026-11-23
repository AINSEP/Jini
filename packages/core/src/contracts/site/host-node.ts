/**
 * @file The plugin host's discovery record, package-file listing and installer port, with the
 * manifest shapes they carry, as types only.
 *
 * An additive copy of the declarations in `@jini-ai/plugins/host/node` (`discovery-types.ts`,
 * `manifest-types.ts`, `plugin-claims.ts`, `node/package-files.ts`, `node/install.ts`) and of
 * `PluginIdentityExtension` from `@jini-ai/core/plugin-directory`; those modules keep their
 * identical declarations, values and exports until the paired cutover.
 */
import type { PluginProviderDeclaration } from '../plugin-sdk.js';
import type { PluginConflict } from "./plugins-host.js";

/** Identical identity metadata for portable agent packages and host site plugins. */
export interface PluginIdentityExtension {
  readonly id?: string;
  readonly provides?: readonly string[];
  readonly [key: string]: unknown;
}

export interface BrowserProviderDeclaration {
  readonly id: string;
  readonly kind: 'chart';
  readonly contractVersion: 1;
  readonly kinds: readonly string[];
  readonly javascript: string;
  readonly stylesheet?: string;
}

/** Trust-tier vocabulary. Literal encoding reused verbatim from the
 * existing, approved data-module precedent (`DataModuleDecl.pluginTier`). */
export type PluginTier = "tier-1" | "tier-2" | "tier-3";

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

/** `jini.plugin.json` — the ecosystem compatibility surface. */
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
   * does not mount yet (settings, widgets, routes — `adminSurfaces` are still unwired) is
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
  /** Data-module tables — must sit in this plugin's own `p_{id}__` namespace. */
  readonly tables?: readonly string[];
  readonly settings?: readonly string[];
  readonly widgets?: readonly string[];
  /** Permission ids this plugin DEFINES (not ones it merely requires). */
  readonly permissions?: readonly string[];
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


/** In-memory, rebuilt each discovery pass — NOT persisted (state.spec.md §2). Feeds `PLUGINS_LIST`
 * once activation state is projected onto it by the caller (the HTTP route layer, C-016/C-017 —
 * discovery itself does not know about `plugin_activations`). */
export interface PluginDiscoveryRecord {
  readonly warnings?: readonly string[];
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly source: "built-in" | "site";
  /** (1.1.2, REQ-10/REQ-18) The plugin's trust tier, projected verbatim from the already-required
   * `PluginManifest.tier` — mirrors how `source` already passes through
   * unchanged. Optional on this stub type only so pre-existing fixtures in unrelated test files
   * (`activation.integration.test.ts`, `loader.integration.test.ts`) that construct
   * `PluginDiscoveryRecord` literals for concerns unrelated to REQ-10/`PLUGINS_LIST` are not forced
   * to retrofit it; the real `discoverPlugins()` implementation must always populate it (a
   * discovered plugin's manifest always has a validated `tier` by the time a record exists),
   * enforced behaviorally by the dedicated REQ-10 pass-through tests in `plugins-dto.unit.test.ts`
   * / `plugins-http.integration.test.ts`, not by widening this field to non-optional everywhere. */
  readonly tier?: "tier-1" | "tier-2" | "tier-3";
  readonly status: "valid" | "invalid" | "incompatible";
  readonly errors: readonly PluginValidationError[];
  /**
   * (Milestone 1b, 2026-08-20) The already-parsed, already-`validateManifest()`-checked manifest
   * this record was built from — present after manifest validation (`undefined` otherwise:
   * an invalid/incompatible candidate's raw JSON may not conform to `PluginManifest`'s shape at
   * all, so this field never claims a validated type for a manifest that failed validation).
   * A later whole-set publisher collision omits the losing manifest and marks its record invalid.
   * The incumbent keeps its reservation; the rejected claim must not reappear in host lookup.
   *
   * Exists so a composition root's enable path (`packages/plugins/src/host/node/runtime-core.ts`'s `onPluginEnabled()`)
   * can hand `loadPlugin()` the SAME manifest object this discovery pass already parsed, instead of
   * re-reading `jini.plugin.json` a second time. This matters beyond avoiding duplicate I/O: every
   * real caller of `onPluginEnabled` (`activation.ts`'s `setPluginEnabled`, BR-05 step 1) already
   * calls `discoverPlugins()` fresh, in the SAME request, immediately before invoking it (see
   * a host module) — so reusing that record's manifest is not a staleness
   * risk, it is the one-and-only read for this attempt. A second, independent load-time re-read
   * would instead open a narrow TOCTOU window: an attacker who can write to `installDir` between
   * the discovery read and a second load-time read could swap in a self-consistent tampered
   * manifest+entry pair that the discovery pass never actually validated. Reusing this field closes
   * that window by construction — there is only one read to race against, not two.
   *
   * Built-in records also carry it (trivially, from `BuiltInPluginSource.manifest`) for type
   * uniformity, but `onPluginEnabled`'s built-in branch does not need it — it already has the
   * composition root's own static `PluginRuntimeSource.manifest`, unchanged from before this slice.
   */
  readonly manifest?: PluginManifest | undefined;
}

export type PluginPackageFileOmission = "binary" | "too-large" | "symlink" | "unreadable";

export interface PluginPackageFile {
  /** `/`-separated, relative to the plugin's own directory. */
  readonly relativePath: string;
  /** Bytes on disk; `0` for a symlink or a file that could not be opened. */
  readonly sizeBytes: number;
  /** The file's UTF-8 text — `null` exactly when `omitted` is set. */
  readonly content: string | null;
  readonly omitted: PluginPackageFileOmission | null;
}

export interface PluginPackageFiles {
  readonly files: readonly PluginPackageFile[];
  /** A file-count, entry, or total-byte cap stopped the walk before every file was listed. */
  readonly truncated: boolean;
}

export interface PluginInstallPreview {
  readonly warnings?: readonly string[];
  readonly publisherId?: string;
  readonly provides?: readonly string[];
  readonly keywords?: readonly string[];
  id: string; name: string; version: string; tier: PluginTier;
  capabilities: readonly string[]; hooks: readonly string[];
  /** `false` only for a tier-1 (manifest-only) package — the runtime never imports anything for it. */
  hasCode: boolean; digest: string; upgradeFrom?: string;
  /** Content-type keys the manifest declares (AW-7 Tier 1); created when the plugin is turned on. */
  contentTypes: readonly string[];
  /** What turning it on would clash with — see {@link PluginInstallDeps.conflicts}. Informational
   *  only: not part of the consent digest, and enable re-checks (the enable-time conflict gate). */
  conflicts: readonly PluginConflict[];
}
export type PluginInstallInput = ({ sourceDir: string; archive?: never } | { archive: Uint8Array; sourceDir?: never }) & { replace?: boolean };
export interface PluginInstallerPort {
  preview(required: PluginInstallInput, optional?: PluginInstallOptions): Promise<PluginInstallPreview>;
  install(required: PluginInstallInput & { expectedDigest: string }, optional?: PluginInstallOptions): Promise<PluginInstallPreview>;
}
/** Not a model input: the source authoring service opts into immutable version publication. */
export interface PluginInstallOptions { readonly versionAppend?: boolean }
