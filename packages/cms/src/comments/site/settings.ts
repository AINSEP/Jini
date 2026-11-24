import type { Clock as ClockPort, IdGenerator as IdGeneratorPort, JsonValue, UUID } from "@jini-ai/core/primitives";
import type { PrincipalRepoPort } from "@jini-ai/core/contracts/site/user-management";
import {
  type SettingsRepoPort,
  type SettingsPrincipalLookupPort,
  getEffective,
  ensureSettingDefinitions,
  type SettingDefinitionSpec,
  set,
  type AuthorizeFn,
} from "@jini-ai/core/settings";
import { CommentsSettingsValidationError } from "../errors.js";
import { MAX_DEPTH_CEILING, MAX_PER_IP_PER_HOUR_CEILING } from "../settings-limits.js";
import type { CommentsSettings } from "../types.js";

/**
 * @file `getCommentsSettings`/`setCommentsSettings`/`ensureCommentsSettingDefinitions` — the
 * ADR-028 Settings Layered Ledger wiring for `CommentsSettings` (ADR-031 §2's own doc on that
 * type: "Stored via the Settings Layered Ledger... under a `comments.*` namespace once that
 * wiring exists — NOT as a comment table"). Namespace is `site.comments` (not a bare `comments`)
 * — the ledger's namespace owner fence requires every `ownerKind: "site"` definition to start
 * with `site.` (see `COMMENTS_NAMESPACE`'s own comment below), mirroring `site.seo`. Mirrors
 * `apps/website/src/features/seo/settings.ts`'s exact shape — same idempotent-definitions / getEffective-read /
 * validate-then-set-write structure, applied to Comments' 6 scalar fields instead of SEO's 8.
 *
 * Every `CommentsSettings` field is a plain scalar (boolean/number/nullable-number) — none needs
 * the ledger's `{type:"json"}` escape hatch, which Code Review must keep to its one existing
 * `site.seo.robots_rules` use (see `Jini packages/core/src/settings/types.ts`'s own doc on that variant).
 */

// ADR-028's namespace owner fence (`Jini packages/core/src/settings/settings.ts`'s `NAMESPACE_FENCE`) requires
// `ownerKind: "site"` definitions to be namespaced under `site.` — mirrors `site.seo`'s identical
// constraint (`seo/settings.ts`'s own `SEO_NAMESPACE`). A bare `"comments"` namespace fails REQ-02
// validation at the write chokepoint (caught directly by this file's own test suite, not
// theoretical).
const COMMENTS_NAMESPACE = "site.comments";

type CommentsSettingKey =
  | "enabled"
  | "require_moderation"
  | "max_depth"
  | "close_after_days"
  | "spam_auto_reject_score"
  | "max_per_ip_per_hour";

/** Sentinel for `closeAfterDays: null` ("never closes") — every non-secret definition needs a
 * non-null `default_json` (ledger totality, `validateDefinitionInput`'s INV-02), so a literal
 * `null` default is rejected at registration. Mirrors `seo/settings.ts`'s own `""`-means-absent
 * sentinel for its nullable string fields, applied to a nullable NUMBER field instead: -1 is not
 * a valid `closeAfterDays` value (negative day counts are rejected by `validateCommentsSettingsPatch`
 * below), so it can't collide with a real write. */
const CLOSE_AFTER_DAYS_NEVER_SENTINEL = -1;

/** The 6 registered `comments.*` definitions, defaults matching the pre-ledger
 * `DEFAULT_COMMENTS_SETTINGS` constant byte-for-byte, so migrating to the ledger changes no
 * workspace's effective settings on day one. */
const COMMENTS_DEFINITIONS: readonly SettingDefinitionSpec<CommentsSettingKey>[] = [
  { key: "enabled", schema: { type: "boolean" }, defaultValue: true },
  { key: "require_moderation", schema: { type: "boolean" }, defaultValue: true },
  { key: "max_depth", schema: { type: "number" }, defaultValue: 5 },
  { key: "close_after_days", schema: { type: "number", nullable: true }, defaultValue: CLOSE_AFTER_DAYS_NEVER_SENTINEL },
  { key: "spam_auto_reject_score", schema: { type: "number" }, defaultValue: 0.5 },
  { key: "max_per_ip_per_hour", schema: { type: "number" }, defaultValue: 20 },
];

