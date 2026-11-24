import type { Clock as ClockPort, IdGenerator as IdGeneratorPort, JsonValue, UUID } from "@jini-ai/core/primitives";
import type { PrincipalRepoPort } from "@jini-ai/core/contracts/site/user-management";
import type {
  AuthorizeFn,
  EnsureSettingDefinitionsPort,
  GetEffectivePort,
  SettingDefinitionSpec,
  SettingsPrincipalLookupPort,
  SettingsRepoPort,
  set,
} from "@jini-ai/core/settings";
import { DEFAULT_DESCRIPTION_MAX_LENGTH, DEFAULT_OG_IMAGE_MAX_LENGTH, MAX_ROBOTS_RULES, MAX_RULE_PATH_ENTRIES, TITLE_TEMPLATE_MAX_LENGTH, TWITTER_SITE_MAX_LENGTH } from "../settings-limits.js";
import { SeoSettingsValidationError } from "../errors.js";
import { seoImageRefRefusal } from "../media.js";
import type { SeoFeaturedImagePort } from "../ports.js";
import type { RobotsDirective, RobotsRule, SeoSettingKey, SeoSettings } from "../types.js";

/**
 * @file `getSeoSettings`/`setSeoSettings`/`ensureSeoSettingDefinitions`
 * (ADR-PIPE-008 Decision §3, C-005/C-006/C-007) — maps the `site.seo.*`
 * ledger definitions to/from `SeoSettings`, validating `titleTemplate`/
 * `robotsRules` before ANY key is written (all-or-nothing, INV-06).
 *
 * Disclosed "7 vs 8" note: ADR-PIPE-008/tasks.md prose repeatedly says "7"
 * (the conceptual `SeoSettings` field count), but Decision §3's own concrete
 * mapping table lists 8 registered ledger keys — `defaultRobots` decomposes
 * into `default_robots_noindex` + `default_robots_nofollow`. This file
 * registers all 8 keys the table requires; registering only 7 would silently
 * drop half of `defaultRobots`'s round trip. See
 * `__tests__/settings.definitions.test.ts`'s header for the same note.
 *
 * `robotsRules` rides the ledger's new `{type:"json"}` schema variant
 * (T008/C-024) — used exactly once, here, per ADR-PIPE-008 Enforcement.
 * Every other field is scalar-decomposed (Article III).
 */

const SEO_NAMESPACE = "site.seo";

/**
 * The host's binding of its active-principal policy to the settings ledger's lookup port. The host
 * decides which principal records count as settings targets (membership, status), so this module
 * takes the binder instead of carrying a policy of its own.
 */
export interface SeoPrincipalLookupBinderPort {
  createPrincipalLookup: (required: { repo: PrincipalRepoPort }) => SettingsPrincipalLookupPort;
}

/**
 * Every settings-ledger collaborator this module takes from the host, in one shape a host can bind
 * once and spread into each call site's deps: the registrar, the effective-value reader, the
 * chokepoint write (`@jini-ai/core/settings` `set`, or the host's own policy-wrapped `set`), and the
 * principal-lookup binder.
 */
export interface SeoSettingsLedgerBindings extends EnsureSettingDefinitionsPort, GetEffectivePort, SeoPrincipalLookupBinderPort {
  /** The settings ledger's chokepoint write, bound by the host. */
  set: typeof set;
}

/** The 8 registered `site.seo.*` definitions (Decision §3's mapping table). */
const SEO_DEFINITIONS: readonly SettingDefinitionSpec<SeoSettingKey>[] = [
  { key: "title_template", schema: { type: "string" }, defaultValue: "%s" },
  // Nullable-on-write, but every non-secret definition needs a non-null default (ledger totality,
  // `validateDefinitionInput`) — "" is this file's own "absent" sentinel, unwrapped to `undefined`
  // by `getSeoSettings` below (mirrors `titleTemplate`-shapes-everything, no site-level default here).
  { key: "default_description", schema: { type: "string", nullable: true }, defaultValue: "" },
  { key: "default_og_image", schema: { type: "string", nullable: true }, defaultValue: "" },
  { key: "twitter_site", schema: { type: "string", nullable: true }, defaultValue: "" },
  { key: "default_robots_noindex", schema: { type: "boolean" }, defaultValue: false },
  { key: "default_robots_nofollow", schema: { type: "boolean" }, defaultValue: false },
  { key: "sitemap_enabled", schema: { type: "boolean" }, defaultValue: true },
  { key: "robots_rules", schema: { type: "json" }, defaultValue: [] },
];

