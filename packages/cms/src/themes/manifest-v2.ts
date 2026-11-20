import { isObject, checkApiVersion, checkId, checkName, checkVersionField, checkTier, checkFontStylesheets, checkEngine, checkTokens, checkLicense, checkAuthors, checkAttributions, checkPartials, checkRegions, checkRenderer } from "./manifest-v2-fields.js";
import type { JsonValue } from "@jini-ai/core/primitives";

import { parseTemplateFor, rejectTemplateFor } from "./template-applicability.js";

/** One finding from any check module — a rule id (grep-able, stable across message rewording), a
 * human-readable message, and the package-relative path it concerns, when the finding is
 * file-scoped rather than manifest- or package-wide. */
export interface ThemeValidationIssue {
  readonly ruleId: string;
  readonly message: string;
  readonly path?: string;
}

/**
 * @file Strict schema check for a `theme.json` declaring `apiVersion: 2` — the settled shape from
 * `development/docs/themes/theme-authoring-guide-v2.md` §5, made `additionalProperties: false` at the
 * top level (§16: "Unknown top-level manifest fields REJECTED (fail-closed)").
 *
 * ONLY invoked when `raw.apiVersion === 2` (see `validate-theme-package.ts`'s orchestrator). As of the
 * 2026-08-18 Milestone 3 migration, all seven built-in static themes (`content/themes/static/*`) declare
 * `apiVersion: 2` and run through THIS module — it is production-critical, not speculative. A theme
 * with no `apiVersion` field (a v1 theme, none of which remain among the built-ins, but a site-authored
 * or marketplace one still can be) is unaffected, validated through `loadTheme()`'s own existing
 * (loose, v1) parsing instead, unchanged.
 *
 * Deliberately does NOT re-implement `loadTheme()`'s own already-enforced rules (tier validity,
 * `build.source: "compiled"`'s three conditional requirements, the `sourceDir`/generated-directory
 * conflict) — those stay the single source of truth there; this module's checks are ADDITIVE:
 * `apiVersion`/`$schema` shape, top-level field closure, and the v2-only restructured fields
 * (`engine` as an object, `tokens` as a nested object, `authors`/`license`/`attributions`) nothing
 * else validates yet.
 *
 * Declared `scripts` use the shared consent declaration validator. `assets` and `ai` remain LIGHT
 * on shape: their target shape is not concretely pinned down enough to enforce strictly without inventing scope beyond what the design doc settled
 * (the doc itself marks `ai` "NOT YET IMPLEMENTED anywhere", §12), so neither gets a
 * dedicated `isObject`/field-shape check here — only whatever generic JSON-object closure the
 * top-level schema already implies. They are NOT light on the unimplemented-field policy, though:
 * both (plus dead `pages`) are unread by the loader (§15's field table; verified below) and get the
 * same `v2-*-unimplemented` treatment as `partials`/`renderer`/`tokens`/`engine`, via the generic sweep
 * described next. Tightening their SHAPE checking is future work once an actual implementation settles
 * it; tightening whether declaring them is safe is this fix.
 *
 * `engine` (object-valued), nested `tokens`, `partials`, and `renderer` get a STRONGER treatment than
 * merely "light" (2026-08-19 architecture audit finding 3): each is still schema-checked when present
 * (an actually malformed one is a hard error at any profile), but ALSO carries its own
 * `v2-*-unimplemented` finding whenever present, valid or not — `loadTheme()` does not read any of
 * these four fields today (see each check's own comment for the exact loader line that proves it), so
 * "schema-valid" must not silently mean "the runtime will honor this." `profiles.ts`'s
 * `resolveSeverity` recognizes any `v2-*-unimplemented` rule id by NAMING CONVENTION (not a manually
 * maintained list — see its own doc) and makes that a `warning` under `author` (drafting ahead of the
 * loader is the design doc's own stated intent for `[TARGET]` fields) and a hard `error` under
 * `install`/`publish` — a package must not actually be installed or listed while claiming a field the
 * runtime will silently ignore. This closes the exact repro the audit found: a marketplace fixture
 * declaring `partials.hero.source` used to pass `validateThemePackage({ profile: "install" })` cleanly
 * and then render with that partial unresolved, because the runtime reads `slots`, never `partials`.
 *
 * RE-AUDIT (2026-08-19, `gpt-5.6-sol` and `gpt-5.6-terra` independently): the four-field list above
 * was itself incomplete — this file's OWN prior header claimed `scripts`, `assets`, and `ai` were
 * "accepted as loosely-typed optional objects," but no code anywhere actually checked or flagged them,
 * and `pages` (confirmed dead — not read by `theme.ts` or anywhere else in `src/`) was allowed with no
 * finding at all. Rather than hand-adding four more one-off checks (the same manual-list pattern that
 * produced the gap), {@link V2_FIELDS_READ_BY_LOADER} and {@link V2_RESERVED_METADATA_FIELDS} below
 * make the unimplemented set SELF-MAINTAINING: `validateManifestV2`'s closing sweep flags every
 * top-level v2 key present in the manifest that isn't on one of those two verified lists, so a future
 * field can no longer silently skip this policy the way these four did. Both lists were built by
 * direct inspection of `theme.ts`'s manifest-parse block (`theme.ts:661-684`) and a repo-wide grep for
 * every other candidate field name — not by trusting this file's own prior comments, which is exactly
 * how the `scripts`/`assets`/`ai` gap happened in the first place.
 *
 * `modes`/`defaultMode`/`slots` are accepted with NO unimplemented finding, for the opposite reason
 * from the previous paragraph: they are REAL, load-bearing v1 fields `loadTheme()` reads flat off the
 * manifest root, completely apiVersion-agnostic (`theme.ts`'s manifest-parse block) — `slots` drives
 * which root partial file satisfies which named slot, `modes`/`defaultMode` drive dark/light token
 * switching. The design doc's own worked example nests `defaultMode`/`modes` under `tokens` instead —
 * that shape is UNIMPLEMENTED (`readLightTokens` hardcodes the filename `tokens.light.json`, it never
 * reads a `tokens.modes` mapping), so migrating a real theme to the doc's nested shape would silently
 * stop `loadTheme()` from finding `modes`/`defaultMode` at all, breaking dark/light mode for every
 * multi-mode theme (this is exactly what the nested-`tokens` `v2-tokens-unimplemented` check above
 * exists to catch). Keeping these flat here matches what the runtime actually does today.
 *
 * `pages` (an array of page ids) is NOT grouped with `modes`/`defaultMode`/`slots` above, despite
 * `theme-authoring-guide-v2.md` §17's worked examples listing it alongside them — `loadTheme()` does
 * not parse it into `ThemeManifest` at all (confirmed dead: no read anywhere in `src/`, verified by
 * repo-wide grep, not by trusting this file's own prior claim that it was "carried the same way" as
 * the three real fields). It gets the generic `v2-pages-unimplemented` sweep finding like
 * `assets`/`ai` above.
 */

