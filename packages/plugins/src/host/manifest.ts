/**
 * @file `PluginManifest` type + `validateManifest()` — static, collect-all manifest validation
 * (SPEC-005 REQ-01, BR-02/BR-03; ADR-024 `tier`, 1.1.1 fix).
 *
 * Purpose:
 * Pure, no-I/O validation of an already-parsed `tovu.plugin.json` object against the v1 required-
 * field set, id/folder match, capability vocabulary, hook vocabulary, and field-declaration rules.
 * Consumed by both `discovery.ts` (list-time, every discovery pass) and `loader.ts` (enable-time
 * re-validation, BR-05) — one validator, two call sites, never diverging (mirrors SPEC-004's theme
 * validator shape, per feature.spec.md's own Article IV note).
 *
 * Division of labor (a TDD design decision, not itself a spec requirement): BR-02 step (1),
 * "package-level (size, disallowed files, server/index.mjs presence)", requires a directory
 * listing this function's contract deliberately does NOT take as input (Implementation Outline
 * C-006: `{ manifest: unknown, folderName: string, builtInIds: string[] }` — no file-list
 * parameter). Package-level filesystem checks are therefore `discovery.ts`'s responsibility
 * (REQ-02/03's discovery step, which does read the filesystem); this function owns BR-02 steps
 * (2)-(6) only: manifest / identity / capabilities / hooks / fields. `discovery.ts` merges both
 * error sets into one `PluginDiscoveryRecord.errors[]` array before listing/enabling a plugin.
 *
 * Architectural role:
 * TDD-certified implementation (implementation outline C-005/C-006). Signature and JSDoc are
 * design-frozen; `validateManifest()` collects every BR-02 steps (2)-(6) violation (identity,
 * engine/tier, capabilities, hooks, fields) rather than stopping at the first, returning them in
 * `errors[]` — it never throws. Verified against `__tests__/unit/manifest.unit.test.ts`.
 */

import * as semver from "semver";

import type { HookPoints, ManifestHostPorts } from "./ports.js";



/** ADR-024 §1 trust-tier vocabulary (1.1.1 REQ-01 fix). Literal encoding reused verbatim from the
 * existing, approved SPEC-032/ADR-023 precedent (`DataModuleDecl.pluginTier`). */
export type PluginTier = "tier-1" | "tier-2" | "tier-3";