export interface EnsureSeoSettingDefinitionsDeps extends EnsureSettingDefinitionsPort, SeoPrincipalLookupBinderPort {
  settingsRepo: SettingsRepoPort;
  clock: ClockPort | { nowIso(): string };
  ids: IdGeneratorPort;
  principals: PrincipalRepoPort;
}

export interface EnsureSeoSettingDefinitionsInput {
  workspaceId: UUID;
  /** The trusted boot-time actor these writes are attributed to (mirrors `settings migration`'s convention). */
  systemPrincipalId: UUID;
}

function callerWriteServiceDeps(deps: SeoSettingsWriteDeps) {
  return {
    repo: deps.settingsRepo,
    clock: jiniClock({ clock: deps.clock }),
    ids: deps.ids,
    authorize: deps.authorize,
    principals: deps.createPrincipalLookup({ repo: deps.principals }),
  };
}

/**
 * REQ-11 — idempotently registers the 8 `site.seo.*` definitions (skip if
 * already registered, mirrors `settings migration`'s `ensureCoreDefinition`/
 * `ensureThemeDefinitions` pattern exactly). Safe to call on every boot.
 * Boot-time infra work is trusted by construction: the shared registrar uses
 * boot trust rather than caller-supplied authorization, since no request-scoped
 * principal exists yet.
 *
 * @complexity O(1) — 8 fixed definitions.
 */
export async function ensureSeoSettingDefinitions(
  deps: EnsureSeoSettingDefinitionsDeps,
  input: EnsureSeoSettingDefinitionsInput
): Promise<void> {
  await deps.ensureSettingDefinitions(
    { ...deps, clock: jiniClock({ clock: deps.clock }), principals: deps.createPrincipalLookup({ repo: deps.principals }) },
    { namespace: SEO_NAMESPACE, definitions: SEO_DEFINITIONS, ownerKind: "site", ...input },
  );
}

async function readKey(
  { deps, workspaceId, key }: { deps: GetSeoSettingsDeps; workspaceId: UUID; key: SeoSettingKey },
  _optional = {}
): Promise<JsonValue | null> {
  const { settingsRepo } = deps;
  const resolved = await deps.getEffective(
    { deps: { repo: settingsRepo }, namespace: SEO_NAMESPACE, key, scopeContext: { workspaceId } },
  );
  return resolved ? resolved.value : null;
}

/** Unwraps this file's own `""`-means-absent sentinel (see `SEO_DEFINITIONS`' doc comment). */
function undefinedIfEmpty({ value }: { value: JsonValue | null }, _optional = {}): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export interface GetSeoSettingsDeps extends GetEffectivePort {
  settingsRepo: SettingsRepoPort;
}

/**
 * Draft-safety applies only when the noindex key has no explicit owner setting. Its registered
 * default is false, which must not erase the derived noindex for a draft/trashed/scheduled row.
 * No equivalent distinction is needed for nofollow: its default and derived outcomes are false.
 * @example isDefaultRobotsNoindexExplicitlySet({ deps: { settingsRepo }, input: { workspaceId } }, {})
 * @complexity O(1) effective-setting lookup; repository failures propagate.
 */
export async function isDefaultRobotsNoindexExplicitlySet(
  { deps, input }: { deps: GetSeoSettingsDeps; input: { workspaceId: UUID } },
  _optional: Record<string, never> = {},
): Promise<boolean> {
  const resolved = await deps.getEffective(
    { deps: { repo: deps.settingsRepo }, namespace: SEO_NAMESPACE, key: "default_robots_noindex", scopeContext: { workspaceId: input.workspaceId } },
  );
  return resolved !== null && resolved.sourceLayer !== "default";
}

/** REQ-11/12 — reads all 8 `site.seo.*` values via `getEffective`, recomposes `defaultRobots`. */
export async function getSeoSettings(
  deps: GetSeoSettingsDeps,
  input: { workspaceId: UUID }
): Promise<SeoSettings> {
  const [titleTemplate, defaultDescription, defaultOgImage, twitterSite, noindex, nofollow, sitemapEnabled, robotsRules] =
    await Promise.all([
      readKey({ deps, workspaceId: input.workspaceId, key: "title_template" }),
      readKey({ deps, workspaceId: input.workspaceId, key: "default_description" }),
      readKey({ deps, workspaceId: input.workspaceId, key: "default_og_image" }),
      readKey({ deps, workspaceId: input.workspaceId, key: "twitter_site" }),
      readKey({ deps, workspaceId: input.workspaceId, key: "default_robots_noindex" }),
      readKey({ deps, workspaceId: input.workspaceId, key: "default_robots_nofollow" }),
      readKey({ deps, workspaceId: input.workspaceId, key: "sitemap_enabled" }),
      readKey({ deps, workspaceId: input.workspaceId, key: "robots_rules" }),
    ]);

  return {
    titleTemplate: typeof titleTemplate === "string" ? titleTemplate : "%s",
    defaultDescription: undefinedIfEmpty({ value: defaultDescription }),
    defaultOgImage: undefinedIfEmpty({ value: defaultOgImage }),
    twitterSite: undefinedIfEmpty({ value: twitterSite }),
    defaultRobots: { noindex: noindex === true, nofollow: nofollow === true },
    sitemapEnabled: sitemapEnabled !== false,
    robotsRules: Array.isArray(robotsRules) ? (robotsRules as unknown as RobotsRule[]) : [],
  };
}

