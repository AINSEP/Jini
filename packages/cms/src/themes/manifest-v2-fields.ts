import type { JsonValue } from "@jini-ai/core/primitives";
import type { ThemeValidationIssue } from "./manifest-v2.js";

const V2_TIERS: ReadonlySet<string> = new Set(["declarative", "templated", "handlebars", "static", "code"]);
/** The two real template engines this codebase has workers for (`liquid-worker.ts`,
 * `handlebars-worker.ts`). Not stated explicitly as a closed list anywhere in the design doc's §5
 * example — inferred from what the runtime can actually execute, and fail-closed on anything else
 * rather than left open, matching this schema's own "fail-closed on unknown ... engine" requirement. */
const V2_ENGINE_NAMES: ReadonlySet<string> = new Set(["liquid", "handlebars"]);

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkApiVersion({ value }: { value: unknown }, _optional = {}): ThemeValidationIssue[] {
  if (value === 2) return [];
  return [{ ruleId: "v2-api-version", message: `theme.json: apiVersion must be exactly 2, got ${JSON.stringify(value)}` }];
}

export function checkId({ value }: { value: unknown }, _optional = {}): ThemeValidationIssue[] {
  if (typeof value === "string" && value.length > 0) return [];
  return [{ ruleId: "v2-id", message: "theme.json: id must be a non-empty string" }];
}

export function checkName({ value }: { value: unknown }, _optional = {}): ThemeValidationIssue[] {
  if (typeof value === "string" && value.length > 0) return [];
  return [{ ruleId: "v2-name", message: "theme.json: name must be a non-empty string" }];
}

export function checkVersionField({ value }: { value: unknown }, _optional = {}): ThemeValidationIssue[] {
  if (typeof value === "string" && SEMVER_PATTERN.test(value)) return [];
  return [{ ruleId: "v2-version-semver", message: `theme.json: version must be valid semver (X.Y.Z), got ${JSON.stringify(value)}` }];
}

export function checkTier({ value }: { value: unknown }, _optional = {}): ThemeValidationIssue[] {
  if (value === undefined) return [];
  if (typeof value === "string" && V2_TIERS.has(value)) return [];
  return [
    { ruleId: "v2-tier", message: `theme.json: unrecognized tier ${JSON.stringify(value)} — expected one of ${[...V2_TIERS].join(", ")}` },
  ];
}

/** Accept HTTPS stylesheet URLs and local root-relative paths; never protocol-relative hosts.
 * @complexity O(b) URL bytes; no I/O. */
function isFontStylesheet({ value }: { value: unknown }, _optional = {}): boolean {
  if (typeof value !== "string" || /[\s\\]/.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  return /^https:\/\//i.test(value) && URL.canParse(value);
}

/** Reject the entire declaration when any entry is malformed; empty arrays disable fonts.
 * @complexity O(b) total stylesheet URL bytes; no I/O or mutation. */
export function checkFontStylesheets({ value }: { value: unknown }, _optional = {}): ThemeValidationIssue[] {
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every(entry => isFontStylesheet({ value: entry }))) return [];
  return [{ ruleId: "v2-font-stylesheets", message: "theme.json: fontStylesheets must be an array of HTTPS URLs or root-relative paths" }];
}

/**
 * `engine` — schema v2 restructures the flat v1 number into `{ name, version }`. Even a
 * schema-valid object is flagged `v2-engine-object-unimplemented`:
 *
 * 2026-08-19 architecture audit finding 3: `loadTheme()` (`theme.ts`) still parses
 * `engine: typeof raw.engine === "number" ? raw.engine : 1` — an object-valued engine is silently
 * coerced to `1`, discarding whatever `{ name, version }` this manifest declared. "Schema-valid" must
 * not mean "the runtime will actually read this" — see `profiles.ts`'s `UNIMPLEMENTED_V2_FIELD_PATTERN`
 * for the author-warns/install-errors severity split.
 *
 * Deliberately does NOT add "engine" to `flaggedUnimplemented` in the caller — the generic sweep
 * already skips it unconditionally via `V2_FIELDS_READ_BY_LOADER` (the key itself IS read, in its
 * number form; only the object shape here is unimplemented, and that already has its own finding).
 */
export function checkEngine({ value }: { value: unknown }, _optional = {}): ThemeValidationIssue[] {
  if (value === undefined) return [];
  if (!isObject(value)) {
    return [{ ruleId: "v2-engine-shape", message: "theme.json: engine must be an object ({ name, version }) in schema v2, not a bare number" }];
  }
  const issues: ThemeValidationIssue[] = [];
  if (typeof value.name !== "string" || !V2_ENGINE_NAMES.has(value.name)) {
    issues.push({
      ruleId: "v2-engine-name",
      message: `theme.json: unrecognized engine.name ${JSON.stringify(value.name)} — expected one of ${[...V2_ENGINE_NAMES].join(", ")}`,
    });
  }
  if (value.version !== undefined && typeof value.version !== "string") {
    issues.push({ ruleId: "v2-engine-version", message: "theme.json: engine.version must be a string when present" });
  }
  issues.push({
    ruleId: "v2-engine-object-unimplemented",
    message:
      "theme.json: engine as an object is not yet read by the runtime loader (theme.ts still coerces any non-number engine to 1) — this declaration will be silently discarded",
  });
  return issues;
}