/** Top-level keys schema v2 recognizes (`theme-authoring-guide-v2.md` §5). Anything else in a
 * `apiVersion: 2` manifest is an unknown-field rejection. */
const V2_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "$schema",
  "apiVersion",
  "id",
  "name",
  "version",
  "tier",
  "engine",
  "compatibility",
  "description",
  "author",
  "license",
  "authors",
  "attributions",
  "category",
  "tags",
  "tokens",
  "fonts",
  "fontStylesheets",
  "renderer",
  "partials",
  "regions",
  "scripts",
  "assets",
  "ai",
  "build",
  "modes",
  "defaultMode",
  "pages",
  "slots",
  "templates",
  "templateFor",
  "publishedPages",
]);

/**
 * Top-level v2 fields `loadTheme()` (`theme.ts`) actually reads into `ThemeManifest` — verified by
 * direct inspection of its manifest-parse block (`theme.ts:661-684`), not by trusting this file's own
 * prior header comments (a 2026-08-19 re-audit found those stale). `engine` is included even though
 * only its NUMBER form is honored — an object-valued `engine` still gets its own dedicated
 * `v2-engine-object-unimplemented` finding below (that check `flaggedUnimplemented.add`s it so the
 * generic sweep doesn't ALSO double-flag it); this set only decides whether the sweep leaves the KEY
 * alone by default, not whether every shape it can hold is honored.
 */
