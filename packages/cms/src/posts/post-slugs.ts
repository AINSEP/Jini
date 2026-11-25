import type { SlugChangeCapture } from "../routing/index.js";
import { SLUG_FORMAT_PATTERN, MAX_SLUG_LENGTH, DERIVED_SLUG_SUFFIX_ROOM, derivePostSlugBase } from "./slug.js";
import { PostValidationError, ROOT_SLUG, type PostRepoPort, type PostRecord, PostConflictError } from "./post.js";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";
import type { UUID } from "@jini-ai/core/primitives";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
import { deriveAvailableName } from "@jini-ai/core/naming";

/** The call-time lookup {@link UpdatePostDeps.slugChangeCapture} takes — `getSlugChangeCapture`'s shape. */
export type SlugChangeCaptureLookup = () => SlugChangeCapture | undefined;

/** The host's reserved first path segments (e.g. its admin and API surfaces), bound by the host:
 *  routing's reserved surfaces are the host's, so this owner never imports them. */
export type ReservedSlugSegments = ReadonlySet<string>;

/** The host's public path for a post slug (`postPublicPath`), bound by the host for {@link captureSlugChange}. */
export type PostPublicPathResolver = (required: { slug: string }) => string;

/** The create input fields {@link resolveCreateSlug} reads. */
export interface CreateSlugInput {
  workspaceId: UUID;
  kind?: PostKind;
}

/** Published schema pattern only; the kind gate stays in validateUpdatePostInput/resolveExplicitSlug. */
export const SLUG_OR_ROOT_PATTERN = /^(?:\/|[a-z0-9-]+)$/;

/** Shared slug-format rule (`updatePost` and `createPost`'s explicit-slug path both apply it — same rule, one source of truth). */
function isValidSlugFormat({ slug }: { slug: string }, _optional: Record<string, never> = {}): boolean {
  return SLUG_FORMAT_PATTERN.test(slug);
}

/**
 * behavior.spec.md BR-02/BR-03 reserved-word rule — the platform owns the reserved segments. One
 * check, one message, for both `createPost`'s explicit slug and `updatePost`'s rename: the update
 * path used to check format only, so create refused `admin` and a rename onto it succeeded.
 *
 * @throws PostValidationError `slug '<slug>' is reserved`.
 */
function assertSlugNotReserved({ slug, reservedSegments }: { slug: string; reservedSegments: ReservedSlugSegments }, _optional: Record<string, never> = {}): void {
  if (reservedSegments.has(slug.toLowerCase())) {
    throw new PostValidationError(`slug '${slug}' is reserved`);
  }
}

/**
 * The whole caller-supplied slug rule, in behavior.spec.md BR-03's documented order (format, then
 * length, then reserved-word) — one validator for `createPost`'s explicit slug and `updatePost`'s
 * rename. The update path used to run its own partial copy (format, later reserved) and skipped the
 * {@link MAX_SLUG_LENGTH} bound, so a rename could store a slug create would have refused.
 *
 * `kind` gates the {@link ROOT_SLUG} exception: only a `"page"` may claim `/`; a `"post"` asking
 * for it gets the same format message as any other malformed slug (see `ROOT_SLUG`'s doc).
 *
 * @throws PostValidationError on the first failing rule, with create's exact message.
 * @complexity O(n) in the slug's length (one regex test).
 */
export function assertValidExplicitSlug({ slug, kind, reservedSegments }: { slug: string; kind: PostKind; reservedSegments: ReservedSlugSegments }, _optional: Record<string, never> = {}): void {
  const validFormat = slug === ROOT_SLUG ? kind === "page" : isValidSlugFormat({ slug });
  if (!validFormat) {
    throw new PostValidationError("slug must use lowercase letters, numbers, and dashes");
  }
  if (slug.length > MAX_SLUG_LENGTH) {
    throw new PostValidationError(`slug must be ${MAX_SLUG_LENGTH} characters or fewer`);
  }
  // SPEC-002 REQ-04/AC-04: explicit reserved slugs are refused (BR-03); title-derived slugs
  // skip reserved candidates in availablePostSlug, using the ordinary collision suffix (BR-02).
  assertSlugNotReserved({ slug, reservedSegments });
}