export interface EnsureCommentsSettingDefinitionsDeps {
  settingsRepo: SettingsRepoPort;
  clock: ClockPort | { nowIso(): string };
  ids: IdGeneratorPort;
  principals: PrincipalRepoPort;
  /** The host's membership/status policy binding for the settings principal lookup (injected: that policy is host-owned). */
  createPrincipalLookup: (required: { repo: PrincipalRepoPort }) => SettingsPrincipalLookupPort;
}

export interface EnsureCommentsSettingDefinitionsInput {
  workspaceId: UUID;
  /** The trusted boot-time actor these writes are attributed to (mirrors `seo/settings.ts`'s
   * identical `systemPrincipalId` convention — a fixed, well-known id, not required to resolve to
   * a real `identity` principal row; see that file's `EnsureSeoSettingDefinitionsInput` doc). */
  systemPrincipalId: UUID;
}

/** Idempotently registers the 6 `comments.*` definitions (skip if already registered, mirrors
 * `ensureSeoSettingDefinitions`'s identical pattern). Safe to call on every boot.
 * Boot-time infra work is trusted by construction; the shared registrar owns that shim.
 * @complexity O(1) time and auxiliary space — six sequential definition lookups/writes. */
export async function ensureCommentsSettingDefinitions(
  deps: EnsureCommentsSettingDefinitionsDeps,
  input: EnsureCommentsSettingDefinitionsInput
): Promise<void> {
  await ensureSettingDefinitions(
    { ...deps, clock: jiniClock({ clock: deps.clock }), principals: deps.createPrincipalLookup({ repo: deps.principals }) },
    { namespace: COMMENTS_NAMESPACE, definitions: COMMENTS_DEFINITIONS, ownerKind: "site", ...input },
  );
}

async function readKey(
  { settingsRepo, workspaceId, key }: { settingsRepo: SettingsRepoPort; workspaceId: UUID; key: CommentsSettingKey },
  _optional = {},
): Promise<JsonValue | null> {
  const resolved = await getEffective(
    { deps: { repo: settingsRepo }, namespace: COMMENTS_NAMESPACE, key, scopeContext: { workspaceId } },
  );
  return resolved ? resolved.value : null;
}

export interface GetCommentsSettingsDeps {
  settingsRepo: SettingsRepoPort;
}

/** Reads all 6 `comments.*` values via `getEffective`. Falls back to the pre-ledger default for
 * any key that isn't set yet (e.g. `ensureCommentsSettingDefinitions` hasn't run in this
 * composition — mirrors `getSeoSettings`'s identical defensive-default shape). */
export async function getCommentsSettings(
  deps: GetCommentsSettingsDeps,
  input: { workspaceId: UUID }
): Promise<CommentsSettings> {
  const [enabled, requireModeration, maxDepth, closeAfterDays, spamAutoRejectScore, maxPerIpPerHour] = await Promise.all([
    readKey({ settingsRepo: deps.settingsRepo, workspaceId: input.workspaceId, key: "enabled" }),
    readKey({ settingsRepo: deps.settingsRepo, workspaceId: input.workspaceId, key: "require_moderation" }),
    readKey({ settingsRepo: deps.settingsRepo, workspaceId: input.workspaceId, key: "max_depth" }),
    readKey({ settingsRepo: deps.settingsRepo, workspaceId: input.workspaceId, key: "close_after_days" }),
    readKey({ settingsRepo: deps.settingsRepo, workspaceId: input.workspaceId, key: "spam_auto_reject_score" }),
    readKey({ settingsRepo: deps.settingsRepo, workspaceId: input.workspaceId, key: "max_per_ip_per_hour" }),
  ]);

  return {
    enabled: enabled !== false,
    requireModeration: requireModeration !== false,
    maxDepth: typeof maxDepth === "number" ? maxDepth : 5,
    // Unwraps this file's own sentinel (see `CLOSE_AFTER_DAYS_NEVER_SENTINEL`'s doc comment).
    closeAfterDays: typeof closeAfterDays === "number" && closeAfterDays !== CLOSE_AFTER_DAYS_NEVER_SENTINEL ? closeAfterDays : null,
    spamAutoRejectScore: typeof spamAutoRejectScore === "number" ? spamAutoRejectScore : 0.5,
    maxPerIpPerHour: typeof maxPerIpPerHour === "number" ? maxPerIpPerHour : 20,
  };
}

