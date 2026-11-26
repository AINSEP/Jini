import { type UUID, type JsonObject, type Clock as ClockPort, nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { PostStatus } from "@jini-ai/cms/core";
import { type PostRepoPort, type PostRecord, PostValidationError, type PublicPostRecord, isPublicPost, PostNotFoundError, SYSTEM_ACTOR_ID } from "@jini-ai/cms/posts/post";
import type { OutboxPort } from "@jini-ai/core/contracts/events";
import { type BeforeSaveHookPort, runBeforeSaveHook, withCoverPresentation, mergeExt } from "@jini-ai/cms/posts/post-before-save";
import { type SlugChangeCaptureLookup, assertValidExplicitSlug, hasPostBeenPublished, availablePostSlug, trashedSlugHolderOrConflict, releaseTrashedSlug, captureSlugChange } from "@jini-ai/cms/posts/post-slugs";
import { assertOptionalBoolean, assertPostPresentationFields, assertTitleWithinLimit, isJsonObject, isValidPostStatus, presentScheduleFields, normalizePublishAt, normalizeFeaturedMediaId, normalizePostAuthor, normalizeShowPostAuthor, resolveUpdateBodyFields, savedPostContent } from "@jini-ai/cms/posts/post-write-fields";
import { isAutomaticPostSlug } from "@jini-ai/cms/posts/slug";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
import { assertExpectedVersion, persistUpdatedPost, appendPostRevision, enqueueContentWrite, emitPublicTransitionEvent, postEventActor } from "@jini-ai/cms/posts/post-write-effects";
import type { MutationActor } from "@jini-ai/core/contracts/events";
import type { isDeepStrictEqual } from "node:util";

export interface UpdatePostInput {
  analyticsSource?: "admin" | "assistant" | "service";
  workspaceId: UUID;
  id: UUID;
  title: string;
  slug?: string;
  /** Derive on Save only while the stored post still has an automatic, unpublished slug. */
  slugFromTitle?: boolean;
  /** Omit to preserve the saved presentation choice; missing stored value means hide. */
  hideCoverImageInBody?: boolean;
  bodyJson: JsonObject;
  status: PostStatus;
  /**
   * Post-template-picker feature (2026-08-10) — optional. `undefined` (the field simply omitted)
   * carries the existing choice over unchanged, matching every other field this endpoint doesn't
   * require a caller to resend; `null` explicitly clears a previously-chosen template.
   */
  templateChoice?: string | null;
  /**
   * Same "omit to leave unchanged" contract as {@link UpdatePostInput.templateChoice} just above —
   * `undefined` carries the existing value forward untouched; an explicit `null` resets it back to
   * *never decided* (the resolver's default applies again), and `true`/`false` set a permanent
   * explicit choice. See {@link PostRecord.overridesThemePage} for the full tri-state contract.
   */
  overridesThemePage?: boolean | null;
  /** Same "omit to leave unchanged" contract as {@link UpdatePostInput.templateChoice}: `undefined`
   *  keeps the stored go-live time, `null` clears it (live as soon as published), a date string sets
   *  it. See {@link PostRecord.publishAt}. */
  publishAt?: string | null;
  /** Same tri-state as {@link UpdatePostInput.publishAt}, for {@link PostRecord.featuredMediaId}. */
  featuredMediaId?: string | null;
  /** Omit to keep the stored credit; null or an empty string clears it. */
  author?: string | null;
  /** Omit to keep the stored toggle; false explicitly hides the byline. */
  showAuthor?: boolean;
  /**
   * Optimistic-concurrency basis (2026-09-06) — the {@link PostRecord.version} the caller believes
   * it is editing, captured when it read the row.
   *
   * OPTIONAL and opt-in. Omit it and `updatePost` behaves exactly as it always has (last write
   * wins), so no existing caller's behavior moves. Send it and a save built on a basis another save
   * has already superseded is rejected with a {@link PostVersionConflictError} instead of silently
   * erasing the other operator's document.
   *
   * Compared with strict equality against the row's current version and nothing else, so a value
   * that is not exactly that version is a conflict — including a nonsense one. Fail-closed by
   * design: the only safe reading of "I do not know which version I am editing" is "do not write".
   *
   * The same basis seam {@link PostAutosaveSnapshot.baseVersion} already keys off, applied to the
   * real save rather than to the standing draft. The two are independent guards over different
   * things: that one protects a parked draft, this one protects the live document.
   */
  expectedVersion?: number;
  /** Same optional-with-fallback contract as {@link CreatePostInput.actorId}. */
  actorId?: UUID;
  /** See {@link CreatePostInput.actor}. */
  actor?: MutationActor | undefined;
  /** Same optional-with-null-default contract as {@link CreatePostInput.delegatedByWorkspaceId}. */
  delegatedByWorkspaceId?: UUID | null;
  /** See {@link CreatePostInput.delegatedByWorkspaceId}. */
  delegatedById?: UUID | null;
}

export interface UpdatePostDeps {
  reservedSegments: ReadonlySet<string>;
  postPublicPath: import("./post-slugs.js").PostPublicPathResolver;
  isDeepStrictEqual: typeof isDeepStrictEqual;
  clock: ClockPort;
  repo: PostRepoPort;
  /**
   * SPEC-008 (ADR-PIPE-008 Decision §5) — required because every real caller
   * already has one available on `RouteDeps`. `updatePost` compares the
   * existing vs incoming `status` and enqueues at most one of
   * `entry.published`/`entry.updated`/`entry.unpublished` per the 4-row
   * transition table (INV-010) — the sole real signal source
   * `Jini/packages/cms/src/seo/sitemap.ts`'s cache invalidation (REQ-10) depends on.
   */
  outbox: OutboxPort;
  /**
   * SPEC-005 (CIC U-004) — OPTIONAL. Absent ⇒ the zero-plugin path behaves exactly as it did
   * before this feature (no `ext` is written, no extra call is made). See `runBeforeSaveHook`.
   */
  beforeSaveHook?: BeforeSaveHookPort;
  /**
   * SPEC-009 REQ-15 (ADR-039 §4) — looks up the `SlugChangeCapture` bound in routing's slot at call
   * time; the composition root passes `getSlugChangeCapture`. A lookup rather than the capture itself
   * because the slot is disposable: closing a site store unbinds its capture (39411114d), and a
   * write after that must see "nothing bound", not a capture over a closed database.
   *
   * OPTIONAL, and an absent lookup or an unbound slot captures nothing — routing's own doc names that
   * the safe no-op while Redirects is not installed. Every real update surface (`pages/update.ts`,
   * `posts/update.ts`, `content_post_update`) passes it; see `captureSlugChange` for when it fires.
   */
  slugChangeCapture?: SlugChangeCaptureLookup;
}

export interface UpdatePostRequired {
  deps: UpdatePostDeps;
  input: UpdatePostInput;
}

export interface UpdatePostOptional {}

/**
 * Validates and normalizes `updatePost`'s caller-supplied `title`/`slug`, and validates
 * `bodyJson`/`status` in place, in behavior.spec.md's documented order (first failure wins):
 * title (required, then length), then slug format/length/reserved-word, then `bodyJson` shape, then `status` enum — the same ordering
 * discipline `resolveCreateFields`'s per-field validators follow for `createPost`.
 */
function validateUpdatePostInput(
  input: UpdatePostInput,
  existing: PostRecord,
  reservedSegments: ReadonlySet<string>
): { title: string; slug: string } {
  const title = input.title.trim();
  assertOptionalBoolean({ value: input.slugFromTitle, name: "slugFromTitle" });
  assertOptionalBoolean({ value: input.hideCoverImageInBody, name: "hideCoverImageInBody" });
  assertPostPresentationFields(input);
  const slug = input.slugFromTitle === true ? existing.slug : (input.slug ?? "").trim().toLowerCase();

  if (!title) throw new PostValidationError("title is required");
  // An UNCHANGED title or slug is not re-validated: a row stored before these bounds existed (or a
  // slug derived before `derivePostSlugBase` bounded it) would otherwise refuse every unrelated edit —
  // a body-only save, and in the Page editor the HTML save that follows its metadata write.
  if (title !== existing.title) assertTitleWithinLimit({ trimmedTitle: title });
  // `existing.kind` is immutable (PostKind's own doc: "Fixed at creation; v1 has no post<->page
  // conversion path"), so the row's real kind — not any caller-supplied value, `UpdatePostInput`
  // carries none — is what gates the same root-slug exception `resolveExplicitSlug` applies on create.
  if (slug !== existing.slug) assertValidExplicitSlug({ slug, kind: existing.kind, reservedSegments });
  // Required for a `"doc"` row, meaningless for an `"html"` one. A bespoke-HTML Page has no Tiptap
  // document at all, so demanding one here would make its title, slug and status permanently
  // un-editable — the only way to change them is this function, and the caller has no Tiptap body
  // to send. `resolveUpdateBodyFields` ignores `input.bodyJson` on that branch anyway; this check
  // is what lets a caller legitimately omit it rather than inventing a dummy document to get past
  // a validation that does not apply to its content type.
  if (existing.bodyFormat !== "html" && !isJsonObject(input.bodyJson)) {
    throw new PostValidationError("bodyJson must be a JSON object");
  }
  if (!isValidPostStatus(input.status)) {
    throw new PostValidationError("status must be 'draft' or 'published'");
  }

  return { title, slug };
}

/**
 * Assembles the `PostRecord` `updatePost` will persist, once validation, the uniqueness check,
 * and the before-save hook have all already run.
 *
 * `ext` is destructured off `existing` so the conditional spread below is the single source of
 * truth for whether the saved record carries one at all (a stale `ext: {}` surviving the spread
 * would violate AC-14).
 */
function buildUpdatedPost(
  { existing, input, fields, ext, now }: { existing: PublicPostRecord; input: UpdatePostInput; fields: { title: string; slug: string }; ext: JsonObject | undefined; now: string },
  _optional: Record<string, never> = {}
): PublicPostRecord {
  const { ext: _priorExt, publishAt: _priorPublishAt, featuredMediaId: _priorFeatured, ...carriedOver } = existing;
  return {
    ...carriedOver,
    // `undefined` keeps the stored value, `null` clears it — the same tri-state as `templateChoice`.
    ...presentScheduleFields({
      publishAt: input.publishAt === undefined ? existing.publishAt : normalizePublishAt({ value: input.publishAt }),
      featuredMediaId: input.featuredMediaId === undefined ? existing.featuredMediaId : normalizeFeaturedMediaId({ value: input.featuredMediaId }),
    }),
    ...(input.author !== undefined ? { author: normalizePostAuthor({ author: input.author }) } : {}),
    ...(input.showAuthor !== undefined ? { showAuthor: normalizeShowPostAuthor({ showAuthor: input.showAuthor }) } : {}),
    title: fields.title,
    slug: fields.slug,
    // SPEC-047/ADR-056 CIC-3 — forced explicitly rather than left to `...carriedOver`, for the same
    // reason `createPost` forces it: `UpdatePostInput` has no `bodyFormat`/`bodyHtml` field to even
    // read, so no caller can convert a row's format through this path. What it does NOT do any more
    // is flatten an html Page back to `doc` on a title edit — see `resolveUpdateBodyFields`'s doc
    // for the data-loss bug that behavior caused once html Pages became reachable.
    ...resolveUpdateBodyFields(existing, input.bodyJson),
    status: input.status,
    updatedAt: now,
    version: existing.version + 1,
    ...(input.templateChoice !== undefined ? { templateChoice: input.templateChoice } : {}),
    ...(input.overridesThemePage !== undefined ? { overridesThemePage: input.overridesThemePage } : {}),
    ...(ext !== undefined ? { ext } : {}),
  };
}

/**
 * Whether a `slugFromTitle` rename re-derives the slug: only for a changed title on a never-published
 * post whose slug is still the automatic one. Pages and published URLs keep their address.
 * @complexity O(1), plus one revision-ledger read when every cheaper condition holds.
 */
async function followsTitleSlug(
  required: { repo: PostRepoPort; input: UpdatePostInput; existing: PostRecord; title: string },
  _optional: Record<string, never> = {}
): Promise<boolean> {
  const { repo, input, existing, title } = required;
  if (input.slugFromTitle !== true || title === existing.title || existing.kind !== "post" || !isAutomaticPostSlug(existing)) return false;
  return !(await hasPostBeenPublished({ post: existing }, { repo }));
}

/**
 * The hook/slug check can await another writer. A no-op has no CAS UPDATE to reject a stale
 * basis, so observe the live row again inside the same transaction before returning it.
 * @returns the live row when it still matches `post`'s saved content, else `null` (write it).
 * @throws {PostNotFoundError} When the row vanished or was trashed meanwhile.
 * @throws {PostVersionConflictError} When the caller's expectedVersion has gone stale.
 * @complexity O(n) comparison for n body/ext JSON values; one repo read.
 */
async function unchangedLiveRow(
  required: { repo: PostRepoPort; input: UpdatePostInput; post: PostRecord },
  _optional: Record<string, never> = {}
): Promise<PublicPostRecord | null> {
  const { repo, input, post } = required;
  const current = await repo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!isPublicPost(current) || isTrashed(current)) throw new PostNotFoundError(`post '${input.id}' was not found`);
  assertExpectedVersion({ existing: current, expectedVersion: input.expectedVersion });
  return isDeepStrictEqual(savedPostContent(current), savedPostContent(post)) ? current : null;
}