/**
 * A new post's slug: the caller's explicit one (a LIVE holder is a conflict), else one derived
 * from `title` past LIVE holders. Either way a TRASHED holder is returned for the caller to move aside.
 * @throws {PostConflictError} When the explicit slug is live elsewhere, or the derived search is exhausted.
 * @complexity O(1) explicit; O(n) derived, n bounded at 999 by the shared naming helper.
 */
export async function resolveCreateSlug(
  required: { repo: PostRepoPort; input: CreateSlugInput; title: string; explicitSlug: string | undefined; reservedSegments: ReservedSlugSegments },
  _optional: Record<string, never> = {}
): Promise<{ slug: string; trashedHolder: PostRecord | null }> {
  const { repo, input, title, explicitSlug, reservedSegments } = required;
  if (explicitSlug === undefined) return availablePostSlug({ repo, workspaceId: input.workspaceId, title, kind: input.kind ?? "post", reservedSegments });
  const trashedHolder = await trashedSlugHolderOrConflict({ repo, workspaceId: input.workspaceId, slug: explicitSlug });
  return { slug: explicitSlug, trashedHolder };
}

/**
 * The one slug-uniqueness rule `createPost`'s explicit-slug path and `updatePost`'s rename share:
 * a slug a DIFFERENT, LIVE record holds is a conflict; your own current slug is not; and a slug
 * only a TRASHED record holds is free — that record is returned for {@link releaseTrashedSlug} to
 * move aside inside the caller's write transaction.
 *
 * Owner order 2026-10-08: an item in the Trash never blocks a slug for new content (a site import
 * once put its homepage at `/start` because a trashed page still held `/`).
 *
 * @returns the trashed holder to release, or `null` when the slug is free or already `selfId`'s.
 * @throws PostConflictError `slug '<slug>' already exists` when a live record holds it.
 * @complexity O(1) — one indexed lookup.
 */
export async function trashedSlugHolderOrConflict(
  required: { repo: PostRepoPort; workspaceId: UUID; slug: string },
  optional: { selfId?: UUID } = {}
): Promise<PostRecord | null> {
  const holder = await required.repo.findBySlug({ workspaceId: required.workspaceId, slug: required.slug });
  if (!holder || holder.id === optional.selfId) return null;
  if (isTrashed(holder)) return holder;
  throw new PostConflictError(`slug '${required.slug}' already exists`);
}

/** What a released trashed row's slug becomes: `<slug>-trashed` (`/` → `home-trashed`). */
const TRASHED_SLUG_SUFFIX = "-trashed";

/**
 * Moves a TRASHED row off `holder.slug` so a new write can take it: renames it to
 * `<slug>-trashed` (`/` → `home-trashed`, cut to fit {@link MAX_SLUG_LENGTH}), suffixed `-2`,
 * `-3`, … past any slug already taken — the same loop `createPost`'s derived-slug path uses.
 *
 * Changes ONLY the slug. `version`, `updatedAt` and the trash marker stay exactly as the Trash
 * recorded them, because the Trash index stores the row's version at trash time and Restore and
 * purge both compare against it (`@jini-ai/cms/trash` `restore` → the post adapter's `unhide`): a
 * version bump here would leave the row in the Trash forever, neither restorable nor purgeable.
 * Restore therefore still works and brings the row back at its renamed address. For the same
 * reason no revision is appended — a Trash restore appends none either — and the Trash list keeps
 * showing the original slug as the item's subtitle, which is the record of where it used to live.
 *
 * Must run inside the caller's write transaction, BEFORE the claiming row is saved, so the real
 * `posts_workspace_slug_unique` index never sees two rows on one slug.
 *
 * @returns the moved row as saved (same version, new slug).
 * @throws PostConflictError when the holder changed (restored, edited) since it was read.
 * @complexity O(s) lookups for s already-taken renamed slugs (in practice 1), plus one
 * conditional write.
 */