/** REQ-04's exactly-three v1 capability vocabulary, as manifest-declared strings (validated
 * against this set by `validateManifest`; `@tovu/sdk`'s `CONTENT_READ`/`CONTENT_EXTEND`/
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

/** `tovu.plugin.json` — the ecosystem compatibility surface (state.spec.md §2, ADR-004). */
export interface PluginManifest {
  readonly id: string;
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

/** `tovu.plugin.json`'s `contributes` block — every list optional, every entry a plain name. */
export interface PluginContributions {
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

/** One validation-vocabulary entry (errors.spec.md §3). `file` names the offending packaged file
 * when applicable; `null` for manifest-level errors with no single implicated file. This is the
 * shared shape used verbatim by both `PLUGINS_LIST.plugins[].errors[]` and
 * `PLUGIN_INVALID.details.errors[]` (errors.spec.md §4 — "one validator, two surfaces"). */
export interface PluginValidationError {
  readonly code: string;
  readonly file: string | null;
  readonly message: string;
}

export interface ValidateManifestRequired<H extends HookPoints = HookPoints> extends ManifestHostPorts<H> {
  /** An already-parsed `tovu.plugin.json` value (unparseable JSON is `discovery.ts`'s concern —
   * this function receives a JS value, never a file path or raw bytes). */
  readonly manifest: unknown;
  /** The install folder name this manifest was read from (EC-01: `id` must equal this). */
  readonly folderName: string;
  /** Every currently-registered built-in plugin id (DUP-01: a site plugin id equal to a built-in
   * id is `SHADOWS_BUILT_IN`, not silently shadowed). */
  readonly builtInIds: readonly string[];
}

export type ValidateManifestOptional = Record<string, never>;

export interface ValidateManifestResult {
  /** Every applicable error, collected — NOT first-failure (BR-02). Empty when the manifest is
   * statically valid (integrity/`sdkRange` are separate, load-pipeline-time checks, BR-01). */
  readonly errors: readonly PluginValidationError[];
}

/**
 * Validates one already-parsed manifest against BR-02 steps (2)-(6), collecting every applicable
 * error rather than stopping at the first (BR-02: "collect ALL statically-determinable errors").
 * Pure — no I/O, no mutation of `manifest`.
 *
 * @throws Nothing — validation failures are reported via the returned `errors` array, never a
 * thrown error (this function itself cannot fail; a malformed top-level shape, e.g. `manifest`
 * being `null` or an array, is itself a `MANIFEST_MALFORMED` entry in the result, not a throw).
 * @complexity O(fields.length + capabilities.length + hooks.length) — bounded by one manifest's
 * own declared arrays, never by external/unbounded input.
 */
/** REQ-01's required top-level manifest keys — every one of these must be present. */
const REQUIRED_KEYS = [
  "id",
  "name",
  "version",
  "sdkRange",
  "engine",
  "tier",
  "capabilities",
  "hooks",
  "fields",
  "integrity",
] as const;

/** REQ-01's "parsed-and-stored but unused in v1" forward-compat keys — allowed, never validated. */
const OPTIONAL_KEYS = ["adminSurfaces", "contentTypes", "provenance", "dependencies", "contributes"] as const;

const ALLOWED_KEYS = new Set<string>([...REQUIRED_KEYS, ...OPTIONAL_KEYS]);
const VALID_TIERS = new Set<PluginTier>(["tier-1", "tier-2", "tier-3"]);
const VALID_FIELD_TYPES = new Set(["string", "integer", "number", "boolean"]);
/** The one plugin-contract version this runtime understands in v1 (REQ-01). A manifest declaring
 * any other value is `ENGINE_UNSUPPORTED` — there is no older version to be backward-compatible
 * with yet, so "not exactly 1" and "newer than supported" coincide in practice. */
const SUPPORTED_ENGINE_VERSION = 1;
const ID_PATTERN = /^[a-z0-9-]+$/;
const MAX_ID_LENGTH = 50;

function malformed(message: string): PluginValidationError {
  return { code: "MANIFEST_MALFORMED", file: null, message };
}

/** Result of {@link validateId}: the id-related errors plus the resolved string id (`undefined`
 * when `raw.id` was absent or not a string), so callers needing the id (field-path namespacing)
 * don't have to re-derive it. */
interface IdValidationResult {
  readonly errors: readonly PluginValidationError[];
  readonly id: string | undefined;
}

/** Unknown-key and missing-required-key checks (BR-02 step 1's manifest-shape half). */
function validateKeys(raw: Readonly<Record<string, unknown>>): PluginValidationError[] {
  const errors: PluginValidationError[] = [];
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      errors.push(malformed(`unknown manifest key '${key}'`));
    }
  }
  for (const key of REQUIRED_KEYS) {
    if (raw[key] === undefined) {
      errors.push(malformed(`missing required manifest field '${key}'`));
    }
  }
  return errors;
}

/** id shape only: pattern + length (BR-02 step 2 half of id validation). */
function validateIdFormat(id: string): PluginValidationError[] {
  if (!ID_PATTERN.test(id) || id.length < 1 || id.length > MAX_ID_LENGTH) {
    return [malformed(`id '${id}' must match ${ID_PATTERN} and be 1-${MAX_ID_LENGTH} characters`)];
  }
  return [];
}

/** The owner id the claim system gives Tovu core (`plugin-claims.ts` re-exports it). Conflict
 * detection never compares an owner with itself, so a plugin with this id would never conflict with
 * core's reserved routes, tools or permissions — it is refused as an id instead. */
export const CORE_OWNER_ID = "core";

/** id identity: reserved id + folder match + built-in shadowing (BR-02 step 3, DUP-01). */
function validateIdIdentity(id: string, folderName: string, builtInIds: readonly string[], coreOwnerName: string): PluginValidationError[] {
  const errors: PluginValidationError[] = [];
  if (id === CORE_OWNER_ID) {
    errors.push({ code: "ID_RESERVED", file: null, message: `id '${id}' is reserved for ${coreOwnerName}` });
  }
  if (id !== folderName) {
    errors.push({
      code: "ID_FOLDER_MISMATCH",
      file: null,
      message: `manifest id '${id}' does not match its install folder name '${folderName}'`,
    });
  }
  if (builtInIds.some((builtInId) => builtInId.toLowerCase() === id.toLowerCase())) {
    errors.push({
      code: "SHADOWS_BUILT_IN",
      file: null,
      message: `id '${id}' shadows an existing built-in plugin id`,
    });
  }
  return errors;
}