/**
 * `tokens` (nested `{ defaultMode, modes }`) — shape-checked when present, but ALSO unconditionally
 * flagged `v2-tokens-unimplemented`, valid or not:
 *
 * 2026-08-19 architecture audit finding 3: `loadTheme()` reads mode/token-file information only from
 * the FLAT `modes`/`defaultMode` top-level fields and hardcodes the light-variant filename
 * `tokens.light.json` — it never reads this nested `tokens` object at all, valid or not. A theme
 * declaring only this (and no flat `modes`/`defaultMode`) renders with no error but the wrong (or no)
 * mode switching.
 *
 * The caller adds "tokens" to `flaggedUnimplemented` so the generic sweep doesn't double-flag it.
 */
export function checkTokens({ value }: { value: unknown }, _optional = {}): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];
  if (!isObject(value)) {
    issues.push({ ruleId: "v2-tokens-shape", message: "theme.json: tokens must be an object ({ defaultMode, modes }) in schema v2" });
  } else {
    const modes = isObject(value.modes) ? value.modes : undefined;
    if (!modes) {
      issues.push({ ruleId: "v2-tokens-modes", message: "theme.json: tokens.modes must be an object mapping mode name -> file path" });
    } else if (typeof value.defaultMode === "string" && !Object.prototype.hasOwnProperty.call(modes, value.defaultMode)) {
      issues.push({
        ruleId: "v2-tokens-default-mode",
        message: `theme.json: tokens.defaultMode '${value.defaultMode}' is not listed in tokens.modes`,
      });
    } else {
      // No default mode is named, or it belongs to the declared modes.
    }
  }
  issues.push({
    ruleId: "v2-tokens-unimplemented",
    message:
      "theme.json: nested tokens (defaultMode/modes) is not yet read by the runtime loader (theme.ts reads the flat top-level modes/defaultMode fields instead, and hardcodes the tokens.light.json filename) — this declaration will be silently ignored",
  });
  return issues;
}

export function checkLicense({ value }: { value: unknown }, _optional = {}): ThemeValidationIssue[] {
  if (value === undefined || isObject(value)) return [];
  return [{ ruleId: "v2-license-shape", message: "theme.json: license must be an object ({ spdx, file }) in schema v2" }];
}

export function checkAuthors({ value }: { value: unknown }, _optional = {}): ThemeValidationIssue[] {
  if (value === undefined || Array.isArray(value)) return [];
  return [{ ruleId: "v2-authors-shape", message: "theme.json: authors must be an array of { name, url? } in schema v2" }];
}

export function checkAttributions({ value }: { value: unknown }, _optional = {}): ThemeValidationIssue[] {
  if (value === undefined || Array.isArray(value)) return [];
  return [{ ruleId: "v2-attributions-shape", message: "theme.json: attributions must be an array in schema v2" }];
}

/**
 * `partials` — `theme-authoring-guide-v2.md` §10's `[TARGET]` rename of the REAL field `loadTheme()`
 * actually reads, `slots` (`theme.ts`, flat, apiVersion-agnostic).
 *
 * 2026-08-19 architecture audit finding 3: a marketplace theme declaring `partials.hero.source`
 * installs successfully (this field's own `checkDeclaredReferences` pass in `validate-theme-package.ts`
 * only checks that the referenced FILE exists, never that anything resolves it) and then renders with
 * that partial unresolved — the runtime looks up `manifest.slots`, never `manifest.partials`. Declare
 * the SAME mapping under `slots` for it to actually take effect.
 *
 * The caller adds "partials" to `flaggedUnimplemented` so the generic sweep doesn't double-flag it.
 */
export function checkPartials({ value }: { value: unknown }, _optional = {}): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];
  if (!isObject(value)) {
    issues.push({ ruleId: "v2-partials-shape", message: "theme.json: partials must be an object keyed by partial id" });
  }
  issues.push({
    ruleId: "v2-partials-unimplemented",
    message:
      "theme.json: partials is not yet read by the runtime loader (theme.ts still reads the flat slots field) — declare this mapping under slots instead, or this partial will render unresolved",
  });
  return issues;
}

export function checkRegions({ value }: { value: unknown }, _optional = {}): ThemeValidationIssue[] {
  if (value === undefined || Array.isArray(value)) return [];
  return [{ ruleId: "v2-regions-shape", message: "theme.json: regions must be an array of strings" }];
}

/**
 * `renderer` — 2026-08-19 architecture audit finding 3: no loader or renderer branch anywhere in this
 * codebase reads `renderer` yet (`theme-authoring-guide-v2.md` §15's own field table: "unread";
 * `code-tier-asset-normalizer.ts` is the closest real code and has zero callers for this field).
 * Declared for forward-authoring only; see `profiles.ts` for why `author` still just warns.
 *
 * The caller adds "renderer" to `flaggedUnimplemented` so the generic sweep doesn't double-flag it.
 */
export function checkRenderer(): ThemeValidationIssue[] {
  return [
    {
      ruleId: "v2-renderer-unimplemented",
      message: "theme.json: renderer is not yet read by any runtime code path — declaring it has no effect on how this theme actually renders",
    },
  ];
}