export async function releaseTrashedSlug({ repo, holder }: { repo: PostRepoPort; holder: PostRecord }, _optional: Record<string, never> = {}): Promise<PostRecord> {
  const stem = (holder.slug === ROOT_SLUG ? "home" : holder.slug).slice(
    0,
    MAX_SLUG_LENGTH - TRASHED_SLUG_SUFFIX.length - DERIVED_SLUG_SUFFIX_ROOM
  );
  const base = `${stem}${TRASHED_SLUG_SUFFIX}`;
  let slug = base;
  let suffix = 1;
  while (await repo.findBySlug({ workspaceId: holder.workspaceId, slug })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
  const moved: PostRecord = { ...holder, slug };
  const { applied } = await repo.saveIfVersion({ record: moved, ifVersion: holder.version });
  if (!applied) {
    throw new PostConflictError(`slug '${holder.slug}' changed while it was being taken from the Trash`);
  }
  return moved;
}

/**
 * Hands the bound `SlugChangeCapture` a published entry's old and new public
 * paths, so its old URL 301s to the new one instead of 404ing. Called inside `updatePost`'s
 * transaction, after the row write: the capture opens no transaction of its own (ADR-PIPE-009
 * Decision A), so its redirect lands or rolls back with the rename, and a throw aborts both (INV-02).
 *
 * Fires only when the slug changed on an entry that was PUBLISHED before this write — a draft's URL
 * was never public, so there is nothing to preserve, while unpublishing under a new slug still
 * captures because the old URL was live until now. Never from the root slug: a rule from `/` would
 * send the homepage away once the theme's own index is what `/` should fall back to.
 *
 * Content stays redirect-ignorant: it only knows routing's slot, never the redirects feature.
 *
 * @complexity O(1) — one lookup and at most one capture call.
 */
export async function captureSlugChange(
  { lookup, existing, post, actor, postPublicPath }: { lookup: SlugChangeCaptureLookup | undefined; existing: PostRecord; post: PostRecord; actor: UUID; postPublicPath: PostPublicPathResolver },
  _optional: Record<string, never> = {}
): Promise<void> {
  if (existing.slug === post.slug || existing.status !== "published" || existing.slug === ROOT_SLUG) return;
  const capture = lookup?.();
  if (!capture) return;
  await capture.onSlugChange({
    workspaceId: post.workspaceId,
    entryId: post.id,
    oldPath: postPublicPath({ slug: existing.slug }),
    newPath: postPublicPath({ slug: post.slug }),
    actor,
  });
}

/** Publication history belongs to the revision ledger; returning to draft never frees a URL. */
export async function hasPostBeenPublished({ post }: { post: PostRecord }, { repo }: { repo: PostRepoPort }): Promise<boolean> {
  return post.status === "published" || (await repo.listRevisions({ workspaceId: post.workspaceId, postId: post.id })).some(revision => revision.stateJson.status === "published");
}

/** The derived-slug exhaustion refusal; `onExhausted` throws it as a PostConflictError, so the
 * naming helper's own plain-Error fallback never fires. */
function slugTakenMessage({ base }: { base: string }): string {
  return `slug '${base}' already exists`;
}

/**
 * Reuse the platform collision search with post numbering from 1 and page numbering from 2.
 * `derivePostSlugBase` slugifies the title, drops trailing dashes after cutting to leave
 * {@link DERIVED_SLUG_SUFFIX_ROOM}, or uses `"untitled"` when nothing usable remains. This room
 * under {@link MAX_SLUG_LENGTH} is for `createPost`'s numbered collision suffix (BR-02's bound):
 * a derived slug must pass the rule every `updatePost` applies, or the post can never be saved again.
 * The shared slug rules export DERIVED_SLUG_SUFFIX_ROOM for this policy and the editor.
 */
export async function availablePostSlug(required: { repo: PostRepoPort; workspaceId: UUID; title: string; kind: PostKind; selfId?: UUID; reservedSegments: ReservedSlugSegments }, _optional: Record<string, never> = {}) {
  let trashedHolder: PostRecord | null = null;
  const slug = await deriveAvailableName({
    base: derivePostSlugBase({ title: required.title }),
    isTaken: async ({ candidate }) => {
      if (required.reservedSegments.has(candidate.toLowerCase())) return true;
      const holder = await required.repo.findBySlug({ workspaceId: required.workspaceId, slug: candidate });
      trashedHolder = holder && isTrashed(holder) ? holder : null;
      return !!holder && holder.id !== required.selfId && !isTrashed(holder);
    },
    withSuffix: ({ base, suffix }) => `${base}-${required.kind === "post" ? suffix - 1 : suffix}`,
    exhaustionMessage: slugTakenMessage,
  }, { maxAttempts: 999, onExhausted: ({ base }) => { throw new PostConflictError(slugTakenMessage({ base })); } });
  return { slug, trashedHolder };
}