const V2_FIELDS_READ_BY_LOADER: ReadonlySet<string> = new Set([
  "id",
  "name",
  "version",
  "apiVersion",
  "tier",
  "engine",
  "author",
  "build",
  "description",
  "fonts",
  "fontStylesheets",
  "regions",
  "templates",
  "templateFor",
  "modes",
  "defaultMode",
  "slots",
  "publishedPages",
  "scripts",
]);

/**
 * Top-level v2 fields that are pure descriptive/discovery metadata about the PACKAGE itself (legal
 * credit, marketplace-browse facets) or JSON-Schema tooling plumbing, rather than a claim about
 * runtime rendering behavior. None of these reads as "the theme has configured X" the way
 * `partials`/`renderer`/`scripts`/`assets`/`ai`/`pages` do — declaring a `license` does not imply the
 * runtime enforces or displays it anywhere, so silently not acting on it is not the same defect class
 * as silently ignoring a claimed capability. Deliberately exempt from the unimplemented-field sweep
 * below rather than left to fall through it unnoticed. If any of these gains real runtime behavior
 * later, move it to {@link V2_FIELDS_READ_BY_LOADER} above in the same change that wires it up.
 */
const V2_RESERVED_METADATA_FIELDS: ReadonlySet<string> = new Set([
  "$schema",
  "compatibility",
  "license",
  "authors",
  "attributions",
  "category",
  "tags",
]);

const V2_BUILD_SOURCES: ReadonlySet<string> = new Set(["authored", "compiled"]);
/** Widened from `loadTheme()`'s current closed 3-value union (`theme.ts`'s `parseThemeBuildInfo`) per
 * the design doc §6's "TARGET-widened" framing — descriptive only, matching that field's own real
 * behavior (nothing branches on it). Still fail-closed: an unrecognized string is REJECTED here,
 * where the real v1 parser instead silently drops it — the whole point of the strict v2 schema. */
const V2_BUILD_FRAMEWORKS: ReadonlySet<string> = new Set([
  "react",
  "vue",
  "angular",
  "svelte",
  "astro",
  "solid",
  "qwik",
  "web-components",
]);



/** Reject any top-level key schema v2 does not recognize — the `additionalProperties: false` rule. */
function checkUnknownTopLevelFields(raw: Record<string, unknown>): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];
  for (const key of Object.keys(raw)) {
    if (!V2_TOP_LEVEL_KEYS.has(key)) {
      issues.push({
        ruleId: "v2-unknown-field",
        message: `theme.json: unrecognized top-level field '${key}' (schema v2 is additionalProperties: false)`,
      });
    }
  }
  return issues;
}

/**
 * Self-maintaining unimplemented-field sweep (2026-08-19 re-audit of architecture audit finding 3):
 * every OTHER top-level v2 key actually present in this manifest that the loader does not read
 * (`V2_FIELDS_READ_BY_LOADER`) and that isn't reserved metadata (`V2_RESERVED_METADATA_FIELDS`) gets a
 * generic `v2-<field>-unimplemented` finding automatically. This is what currently fires for
 * `assets`, `ai`, and dead `pages` — none of which had ANY finding before this fix, despite this file's
 * own prior header claiming otherwise for the first three. Because this loop is driven by set
 * membership rather than a hand-maintained list of `err()` calls, a field added to `V2_TOP_LEVEL_KEYS`
 * in the future is flagged by default the moment it's added, unless a change also classifies it into
 * one of the two allow-lists (or gives it its own bespoke check that adds it to `flaggedUnimplemented`,
 * like `partials`/`renderer`/`tokens` above) — the opposite failure mode from before, where a field
 * could be silently allowed until someone remembered to add a check.
 */