/** id: presence/type gate, then format + folder match + built-in shadowing (BR-02 step 2/3). */
function validateId(
  raw: Readonly<Record<string, unknown>>,
  folderName: string,
  builtInIds: readonly string[],
  coreOwnerName: string
): IdValidationResult {
  const id = typeof raw.id === "string" ? raw.id : undefined;
  if (raw.id !== undefined && id === undefined) {
    return { errors: [malformed("'id' must be a string")], id };
  }
  if (id === undefined) {
    return { errors: [], id };
  }
  return { errors: [...validateIdFormat(id), ...validateIdIdentity(id, folderName, builtInIds, coreOwnerName)], id };
}

/** The one hash format `loader.ts` computes and compares (`sha256-` + 64 lowercase hex). */
const INTEGRITY_HASH_PATTERN = /^sha256-[0-9a-f]{64}$/;

/**
 * `value` is a strict SemVer string written in canonical form. `semver.valid()` alone is not enough:
 * it also accepts `v1.0.0` or padded text, and the canonical string it returns drops build metadata,
 * so comparing against it would refuse a valid `1.0.0+build.42`. The build suffix is re-appended.
 *
 * @complexity O(n) for n characters.
 */
function isExactSemver(value: string): boolean {
  const parsed = semver.parse(value);
  if (parsed === null) return false;
  const build = parsed.build.length > 0 ? `+${parsed.build.join(".")}` : "";
  return `${parsed.version}${build}` === value;
}

/**
 * name, version and integrity shapes (REQ-01: `name`, `version` (semver), `integrity` (SHA-256 per
 * packaged file)). Presence is `validateKeys`' job; a present-but-wrong value is caught here so it
 * fails at discovery rather than later: a non-semver version cannot take part in latest-by-semver
 * selection (AC-09), and a malformed hash can never match, so it would only surface at load time
 * as a misleading INTEGRITY_FAILED (F3193).
 */
function validateIdentityFields(raw: Readonly<Record<string, unknown>>): PluginValidationError[] {
  const errors: PluginValidationError[] = [];
  if (raw.name !== undefined && (typeof raw.name !== "string" || raw.name.trim() === "")) {
    errors.push(malformed("'name' must be a non-empty string"));
  }
  if (raw.version !== undefined && (typeof raw.version !== "string" || !isExactSemver(raw.version))) {
    errors.push(malformed(`version '${String(raw.version)}' must be a semver version (e.g. 1.0.0)`));
  }
  if (raw.integrity === undefined) return errors;
  if (typeof raw.integrity !== "object" || raw.integrity === null || Array.isArray(raw.integrity)) {
    errors.push(malformed("'integrity' must be an object mapping packaged file paths to sha256 hashes"));
    return errors;
  }
  for (const [file, hash] of Object.entries(raw.integrity)) {
    if (file === "" || typeof hash !== "string" || !INTEGRITY_HASH_PATTERN.test(hash)) {
      errors.push(malformed(`integrity entry '${file}' must be 'sha256-' followed by 64 lowercase hex characters`));
    }
  }
  return errors;
}

/** engine (BR-02 step 2). */
function validateEngine(raw: Readonly<Record<string, unknown>>): PluginValidationError[] {
  if (raw.engine === undefined) {
    return [];
  }
  if (typeof raw.engine !== "number" || !Number.isInteger(raw.engine) || raw.engine < 1) {
    return [malformed("'engine' must be a positive integer")];
  }
  if (raw.engine !== SUPPORTED_ENGINE_VERSION) {
    return [
      {
        code: "ENGINE_UNSUPPORTED",
        file: null,
        message: `engine ${raw.engine} is not supported by this runtime (supports ${SUPPORTED_ENGINE_VERSION})`,
      },
    ];
  }
  return [];
}

