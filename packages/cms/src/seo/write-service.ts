import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import { type Clock as ClockPort } from "@jini-ai/core/primitives";
import { assertEntityLive, ForbiddenError, type AuthorizeFn } from "../core/index.js";
import type { SeoPostWritePort as PostRepoPort, SeoFeaturedImagePort } from "./ports.js";
type FeaturedImageDeps = { featuredImage: SeoFeaturedImagePort };
import {
  SeoConcurrentWriteError,
  SeoEntryNotFoundError,
  SeoFieldValidationError,
  SeoInvalidCanonicalUrlError,
} from "./errors.js";
import { seoImageRefRefusal } from "./media.js";
import type { SeoExtFields, SeoExtFieldsPatch } from "./types.js";

/**
 * @file `setEntrySeoOverrides` — THE per-entry SEO write chokepoint
 * (ADR-PIPE-008 Decision §4, C-004; REQ-01/02/03). `authorize("admin.seo.manage")`
 * -> validate (registered-key-only, length/URL-scheme) -> merge into the
 * existing (or empty) `posts.seo_ext_json` -> `postRepo.save` -> conditional
 * direct sitemap-cache invalidation on a noindex/canonical-affecting write.
 *
 * No new port: reuses the existing `PostRepoPort` (`findById`/`save`).
 * `invalidateSitemapCache` is injected (not imported from `sitemap.ts`
 * directly) so this file stays independently testable in Phase 2, ahead of
 * Phase 6's `sitemap.ts` existing — the real composition root (Phase 7, T047)
 * wires the real function in.
 *
 * Clearing an override (2026-09-06 fix): a patch value of `null` REMOVES that key from the merged
 * bag (see `SeoExtFieldsPatch`'s doc comment in `types.ts` for the "pass null to clear" convention
 * this mirrors from `SeoSettings`). Before this, there was no way to un-set a key once written — the
 * only options were overwriting it with another value or `""`, and `seo.ts`'s `?? ` precedence chain
 * does not filter `""`, so an empty-string override silently suppressed the site default/derived
 * fallback rather than falling through to it. A merge result left with zero keys is persisted as
 * `seoExtJson: null` (not `"{}"`), so clearing every currently-set key returns the row to its true
 * original state, not a leftover empty bag.
 */

// Exported (unchanged values) so `agent-tools.ts`'s published JSON Schema can reuse the exact
// same bounds/vocabulary this chokepoint validates against, rather than restating them — the same
// discipline `newsletter/agent-tools.ts` uses for `campaign-write-service.ts`'s `SUBJECT_MAX`/etc.
export const STRING_FIELD_MAX_LENGTH = 500;
export const URL_FIELD_MAX_LENGTH = 2048;

/** Fields whose value is a plain string, length-bounded at 500 chars (behavior.spec.md §4). */
export const STRING_FIELDS: ReadonlyArray<keyof SeoExtFields> = [
  "title",
  "description",
  "schemaType",
  "ogTitle",
  "ogDescription",
  "twitterTitle",
  "twitterDescription",
];

/** Fields whose value is a URL/media-ref, length-bounded at 2048 chars (behavior.spec.md §4). */
export const URL_FIELDS: ReadonlyArray<keyof SeoExtFields> = ["canonical", "ogImage", "twitterImage"];

export const BOOLEAN_FIELDS: ReadonlyArray<keyof SeoExtFields> = ["noindex", "nofollow"];

export const OG_TYPE_VALUES = ["website", "article", "profile"] as const;
export const TWITTER_CARD_VALUES = ["summary", "summary_large_image"] as const;

/** Every registered `SeoExtFields` key — an unregistered patch key is rejected outright (INV-01). */
export const REGISTERED_KEYS: ReadonlyArray<string> = [
  ...STRING_FIELDS,
  ...URL_FIELDS,
  ...BOOLEAN_FIELDS,
  "ogType",
  "twitterCard",
];

/** `javascript:`/`data:` (and other script-capable schemes) are never a safe canonical override. */
const UNSAFE_URL_SCHEME_PATTERN = /^\s*(javascript|data|vbscript|file):/i;

/**
 * Pure validation over a raw patch object. Never mutates; throws the first
 * violation found. Kept separate from the chokepoint so Code Review/tests can
 * exercise it directly if needed, though `setEntrySeoOverrides` is the only
 * caller.
 */