export interface SeoSettingsWriteDeps extends GetSeoSettingsDeps, SeoPrincipalLookupBinderPort {
  /** The settings ledger's chokepoint write, bound by the host (it may wrap the package `set` in its own write policy). */
  set: typeof set;
  invalidateSitemap?: (input: { workspaceId: UUID }) => void | Promise<void>;
  clock: ClockPort | { nowIso(): string };
  ids: IdGeneratorPort;
  authorize: AuthorizeFn;
  principals: PrincipalRepoPort;
  /** Media lookups for the `defaultOgImage` image check (2026-10-05, see `seoImageRefRefusal`).
   *  Required so no write path can skip it by not wiring it. */
  media: { featuredImage: SeoFeaturedImagePort };
}

/**
 * `setSeoSettings`' patch: any subset of `SeoSettings`. The three optional strings are
 * nullable-on-write (see `SEO_DEFINITIONS`' doc comment): `null` clears the field, stored as the
 * `""` sentinel, so the type admits the `null` a JSON caller sends.
 */
export type SeoSettingsPatch = Partial<Omit<SeoSettings, "defaultDescription" | "defaultOgImage" | "twitterSite">> & {
  defaultDescription?: string | null | undefined;
  defaultOgImage?: string | null | undefined;
  twitterSite?: string | null | undefined;
};

export interface SetSeoSettingsInput {
  workspaceId: UUID;
  patch: SeoSettingsPatch;
  callerPrincipalId: UUID;
}

/** The only keys `setSeoSettings`'s patch may contain — mirrors `SeoSettings`' own field list. */
const KNOWN_PATCH_KEYS: ReadonlySet<string> = new Set([
  "titleTemplate",
  "defaultDescription",
  "defaultOgImage",
  "twitterSite",
  "defaultRobots",
  "sitemapEnabled",
  "robotsRules",
]);

/**
 * Validated first, before any field-shape check: an empty patch is refused rather than accepted as
 * a no-op write of nothing (mirrors Forms' `requireFormsPatch`'s identical discipline), and a key
 * outside `SeoSettings`' own field list is refused rather than silently ignored — the same
 * "unrecognized input must be rejected, not dropped" reasoning `write-service.ts`'s
 * `validateRegisteredKeys` already applies to `setEntrySeoOverrides`.
 */
function validatePatchKeys(patch: SeoSettingsPatch): void {
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    throw new SeoSettingsValidationError("patch must include at least one field");
  }
  for (const key of keys) {
    if (!KNOWN_PATCH_KEYS.has(key)) {
      throw new SeoSettingsValidationError(`'${key}' is not a registered SEO setting field`);
    }
  }
}

function validateTitleTemplate({ titleTemplate }: { titleTemplate: string | undefined }, _optional = {}): void {
  if (titleTemplate === undefined) return;
  if (typeof titleTemplate !== "string" || !titleTemplate.includes("%s")) {
    throw new SeoSettingsValidationError("titleTemplate must contain '%s' at least once");
  }
  if (titleTemplate.length > TITLE_TEMPLATE_MAX_LENGTH) {
    throw new SeoSettingsValidationError(`titleTemplate must be at most ${TITLE_TEMPLATE_MAX_LENGTH} characters`);
  }
}

/** Shared shape of `defaultDescription`/`defaultOgImage`: nullable-on-write (see `SEO_DEFINITIONS`' doc comment), bounded when a string is given. */
function validateBoundedNullableString(
  { value, fieldLabel, maxLength }: { value: string | null | undefined; fieldLabel: string; maxLength: number },
  _optional = {}
): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "string") {
    throw new SeoSettingsValidationError(`${fieldLabel} must be a string`);
  }
  if (value.length > maxLength) {
    throw new SeoSettingsValidationError(`${fieldLabel} must be at most ${maxLength} characters`);
  }
}