/** tier (BR-02 step 2, ADR-024 §1 / 1.1.1 fix). */
function validateTier(raw: Readonly<Record<string, unknown>>): PluginValidationError[] {
  if (raw.tier === undefined) {
    return [];
  }
  if (typeof raw.tier !== "string" || !VALID_TIERS.has(raw.tier as PluginTier)) {
    return [malformed(`tier '${String(raw.tier)}' must be one of tier-1 | tier-2 | tier-3`)];
  }
  return [];
}

/** capabilities (BR-02 step 4, REQ-04). */
function validateCapabilities(raw: Readonly<Record<string, unknown>>, vocabulary: readonly string[]): PluginValidationError[] {
  const errors: PluginValidationError[] = [];
  const capabilities = Array.isArray(raw.capabilities) ? raw.capabilities : [];
  if (raw.capabilities !== undefined && !Array.isArray(raw.capabilities)) {
    errors.push(malformed("'capabilities' must be an array"));
  }
  for (const capability of capabilities) {
    if (typeof capability !== "string" || !vocabulary.includes(capability)) {
      errors.push({
        code: "CAPABILITY_UNKNOWN",
        file: null,
        message: `capability '${String(capability)}' is outside the v1 vocabulary`,
      });
    }
  }
  return errors;
}

/** hooks (BR-02 step 5, REQ-05, INV-06 anti-hook-soup). */
function validateHooks(raw: Readonly<Record<string, unknown>>, hooksVocabulary: readonly string[]): PluginValidationError[] {
  const errors: PluginValidationError[] = [];
  const hooks = Array.isArray(raw.hooks) ? raw.hooks : [];
  if (raw.hooks !== undefined && !Array.isArray(raw.hooks)) {
    errors.push(malformed("'hooks' must be an array"));
  }
  for (const hook of hooks) {
    if (typeof hook !== "string" || !hooksVocabulary.includes(hook)) {
      errors.push({ code: "HOOK_UNKNOWN", file: null, message: `hook point '${String(hook)}' is not declared by core` });
    }
  }
  return errors;
}

/** Path namespacing half of one `fields[]` entry (BR-02 step 6 part 1). */
function validateFieldPath(decl: Readonly<Record<string, unknown>>, expectedPrefix: string): PluginValidationError | undefined {
  if (typeof decl.path === "string" && decl.path.startsWith(expectedPrefix) && decl.path.length > expectedPrefix.length) {
    return undefined;
  }
  return {
    code: "FIELD_PATH_INVALID",
    file: null,
    message: `field path '${String(decl.path)}' must be namespaced to this plugin's own id ('${expectedPrefix}*')`,
  };
}

/** Declared type half of one `fields[]` entry (BR-02 step 6 part 2). */
function validateFieldType(decl: Readonly<Record<string, unknown>>): PluginValidationError | undefined {
  if (typeof decl.type === "string" && VALID_FIELD_TYPES.has(decl.type)) return undefined;
  return malformed(`field '${String(decl.path)}' has an unrecognized type '${String(decl.type)}'`);
}

/**
 * `queryable` half of one `fields[]` entry (BR-02 step 6 part 3, EC-04).
 *
 * BUG FIX (this pass — found auditing this exact function for the complexity refactor, not
 * introduced by it): the prior check was `decl.queryable === true`, which only ever rejects the
 * literal boolean `true`. `PluginManifestFieldDecl.queryable` is a REQUIRED `boolean` field, but
 * nothing enforced that shape — a manifest declaring `queryable: "true"` (a string), `queryable: 1`,
 * or omitting `queryable` entirely all produced ZERO errors, silently accepted as if `queryable:
 * false` had been declared. `queryable` currently has no downstream reader anywhere in this
 * codebase (verified: `grep -rn '\.queryable\b'` finds only this file), so today's blast radius is
 * a validator that doesn't validate rather than a live exploit — but the very first consumer that
 * does `if (field.queryable)` on a manifest this function already certified as error-free would
 * treat a JS-truthy non-boolean (`"true"`, `1`, `"false"` — also truthy!) as enabled, quietly
 * defeating the "unsupported in v1" restriction this code exists to enforce. Fixed by requiring the
 * boolean type itself first, matching how {@link validateFieldType} already validates shape before
 * value for its own field. Regression: `manifest.unit.test.ts` ("a non-boolean queryable value...").
 */