/** Every patch key must be a known `SeoExtFields` key (INV-01) — checked before any per-field rule. */
function validateRegisteredKeys(patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    if (!REGISTERED_KEYS.includes(key)) {
      throw new SeoFieldValidationError(`'${key}' is not a registered SEO field`);
    }
  }
}

/** Shared shape for both STRING_FIELDS and URL_FIELDS: optional string, bounded by `maxLength`.
 *  `null` is the clear sentinel (see file header) — skipped here, same as `undefined`, since it
 *  never becomes a stored value for this key. */
function validateStringLikeFields(
  patch: Record<string, unknown>,
  fields: ReadonlyArray<keyof SeoExtFields>,
  maxLength: number
): void {
  for (const key of fields) {
    const value = patch[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      throw new SeoFieldValidationError(`'${key}' must be a string`);
    }
    if (value.length > maxLength) {
      throw new SeoFieldValidationError(`'${key}' must be at most ${maxLength} characters`);
    }
  }
}

// Canonical's unsafe-scheme check is its own typed error (SEO_INVALID_CANONICAL_URL),
// distinct from the generic length/type SEO_FIELD_VALIDATION_ERROR the other field checks throw.
function validateCanonicalScheme(patch: Record<string, unknown>): void {
  const canonical = patch.canonical;
  if (typeof canonical === "string" && UNSAFE_URL_SCHEME_PATTERN.test(canonical)) {
    throw new SeoInvalidCanonicalUrlError(`'canonical' uses an unsafe URL scheme`);
  }
}

/** `null` is the clear sentinel (see file header) — skipped, same as `undefined`. */
function validateBooleanFields(patch: Record<string, unknown>): void {
  for (const key of BOOLEAN_FIELDS) {
    const value = patch[key];
    if (value !== undefined && value !== null && typeof value !== "boolean") {
      throw new SeoFieldValidationError(`'${key}' must be a boolean`);
    }
  }
}

/** `null` is the clear sentinel (see file header) — skipped, same as `undefined`. */
function validateEnumFields(patch: Record<string, unknown>): void {
  if (
    patch.ogType !== undefined &&
    patch.ogType !== null &&
    !(OG_TYPE_VALUES as readonly unknown[]).includes(patch.ogType)
  ) {
    throw new SeoFieldValidationError(`'ogType' must be one of ${OG_TYPE_VALUES.join(", ")}`);
  }
  if (
    patch.twitterCard !== undefined &&
    patch.twitterCard !== null &&
    !(TWITTER_CARD_VALUES as readonly unknown[]).includes(patch.twitterCard)
  ) {
    throw new SeoFieldValidationError(`'twitterCard' must be one of ${TWITTER_CARD_VALUES.join(", ")}`);
  }
}

/** Share-image fields whose media ref must be an image (2026-10-05, see `seoImageRefRefusal`). */
const SHARE_IMAGE_FIELDS = ["ogImage", "twitterImage"] as const;

/** Refuses a share-image field that names a known non-image asset. Runs after `authorize`, so a
 *  caller without `admin.seo.manage` cannot probe the media library through its message. */
async function validateShareImageRefs(media: FeaturedImageDeps, input: SetEntrySeoOverridesInput): Promise<void> {
  for (const field of SHARE_IMAGE_FIELDS) {
    const refusal = await seoImageRefRefusal({ deps: media, input: { workspaceId: input.workspaceId, field, ref: input.patch[field] } });
    if (refusal) throw new SeoFieldValidationError(refusal);
  }
}

function validateSeoExtFieldsPatch(patch: Record<string, unknown>): void {
  validateRegisteredKeys(patch);
  validateStringLikeFields(patch, STRING_FIELDS, STRING_FIELD_MAX_LENGTH);
  validateStringLikeFields(patch, URL_FIELDS, URL_FIELD_MAX_LENGTH);
  validateCanonicalScheme(patch);
  validateBooleanFields(patch);
  validateEnumFields(patch);
}

/** Fields whose change can flip sitemap eligibility (INV-04/INV-05) — a direct, non-outbox cache-invalidation trigger. */
const SITEMAP_ELIGIBILITY_FIELDS: ReadonlyArray<string> = ["noindex", "canonical"];

function touchesSitemapEligibility(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).some((key) => SITEMAP_ELIGIBILITY_FIELDS.includes(key));
}