function validateDefaultRobots({ defaultRobots }: { defaultRobots: RobotsDirective | undefined }, _optional = {}): void {
  if (defaultRobots === undefined) return;
  if (
    typeof defaultRobots !== "object" ||
    defaultRobots === null ||
    typeof defaultRobots.noindex !== "boolean" ||
    typeof defaultRobots.nofollow !== "boolean"
  ) {
    throw new SeoSettingsValidationError("defaultRobots requires boolean noindex/nofollow");
  }
}

function validateSitemapEnabled(_required: Record<string, never> = {}, { sitemapEnabled }: { sitemapEnabled?: boolean | undefined } = {}): void {
  if (sitemapEnabled !== undefined && typeof sitemapEnabled !== "boolean") {
    throw new SeoSettingsValidationError("sitemapEnabled must be a boolean");
  }
}

function validateRobotsRule(rule: RobotsRule): void {
  if (!rule || typeof rule.userAgent !== "string" || rule.userAgent.trim() === "") {
    throw new SeoSettingsValidationError("each robots rule requires a non-empty userAgent");
  }
  for (const field of ["allow", "disallow"] as const) {
    const list = rule[field];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      throw new SeoSettingsValidationError(`robots rule '${field}' must be an array`);
    }
    if (list.length > MAX_RULE_PATH_ENTRIES) {
      throw new SeoSettingsValidationError(`robots rule '${field}' may contain at most ${MAX_RULE_PATH_ENTRIES} entries`);
    }
  }
}

function validateRobotsRules({ robotsRules }: { robotsRules: RobotsRule[] | undefined }, _optional = {}): void {
  if (robotsRules === undefined) return;
  if (!Array.isArray(robotsRules)) {
    throw new SeoSettingsValidationError("robotsRules must be an array");
  }
  if (robotsRules.length > MAX_ROBOTS_RULES) {
    throw new SeoSettingsValidationError(`robotsRules may contain at most ${MAX_ROBOTS_RULES} rules`);
  }
  for (const rule of robotsRules) {
    validateRobotsRule(rule);
  }
}

function validateSeoSettingsPatch(patch: SeoSettingsPatch): void {
  validatePatchKeys(patch);
  validateTitleTemplate({ titleTemplate: patch.titleTemplate });
  validateBoundedNullableString({ value: patch.defaultDescription, fieldLabel: "defaultDescription", maxLength: DEFAULT_DESCRIPTION_MAX_LENGTH });
  validateBoundedNullableString({ value: patch.defaultOgImage, fieldLabel: "defaultOgImage", maxLength: DEFAULT_OG_IMAGE_MAX_LENGTH });
  validateBoundedNullableString({ value: patch.twitterSite, fieldLabel: "twitterSite", maxLength: TWITTER_SITE_MAX_LENGTH });
  validateDefaultRobots({ defaultRobots: patch.defaultRobots });
  validateSitemapEnabled({}, { sitemapEnabled: patch.sitemapEnabled });
  validateRobotsRules({ robotsRules: patch.robotsRules });
}

type SeoSettingWrite = { key: SeoSettingKey; value: JsonValue };

/**
 * `title_template`/`default_description`/`default_og_image`/`twitter_site` each decompose 1:1
 * into a single ledger write; the latter three ride the `""`-means-absent sentinel on write
 * (see `SEO_DEFINITIONS`' doc comment) via `normalize`, `titleTemplate` does not need it.
 */
const SCALAR_FIELD_WRITERS: ReadonlyArray<{
  patchKey: "titleTemplate" | "defaultDescription" | "defaultOgImage" | "twitterSite";
  settingKey: SeoSettingKey;
  normalize?: (required: { value: string | null | undefined }, optional?: Record<string, never>) => JsonValue;
}> = [
  { patchKey: "titleTemplate", settingKey: "title_template" },
  { patchKey: "defaultDescription", settingKey: "default_description", normalize: ({ value }) => value ?? "" },
  { patchKey: "defaultOgImage", settingKey: "default_og_image", normalize: ({ value }) => value ?? "" },
  { patchKey: "twitterSite", settingKey: "twitter_site", normalize: ({ value }) => value ?? "" },
];

function buildScalarWrites(patch: SeoSettingsPatch): SeoSettingWrite[] {
  const writes: SeoSettingWrite[] = [];
  for (const field of SCALAR_FIELD_WRITERS) {
    const raw = patch[field.patchKey];
    if (raw === undefined) continue;
    writes.push({ key: field.settingKey, value: field.normalize ? field.normalize({ value: raw }) : raw });
  }
  return writes;
}