function checkUnimplementedFieldSweep(raw: Record<string, unknown>, flaggedUnimplemented: ReadonlySet<string>): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];
  for (const key of Object.keys(raw)) {
    // Unknown keys and flagged fields already have their own specific rule id above.
    if (!V2_TOP_LEVEL_KEYS.has(key) || V2_FIELDS_READ_BY_LOADER.has(key) || V2_RESERVED_METADATA_FIELDS.has(key) || flaggedUnimplemented.has(key)) continue;
    issues.push({
      ruleId: `v2-${key}-unimplemented`,
      message: `theme.json: ${key} is not yet read by the runtime loader (theme.ts) — this declaration will be silently ignored`,
    });
  }
  return issues;
}

/**
 * Strictly parse a raw `theme.json` object already known to declare `apiVersion: 2`.
 *
 * @param required.raw - The parsed `theme.json` content.
 * @returns Every schema violation found; empty means the manifest is v2-schema-clean. Does not throw.
 * @complexity O(k) in the manifest's own (small, fixed) key count.
 */
export function validateManifestV2(
  required: { raw: Record<string, unknown>; validateScripts: (required: { scripts: unknown }) => { problems: readonly string[] }; isSourceDirGeneratedConflict: (required: { sourceDir: string }) => boolean },
  _optional: Record<string, never> = {}
): ThemeValidationIssue[] {
  const { raw, validateScripts, isSourceDirGeneratedConflict } = required;
  const issues: ThemeValidationIssue[] = [];
  // Fields the bespoke checks below already gave their own specific `v2-<field>-unimplemented`
  // finding (with a more useful, field-specific message) — the generic sweep at the bottom of this
  // function skips these so a field never gets flagged twice. `engine` needs no entry here: it's
  // excluded from the sweep via `V2_FIELDS_READ_BY_LOADER` instead (see that set's own doc).
  const flaggedUnimplemented = new Set<string>();

  issues.push(...checkUnknownTopLevelFields(raw));
  issues.push(...validateScripts({ scripts: raw.scripts }).problems.map(message => ({ ruleId: 'v2-scripts', message: `theme.json: ${message}` })));

  issues.push(...checkApiVersion({ value: raw.apiVersion }));
  issues.push(...checkId({ value: raw.id }));
  issues.push(...checkName({ value: raw.name }));
  issues.push(...checkVersionField({ value: raw.version }));
  issues.push(...checkTier({ value: raw.tier }));
  issues.push(...checkFontStylesheets({ value: raw.fontStylesheets }));
  // The runtime parser owns this contract too: schema acceptance must never hide loader rejection.
  try {
    parseTemplateFor({ onInvalid: rejectTemplateFor, value: raw.templateFor, templates: Array.isArray(raw.templates) ? raw.templates.map(String) : undefined });
  } catch (error) {
    issues.push({ ruleId: "v2-template-for", message: (error as Error).message });
  }

  issues.push(...checkEngine({ value: raw.engine }));
  // `engine` is deliberately NOT added to `flaggedUnimplemented` here — the generic sweep already
  // skips it unconditionally via `V2_FIELDS_READ_BY_LOADER` (the key itself IS read, in its number
  // form; only the object shape above is unimplemented, and that already has its own finding).

  if (raw.tokens !== undefined) {
    issues.push(...checkTokens({ value: raw.tokens }));
    flaggedUnimplemented.add("tokens");
  }

  issues.push(...checkLicense({ value: raw.license }));
  issues.push(...checkAuthors({ value: raw.authors }));
  issues.push(...checkAttributions({ value: raw.attributions }));

  if (raw.partials !== undefined) {
    issues.push(...checkPartials({ value: raw.partials }));
    flaggedUnimplemented.add("partials");
  }

  issues.push(...checkRegions({ value: raw.regions }));

  if (raw.renderer !== undefined) {
    issues.push(...checkRenderer());
    flaggedUnimplemented.add("renderer");
  }

  // `lineage`/`skipLiquidAllowlist` are the two 2026-08-18 schema decisions: neither is a v2 field at
  // all (see `structure.ts`'s `INSTALL_LOCAL_FILES` and `theme.ts`'s publisher/lint boundary comment) — the
  // generic unknown-field loop above already rejects either if present; called out explicitly here so
  // a future reader sees WHY, rather than assuming the omission from `V2_TOP_LEVEL_KEYS` is a gap.

  if (raw.build !== undefined) {
    issues.push(...validateBuildV2({ build: raw.build, isSourceDirGeneratedConflict }));
  }

  issues.push(...checkUnimplementedFieldSweep(raw, flaggedUnimplemented));

  return issues;
}