export interface SetEntrySeoOverridesDeps {
  postRepo: PostRepoPort;
  authorize: AuthorizeFn;
  /** Injected so this chokepoint stays testable ahead of Phase 6's `sitemap.ts` (see file header). */
  invalidateSitemapCache: (input: { workspaceId: string }) => void | Promise<void>;
  /**
   * `post_revisions` timestamping (2026-09-18, round 4) — see {@link mergeOverridesOntoCurrentRow}'s
   * updated doc. Required, not optional-with-a-fallback like `createPost`/`updatePost`'s own
   * `beforeSaveHook`: every real caller (`seo/tool-registrations.ts`, `routes/seo/put-entry.ts`)
   * already has a `ClockPort` on its own deps bag, so there is no "existing caller with no reachable
   * clock" case to preserve compiling here the way `CreatePostDeps.beforeSaveHook`'s doc describes.
   */
  clock: ClockPort;
  /** Media lookups for the share-image check (2026-10-05): an `ogImage`/`twitterImage` ref naming a
   *  video is refused. Required so no write path can skip it by not wiring it. */
  media: FeaturedImageDeps;
}

export interface SetEntrySeoOverridesInput {
  workspaceId: string;
  entryId: string;
  patch: SeoExtFieldsPatch;
  callerPrincipalId: string;
}

/** Applies `patch` onto `currentOverrides`: a `null` value REMOVES that key (clears the override
 *  back to absent, see file header); any other value sets/replaces it; `undefined` (an omitted
 *  key) is left untouched. Pure — never mutates `currentOverrides`. */
function applyOverridesPatch(currentOverrides: SeoExtFields, patch: SeoExtFieldsPatch): SeoExtFields {
  const merged: Record<string, unknown> = { ...currentOverrides };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key];
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged as SeoExtFields;
}

export interface SetEntrySeoOverridesRequired {
  deps: SetEntrySeoOverridesDeps;
  input: SetEntrySeoOverridesInput;
}

/**
 * How many times the read-merge-write below will re-read a row another writer won underneath it.
 *
 * Three, not one, because a single retry is indistinguishable from luck, and not "until it lands",
 * because an unbounded loop against a hot row is a request that never returns. A row rewritten
 * three times inside the microtask gaps of one SEO write is not contention, it is something wrong.
 */
const MAX_MERGE_ATTEMPTS = 3;

/**
 * The SEO chokepoint's whole write: read the row, merge the patch onto whatever it currently holds,
 * and persist it ONLY while it is still the row that was read.
 *
 * Why the predicate (2026-09-07, fable bugs audit SEO-01): this writes the WHOLE row — it is a
 * `PostRecord` spread, not a one-column UPDATE — so an unconditional `save()` here rewrites
 * `bodyJson`, `title` and `status` with whatever they were when this function read them. A content
 * save that landed in the gap was silently reverted by an operator editing a meta description, and
 * the SEO write reported success. `saveIfVersion` refuses that write instead.
 *
 * Why a retry rather than a conflict error: unlike `updatePost`, no SEO caller states a version
 * basis, so there is nobody to hand a 409 to and nothing for them to reconcile — the patch is a
 * merge, and re-reading simply merges it onto newer content, which is what the caller asked for.
 * The caller-visible outcome on a contended row is therefore unchanged (success); what changed is
 * that it no longer takes the other writer's content down with it.
 *
 * Note this DOES still bump `version` on an SEO-only change, which makes an open editor's autosave
 * basis stale (`PostRepoPort.writeAutosave`'s predicate) and can 409 its next explicit Save. That
 * is pre-existing behaviour and deliberately unchanged here — it is a contract question about what
 * `posts.version` means, not a concurrency bug.
 *
 * Revision ledger (2026-09-18, round 4): this was the one production write path that bumped
 * `posts.version` without appending a `post_revisions` row — a real, disclosed bypass
 * (`2026-09-18-impl-post-revisions-3.md` finding #1). Fixed by reusing the SAME
 * `PostRepoPort.transaction`/`appendRevision` primitive `createPost`/`updatePost`/`deletePost`
 * already use for exactly this purpose (`post.ts`), rather than calling `updatePost()` itself:
 * `updatePost` throws `PostVersionConflictError` on a stale basis, which would turn this function's
 * own retry-on-conflict loop (the whole point of SEO-01, see above) into a single-shot rejection —
 * a real behavior change to an already-tested concurrency contract. Reusing the lower primitive
 * keeps `saveIfVersion`'s retry loop byte-for-byte unchanged while still writing exactly one
 * revision per successful merge, atomically with the row write it describes.
 *
 * @throws SeoEntryNotFoundError when the entry does not exist (or is deleted mid-retry).
 * @throws EntityNotLiveError (`@jini-ai/cms/core`, S6 web-high fix plan 2026-09-24) when the entry
 * is in the Trash. Checked every attempt, inside the retry loop, so a row trashed between two
 * attempts is refused on the next read rather than merged onto and resurrected.
 * @throws SeoConcurrentWriteError when {@link MAX_MERGE_ATTEMPTS} reads all lost the row.
 * @complexity O(attempts) queries, one read + one conditional write (+ one revision append on the
 * attempt that lands) each; one of each in the uncontended case.
 */