/** `defaultRobots` decomposes into 2 ledger writes (Decision §3's mapping table). */
function buildDefaultRobotsWrites({ defaultRobots }: { defaultRobots: RobotsDirective | undefined }, _optional = {}): SeoSettingWrite[] {
  if (defaultRobots === undefined) return [];
  return [
    { key: "default_robots_noindex", value: defaultRobots.noindex },
    { key: "default_robots_nofollow", value: defaultRobots.nofollow },
  ];
}

function buildSitemapEnabledWrites(_required: Record<string, never> = {}, { sitemapEnabled }: { sitemapEnabled?: boolean | undefined } = {}): SeoSettingWrite[] {
  return sitemapEnabled === undefined ? [] : [{ key: "sitemap_enabled", value: sitemapEnabled }];
}

function buildRobotsRulesWrites({ robotsRules }: { robotsRules: RobotsRule[] | undefined }, _optional = {}): SeoSettingWrite[] {
  return robotsRules === undefined ? [] : [{ key: "robots_rules", value: robotsRules as unknown as JsonValue }];
}

/** REQ-11/15 chokepoint write: validate ALL fields (all-or-nothing) -> decompose -> N ledger `set()` calls. */
export async function setSeoSettings(deps: SeoSettingsWriteDeps, input: SetSeoSettingsInput): Promise<SeoSettings> {
  validateSeoSettingsPatch(input.patch);
  // Before any write, so a refused image leaves every other field in the patch unwritten too
  // (all-or-nothing). Unlike the entry chokepoint this runs ahead of this function's own
  // authorization (each `set()` below authorizes itself), so both callers authorize BEFORE calling
  // in: `put-settings.ts` inline, and the `seo_set_settings` tool via `requireToolPermission`.
  const ogImageRefusal = await seoImageRefRefusal({
    deps: deps.media,
    input: { workspaceId: input.workspaceId, field: "defaultOgImage", ref: input.patch.defaultOgImage },
  });
  if (ogImageRefusal) throw new SeoSettingsValidationError(ogImageRefusal);

  // Order matches the original field-by-field pushes exactly (scalars, then defaultRobots'
  // 2 writes, then sitemapEnabled, then robotsRules) — write order is preserved on purpose.
  const writes: SeoSettingWrite[] = [
    ...buildScalarWrites(input.patch),
    ...buildDefaultRobotsWrites({ defaultRobots: input.patch.defaultRobots }),
    ...buildSitemapEnabledWrites({}, { sitemapEnabled: input.patch.sitemapEnabled }),
    ...buildRobotsRulesWrites({ robotsRules: input.patch.robotsRules }),
  ];

  for (const write of writes) {
    await deps.set({
      deps: callerWriteServiceDeps(deps),
      input: {
        namespace: SEO_NAMESPACE,
        key: write.key,
        scope: "workspace",
        value: write.value,
        workspaceId: input.workspaceId,
        authWorkspaceId: input.workspaceId,
        callerPrincipalId: input.callerPrincipalId,
        // Round-1 external audit of an unrelated feature (2026-07-16,
        // TM-adr046-phase3-comments-audit-001, codex codex-r1-B-001) found this exact same
        // chokepoint-permission mismatch on Comments' identically-shaped settings route and
        // confirmed SEO's route (this one) has the same latent defect: the PUT route already
        // authorizes "admin.seo.manage" -- that IS the permission the admin UI advertises as
        // sufficient. Without this override, the chokepoint's default scope-derived
        // "settings.workspace.write" check ran a SECOND, unrelated authz check that an
        // admin.seo.manage-only principal would fail, surfacing as a masked 500 rather than
        // either success or a clear 403.
        requiredPermissionOverride: "admin.seo.manage",
      },
    });
  }

  if (input.patch.defaultRobots !== undefined || input.patch.sitemapEnabled !== undefined || input.patch.robotsRules !== undefined) {
    await deps.invalidateSitemap?.({ workspaceId: input.workspaceId });
  }

  return getSeoSettings({ settingsRepo: deps.settingsRepo, getEffective: deps.getEffective }, { workspaceId: input.workspaceId });
}

/** The host's ISO-clock adapter; the shared clock contract/rationale lives in Jini core/primitives. */
function jiniClock({ clock }: { clock: ClockPort | { nowIso(): string } }, _optional = {}): ClockPort {
  return "nowMs" in clock ? clock : { nowMs: () => Date.parse(clock.nowIso()) };
}