function validateFieldQueryable(decl: Readonly<Record<string, unknown>>): PluginValidationError | undefined {
  if (typeof decl.queryable !== "boolean") {
    return malformed(`field '${String(decl.path)}' has an invalid 'queryable' value '${String(decl.queryable)}' — must be a boolean`);
  }
  if (decl.queryable === true) {
    return {
      code: "QUERYABLE_UNSUPPORTED_V1",
      file: null,
      message: `field '${String(decl.path)}' declares queryable:true, unsupported in v1 (OQ-04)`,
    };
  }
  return undefined;
}

/** Optional `description` half of one `fields[]` entry (2026-08-26 addition, see
 *  `PluginManifestFieldDecl.description`'s own doc) — absent is always fine (most fields, and every
 *  pre-existing manifest, declare none); present-but-not-a-non-empty-string is rejected so a typo'd
 *  `description: ""` cannot silently ship an empty, useless search_tools description instead of a
 *  validation error a plugin author can act on. */
function validateFieldDescription(decl: Readonly<Record<string, unknown>>): PluginValidationError | undefined {
  if (decl.description === undefined) return undefined;
  if (typeof decl.description === "string" && decl.description.trim().length > 0) return undefined;
  return {
    code: "FIELD_DESCRIPTION_INVALID",
    file: null,
    message: `field '${String(decl.path)}' declares a 'description' that must be a non-empty string when present`,
  };
}

/** One `fields[]` entry (BR-02 step 6, REQ-06): path namespacing, declared type, `queryable`,
 *  optional `description` — each half delegated to its own validator (see each one's own doc), this
 *  function only shape-gates the entry itself and collects whichever of the four report an error. */
function validateField(field: unknown, expectedPrefix: string): PluginValidationError[] {
  if (typeof field !== "object" || field === null) {
    return [malformed("each 'fields' entry must be an object")];
  }
  const decl = field as Readonly<Record<string, unknown>>;
  return [validateFieldPath(decl, expectedPrefix), validateFieldType(decl), validateFieldQueryable(decl), validateFieldDescription(decl)].filter(
    (error): error is PluginValidationError => error !== undefined,
  );
}

/** fields (BR-02 step 6, REQ-06) — `expectedPrefix` is constant across the array (it depends only
 * on the manifest's own `id`, not on the field being checked), so it's computed once here rather
 * than per-iteration. */
function validateFields(raw: Readonly<Record<string, unknown>>, id: string | undefined): PluginValidationError[] {
  const errors: PluginValidationError[] = [];
  const fields = Array.isArray(raw.fields) ? raw.fields : [];
  if (raw.fields !== undefined && !Array.isArray(raw.fields)) {
    errors.push(malformed("'fields' must be an array"));
  }
  const expectedPrefix = `ext.${id ?? ""}.`;
  for (const field of fields) {
    errors.push(...validateField(field, expectedPrefix));
  }
  return errors;
}

/** The `contributes` lists `validateContributes` accepts, in the order claims are derived. */
export const CONTRIBUTION_KEYS = ["routes", "tools", "tables", "settings", "widgets", "permissions"] as const;
const CONTRIBUTION_KEY_SET = new Set<string>(CONTRIBUTION_KEYS);
/** Tool-id prefixes the runtime generates itself (`capability-tool-registrations.ts`,
 *  `agent-plugins/tool-registrations.ts`) — a plugin declaring one could impersonate another
 *  plugin's generated tool, so they are refused here, before conflict detection ever runs. */
const RESERVED_TOOL_PREFIXES = ["plugin_capability_", "agent_plugin_"] as const;
const ROUTE_PATTERN = /^(?:(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|ANY|\*) )?\/\S*$/i;

function contributesInvalid(message: string): PluginValidationError {
  return { code: "CONTRIBUTES_INVALID", file: null, message };
}

/** Kind-specific shape checks, one per `contributes` list that has more than the shared rule —
 *  each returns the problem in words, or `undefined`. */