async function mergeOverridesOntoCurrentRow(
  postRepo: PostRepoPort,
  clock: ClockPort,
  input: SetEntrySeoOverridesInput
): Promise<SeoExtFields> {
  for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt += 1) {
    const existing = await postRepo.findById({ workspaceId: input.workspaceId, id: input.entryId });
    if (!existing) {
      throw new SeoEntryNotFoundError(`entry '${input.entryId}' was not found`);
    }
    assertEntityLive({ entityType: existing.kind, entityId: input.entryId, state: postRepo.isTrashed({ post: existing }) ? "trashed" : "live" });

    const currentOverrides: SeoExtFields = existing.seoExtJson ? JSON.parse(existing.seoExtJson) : {};
    const mergedOverrides: SeoExtFields = applyOverridesPatch(currentOverrides, input.patch);
    const nextVersion = existing.version + 1;
    const updatedRecord = {
      ...existing,
      // Zero remaining keys returns the row to its true original state (`NULL`), not a leftover
      // `"{}"` — see file header.
      seoExtJson: Object.keys(mergedOverrides).length === 0 ? null : JSON.stringify(mergedOverrides),
      version: nextVersion,
    };

    // The write and its revision-ledger append are one atomic unit, same discipline as
    // `createPost`/`updatePost`/`deletePost` (`post.ts`'s own doc on `PostRepoPort.transaction`) —
    // a revision must never be recorded for a save that didn't apply, and an applied save must
    // never land unaccompanied by its revision. A `saveIfVersion` miss (lost the race) returns
    // normally with `applied: false` rather than throwing, so the transaction still commits (a
    // harmless no-op) and the outer loop retries with a fresh read, exactly as before this change.
    const applied = await postRepo.transaction({ fn: async () => {
      const { applied: didApply } = await postRepo.saveIfVersion({ record: updatedRecord, ifVersion: existing.version });
      if (!didApply) return false;
      await postRepo.appendRevision({
        postId: updatedRecord.id,
        workspaceId: updatedRecord.workspaceId,
        seq: nextVersion,
        op: "update",
        stateJson: updatedRecord,
        actorId: input.callerPrincipalId,
        recordedAt: clockNowIso({ clock: clock }),
      });
      return true;
    } });
    if (applied) return mergedOverrides;
  }

  throw new SeoConcurrentWriteError(
    `entry '${input.entryId}' is being written by another save; the SEO overrides were not applied`
  );
}

/**
 * REQ-01/02/03 chokepoint write: authorize -> validate -> merge -> save -> conditional cache invalidation.
 * @throws EntityNotLiveError (via {@link mergeOverridesOntoCurrentRow}, S6 web-high fix plan
 * 2026-09-24) when the entry is in the Trash — no merge, no version bump, no revision.
 */
export async function setEntrySeoOverrides(
  required: SetEntrySeoOverridesRequired,
  _optional: Record<string, never> = {}
): Promise<{ overrides: SeoExtFields }> {
  const { deps, input } = required;

  const authResult = await deps.authorize({
    principalId: input.callerPrincipalId,
    permission: "admin.seo.manage",
    workspaceId: input.workspaceId,
    entityType: "seo-entry",
    entityId: input.entryId,
  });
  if (!authResult.allowed) {
    throw new ForbiddenError({ message: `principal '${input.callerPrincipalId}' is not authorized for 'admin.seo.manage' (${authResult.reason})`, permission: "admin.seo.manage", reason: authResult.reason });
  }

  validateSeoExtFieldsPatch(input.patch as Record<string, unknown>);
  await validateShareImageRefs(deps.media, input);

  const mergedOverrides = await mergeOverridesOntoCurrentRow(deps.postRepo, deps.clock, input);

  if (touchesSitemapEligibility(input.patch as Record<string, unknown>)) {
    await deps.invalidateSitemapCache({ workspaceId: input.workspaceId });
  }

  return { overrides: mergedOverrides };
}