function checkBuildSource(build: Record<string, JsonValue>): ThemeValidationIssue[] {
  if (build.source === undefined || (typeof build.source === "string" && V2_BUILD_SOURCES.has(build.source))) {
    return [];
  }
  return [
    {
      ruleId: "v2-build-source",
      message: `theme.json: unrecognized build.source ${JSON.stringify(build.source)} — expected 'authored' or 'compiled'`,
    },
  ];
}

function checkBuildFramework(build: Record<string, JsonValue>): ThemeValidationIssue[] {
  if (build.framework === undefined || (typeof build.framework === "string" && V2_BUILD_FRAMEWORKS.has(build.framework))) {
    return [];
  }
  return [
    {
      ruleId: "v2-build-framework",
      message: `theme.json: unrecognized build.framework ${JSON.stringify(build.framework)} — expected one of ${[...V2_BUILD_FRAMEWORKS].join(", ")}`,
    },
  ];
}

function checkCompiledBuildRequirements({ build, isSourceDirGeneratedConflict }: { build: Record<string, JsonValue>; isSourceDirGeneratedConflict: (required: { sourceDir: string }) => boolean }): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];
  if (typeof build.sourceDir !== "string" || build.sourceDir.length === 0) {
    issues.push({ ruleId: "v2-build-sourcedir-required", message: "theme.json: build.sourceDir is required (non-empty) when build.source is 'compiled'" });
  } else if (isSourceDirGeneratedConflict({ sourceDir: build.sourceDir })) {
    issues.push({
      ruleId: "v2-build-sourcedir-conflict",
      message: `theme.json: build.sourceDir '${build.sourceDir}' must not name or contain a reserved generated directory`,
    });
  } else {
    // The source directory has no reserved-directory conflict.
  }
  if (!isObject(build.artifactHashes) || Object.keys(build.artifactHashes as Record<string, unknown>).length === 0) {
    issues.push({
      ruleId: "v2-build-artifacthashes-required",
      message: "theme.json: build.artifactHashes (non-empty) is required when build.source is 'compiled'",
    });
  }
  return issues;
}

function validateBuildV2({ build, isSourceDirGeneratedConflict }: { build: unknown; isSourceDirGeneratedConflict: (required: { sourceDir: string }) => boolean }, _optional = {}): ThemeValidationIssue[] {
  if (!isObject(build)) {
    return [{ ruleId: "v2-build-shape", message: "theme.json: build must be an object when present" }];
  }
  const issues: ThemeValidationIssue[] = [...checkBuildSource(build), ...checkBuildFramework(build)];
  if (build.source === "compiled") {
    issues.push(...checkCompiledBuildRequirements({ build, isSourceDirGeneratedConflict }));
  }
  return issues;
}