export interface SetCommentsSettingsDeps extends GetCommentsSettingsDeps {
  clock: ClockPort | { nowIso(): string };
  ids: IdGeneratorPort;
  authorize: AuthorizeFn;
  principals: PrincipalRepoPort;
  /** The host's membership/status policy binding for the settings principal lookup (injected: that policy is host-owned). */
  createPrincipalLookup: (required: { repo: PrincipalRepoPort }) => SettingsPrincipalLookupPort;
}

export interface SetCommentsSettingsInput {
  workspaceId: UUID;
  patch: Partial<CommentsSettings>;
  callerPrincipalId: UUID;
}

/**
 * The three assertion shapes the six `comments.*` fields reduce to. Each takes `unknown` rather
 * than its declared type on purpose: `Partial<CommentsSettings>` describes what a well-behaved
 * caller sends, but the real caller is `put-settings.ts` handing over a parsed request body, so
 * the `typeof` checks are load-bearing runtime gates rather than redundant restatements of the
 * type. Each throws `CommentsSettingsValidationError`, which the route maps 1:1 onto a 400.
 */

/** @complexity O(1). */
function assertBoolean({ value, field }: { value: unknown; field: string }, _optional = {}): void {
  if (typeof value !== "boolean") {
    throw new CommentsSettingsValidationError(`${field} must be a boolean`);
  }
}

/**
 * A whole-number field with an inclusive lower bound and an optional inclusive ceiling.
 *
 * `shapeMessage` is supplied rather than derived because the three callers describe the same
 * check in field-specific words the admin UI shows verbatim ("non-negative integer", "positive
 * integer", "non-negative integer or null"). The shape is checked BEFORE the ceiling so a value
 * that is both malformed and oversized is told it is malformed — the actionable problem.
 *
 * @complexity O(1).
 */
function assertBoundedInteger(
  { value, spec }: { value: unknown; spec: { field: string; minimum: number; maximum?: number; shapeMessage: string } },
  _optional = {},
): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < spec.minimum) {
    throw new CommentsSettingsValidationError(spec.shapeMessage);
  }
  if (spec.maximum !== undefined && value > spec.maximum) {
    throw new CommentsSettingsValidationError(`${spec.field} must be at most ${spec.maximum}`);
  }
}

/** A fractional field constrained to an inclusive range, reported as one message. @complexity O(1). */
function assertNumberInRange({ value, spec }: { value: unknown; spec: { minimum: number; maximum: number; message: string } }, _optional = {}): void {
  if (typeof value !== "number" || value < spec.minimum || value > spec.maximum) {
    throw new CommentsSettingsValidationError(spec.message);
  }
}

/** Domain-owned field mapping and validation in observable first-error/write order.
 * Each rule accepts unknown because parsed request bodies must be checked at runtime.
 * The declaration also owns sentinel normalization, so validation and writes use the same keys. */