const CONTRIBUTION_CHECKS: Readonly<Record<string, (entry: string, id: string | undefined) => string | undefined>> = {
  routes: (entry) => (ROUTE_PATTERN.test(entry) ? undefined : "must be '/path' or 'METHOD /path'"),
  tools: (entry) =>
    RESERVED_TOOL_PREFIXES.some((prefix) => entry.startsWith(prefix)) ? "uses a prefix reserved for generated tools" : undefined,
  tables: (entry, id) => {
    const prefix = `p_${(id ?? "").replace(/-/g, "_")}__`;
    return entry.startsWith(prefix) && entry.length > prefix.length ? undefined : `must be namespaced to this plugin ('${prefix}*')`;
  },
};

/** One entry: the shared no-pattern rule, then its kind's own check. Plugins never claim a `*`
 *  prefix — reserving a whole namespace is core's privilege (see `claim-conflicts.ts` rule 6); a
 *  plugin doing it would squat every future name in it. */
function validateContribution(key: string, entry: string, id: string | undefined): PluginValidationError | undefined {
  // A route's leading `* ` is its METHOD ("every method"), not a name pattern.
  const name = key === "routes" ? entry.replace(/^\* /, "") : entry;
  const problem = name.includes("*") ? "must name one thing, not a '*' pattern" : CONTRIBUTION_CHECKS[key]?.(entry, id);
  return problem === undefined ? undefined : contributesInvalid(`contributes.${key} entry '${entry}' ${problem}`);
}

/** `contributes` (2026-10-04): an object of known string lists — see `PluginManifest.contributes`. */
function validateContributes(raw: Readonly<Record<string, unknown>>, id: string | undefined): PluginValidationError[] {
  if (raw.contributes === undefined || raw.contributes === null) return [];
  if (typeof raw.contributes !== "object" || Array.isArray(raw.contributes)) {
    return [contributesInvalid("'contributes' must be an object of string lists")];
  }
  const errors: PluginValidationError[] = [];
  for (const [key, list] of Object.entries(raw.contributes)) {
    if (!CONTRIBUTION_KEY_SET.has(key)) {
      errors.push(contributesInvalid(`unknown contributes key '${key}' (expected one of ${CONTRIBUTION_KEYS.join(", ")})`));
      continue;
    }
    if (!Array.isArray(list) || list.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
      errors.push(contributesInvalid(`contributes.${key} must be a list of non-empty strings`));
      continue;
    }
    for (const entry of list as string[]) {
      const error = validateContribution(key, entry, id);
      if (error) errors.push(error);
    }
  }
  return errors;
}

/**
 * Validates one already-parsed manifest against BR-02 steps (2)-(6), collecting every applicable
 * error rather than stopping at the first (BR-02: "collect ALL statically-determinable errors").
 * Pure — no I/O, no mutation of `manifest`.
 *
 * @throws Nothing — validation failures are reported via the returned `errors` array, never a
 * thrown error (this function itself cannot fail; a malformed top-level shape, e.g. `manifest`
 * being `null` or an array, is itself a `MANIFEST_MALFORMED` entry in the result, not a throw).
 * @complexity O(fields.length + capabilities.length + hooks.length) — bounded by one manifest's
 * own declared arrays, never by external/unbounded input.
 */
export function validateManifest<H extends HookPoints>(
  required: ValidateManifestRequired<H>,
  _optional: ValidateManifestOptional = {}
): ValidateManifestResult {
  const { manifest, folderName, builtInIds } = required;

  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return { errors: [malformed("tovu.plugin.json must be a JSON object")] };
  }

  // Treat the input as a read-only bag of unknown values — never assigned back into.
  const raw = manifest as Readonly<Record<string, unknown>>;
  const { errors: idErrors, id } = validateId(raw, folderName, builtInIds, required.coreOwnerName);

  const errors: PluginValidationError[] = [
    ...validateKeys(raw),
    ...idErrors,
    ...validateIdentityFields(raw),
    ...validateEngine(raw),
    ...validateTier(raw),
    ...validateCapabilities(raw, required.capabilityVocabulary),
    ...validateHooks(raw, required.pluginSdkBinding.hookIds),
    ...validateFields(raw, id),
    ...validateContributes(raw, id),
    // AW-7 Tier 1: `contentTypes` grammar and the tier-1 "no code surface" rule.
    ...required.declarativeContentTypes.validateManifest({ manifest: raw }).errors,
  ];

  return { errors };
}