/**
 * Validates and saves a post/page, appending a revision only when normalized, hook-merged content
 * changes. An unchanged save returns the current record and null revision ids; it still rejects
 * a stale expectedVersion, including one that became stale during the before-save hook.
 * @complexity O(n) comparison time/space for n body/ext JSON values, with bounded repo operations.
 */
export async function updatePost(
  required: UpdatePostRequired,
  _optional: UpdatePostOptional = {}
): Promise<{ post: PublicPostRecord; revisionId: string | null; previousRevisionId: string | null }> {
  const { deps, input } = required;
  // The channel vouches for the kind, the principal authorizes: an actor naming somebody else is refused before any write.
  postEventActor({ actorId: input.actorId, actor: input.actor });
  const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.id });
  // A trashed row is not-found for editing purposes — indistinguishable from a missing id, the same
  // way `pages/update.ts` treats a kind mismatch. Restore it (revert the delete change set) before
  // editing it; there is no edit-through-the-trash path.
  // An email template shares this table but is not a post (EMAIL_TEMPLATE_KIND's own doc): not-found
  // here is what keeps one from ever being published.
  if (!isPublicPost(existing) || isTrashed(existing)) throw new PostNotFoundError(`post '${input.id}' was not found`);
  assertExpectedVersion({ existing, expectedVersion: input.expectedVersion });

  const fields = validateUpdatePostInput(input, existing, deps.reservedSegments);
  const title = fields.title;
  let slug = fields.slug;
  // Validated here, before any further repo access, so a bad date writes nothing; normalized again
  // (idempotently) where the record is built.
  normalizePublishAt({ value: input.publishAt });
  normalizeFeaturedMediaId({ value: input.featuredMediaId });
  normalizePostAuthor({ author: input.author });
  normalizeShowPostAuthor({ showAuthor: input.showAuthor });
  if (await followsTitleSlug({ repo: deps.repo, input, existing, title })) {
    slug = (await availablePostSlug({ repo: deps.repo, workspaceId: input.workspaceId, title, kind: "post", selfId: existing.id, reservedSegments: deps.reservedSegments })).slug;
  }
  const trashedHolder = await trashedSlugHolderOrConflict({ repo: deps.repo, workspaceId: input.workspaceId, slug }, { selfId: input.id });

  // CIC U-004: the hook resolves (or throws) BEFORE the record is built and BEFORE the single
  // repo.save() below. The draft the filters see carries the entry's already-written ext (every
  // other plugin's namespaces), per REQ-05.
  const extPatch = await runBeforeSaveHook({ hook: deps.beforeSaveHook, draft: {
    id: existing.id,
    workspaceId: input.workspaceId,
    title,
    slug,
    status: input.status,
    // The body the save will actually persist, not the one the caller sent — on an html Page those
    // differ, and a plugin filter reasoning about an entry it is about to see saved must be shown
    // the former.
    bodyJson: existing.bodyFormat === "html" ? existing.bodyJson : input.bodyJson,
    ext: (existing.ext ?? {}) as Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  } });
  const ext = withCoverPresentation({ ext: mergeExt({ existingExt: existing.ext, patch: extPatch }), hideCoverImageInBody: input.hideCoverImageInBody });

  const now = clockNowIso({ clock: deps.clock });
  const post = buildUpdatedPost({ existing, input, fields: { title, slug }, ext, now });

  // The record write and its revision-ledger append are one atomic unit (see
  // `PostRepoPort.transaction`'s own doc). A conflict rejection from `persistUpdatedPost` (nothing
  // written) still propagates out of this `transaction()` call correctly — its `catch` rolls back
  // (a no-op when nothing landed) and rethrows unchanged, so `PostVersionConflictError`/
  // `PostNotFoundError` reach the caller exactly as they did before this change.
  return deps.repo.transaction({ fn: async () => {
    if (deps.isDeepStrictEqual(savedPostContent(existing), savedPostContent(post))) {
      const current = await unchangedLiveRow({ repo: deps.repo, input, post });
      if (current) return { post: current, revisionId: null, previousRevisionId: null };
    }
    if (trashedHolder) await releaseTrashedSlug({ repo: deps.repo, holder: trashedHolder });
    await persistUpdatedPost({ repo: deps.repo, post, expectedVersion: input.expectedVersion });
    await captureSlugChange({ lookup: deps.slugChangeCapture, existing, post, actor: input.actorId ?? SYSTEM_ACTOR_ID, postPublicPath: deps.postPublicPath });
    const { id: revisionId, previousId: previousRevisionId } = await appendPostRevision({ repo: deps.repo, post, op: "update", attribution: input });
    // Inside the transaction (2026-10-21): committing the edit without its event (a crash, a failed
    // enqueue) would push `updatedAt` past a pending go-live and lose that announcement for good.
    await enqueueContentWrite({ outbox: deps.outbox, post, actorId: input.actorId, source: input.analyticsSource, operation: "saved", actor: input.actor });
    await emitPublicTransitionEvent({ outbox: deps.outbox, previous: existing, next: post, nowIso: now, actorId: input.actorId, source: input.analyticsSource, actor: input.actor });
    return { post, revisionId, previousRevisionId };
  } });
}