const COMMENTS_PATCH_FIELDS: ReadonlyArray<{
  field: keyof CommentsSettings;
  key: CommentsSettingKey;
  validate: (required: { value: unknown }, optional?: Record<string, never>) => void;
  normalize?: (required: { value: JsonValue }, optional?: Record<string, never>) => JsonValue;
}> = [
  { field: "enabled", key: "enabled", validate: ({ value }, _optional = {}) => assertBoolean({ value, field: "enabled" }) },
  { field: "requireModeration", key: "require_moderation", validate: ({ value }, _optional = {}) => assertBoolean({ value, field: "requireModeration" }) },
  { field: "maxDepth", key: "max_depth", validate: ({ value }, _optional = {}) => assertBoundedInteger({ value, spec: {
    field: "maxDepth", minimum: 0, maximum: MAX_DEPTH_CEILING, shapeMessage: "maxDepth must be a non-negative integer",
  } }) },
  // `null` is legal ("never closes"), so it skips the number rules entirely.
  // Wraps the sentinel only on write; see `CLOSE_AFTER_DAYS_NEVER_SENTINEL` for why it cannot collide.
  { field: "closeAfterDays", key: "close_after_days", validate: ({ value }, _optional = {}) => {
    if (value !== null) assertBoundedInteger({ value, spec: {
      field: "closeAfterDays", minimum: 0, shapeMessage: "closeAfterDays must be a non-negative integer or null",
    } });
  }, normalize: ({ value }, _optional = {}) => value ?? CLOSE_AFTER_DAYS_NEVER_SENTINEL },
  { field: "spamAutoRejectScore", key: "spam_auto_reject_score", validate: ({ value }, _optional = {}) => assertNumberInRange({ value, spec: {
    minimum: 0, maximum: 1, message: "spamAutoRejectScore must be a number in [0,1]",
  } }) },
  { field: "maxPerIpPerHour", key: "max_per_ip_per_hour", validate: ({ value }, _optional = {}) => assertBoundedInteger({ value, spec: {
    field: "maxPerIpPerHour", minimum: 1, maximum: MAX_PER_IP_PER_HOUR_CEILING, shapeMessage: "maxPerIpPerHour must be a positive integer",
  } }) },
];

/**
 * All-or-nothing gate: throws on the FIRST invalid field in declaration order before ANY write,
 * so a patch mixing valid and invalid fields persists none of them. Field order decides which
 * message a multi-error patch reports and is pinned by `settings.validation.characterization.test.ts`.
 * @complexity O(1) time and auxiliary space — six fixed fields, independent of workspace size.
 */
function validateCommentsSettingsPatch(patch: Partial<CommentsSettings>): void {
  for (const spec of COMMENTS_PATCH_FIELDS) {
    const value = patch[spec.field];
    if (value !== undefined) spec.validate({ value });
  }
}

/** Validate ALL fields (all-or-nothing) -> N ledger `set()` calls (mirrors `setSeoSettings`). */
export async function setCommentsSettings(
  deps: SetCommentsSettingsDeps,
  input: SetCommentsSettingsInput
): Promise<CommentsSettings> {
  validateCommentsSettingsPatch(input.patch);

  const writes: Array<{ key: CommentsSettingKey; value: JsonValue }> = [];
  for (const spec of COMMENTS_PATCH_FIELDS) {
    const value = input.patch[spec.field];
    if (value !== undefined) writes.push({ key: spec.key, value: spec.normalize ? spec.normalize({ value }) : value });
  }

  for (const write of writes) {
    await set({
      deps: { repo: deps.settingsRepo, clock: jiniClock({ clock: deps.clock }), ids: deps.ids, authorize: deps.authorize, principals: deps.createPrincipalLookup({ repo: deps.principals }) },
      input: {
        namespace: COMMENTS_NAMESPACE,
        key: write.key,
        scope: "workspace",
        value: write.value,
        workspaceId: input.workspaceId,
        authWorkspaceId: input.workspaceId,
        callerPrincipalId: input.callerPrincipalId,
        // Round-1 external audit (2026-07-16, TM-adr046-phase3-comments-audit-001, codex
        // codex-r1-B-001, independently verified): the PUT route already authorizes
        // "comments.configure" before calling this function -- that IS the permission the admin
        // UI advertises as sufficient to change Comments settings. Without this override, the
        // chokepoint's default scope-derived "settings.workspace.write" check ran a SECOND,
        // unrelated authz check that a comments.configure-only principal would fail, surfacing as
        // a masked 500 rather than either success or a clear 403.
        requiredPermissionOverride: "comments.configure",
      },
    });
  }

  return getCommentsSettings({ settingsRepo: deps.settingsRepo }, { workspaceId: input.workspaceId });
}

/** Tovu's ISO-clock adapter; the shared clock contract/rationale lives in Jini core/primitives. */
function jiniClock({ clock }: { clock: ClockPort | { nowIso(): string } }, _optional = {}): ClockPort {
  return "nowMs" in clock ? clock : { nowMs: () => Date.parse(clock.nowIso()) };
}
