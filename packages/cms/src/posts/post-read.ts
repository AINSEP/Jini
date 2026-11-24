import type { UUID } from "@jini-ai/core/primitives";
import { type PublicPostRecord, type PostRepoPort, isPublicPost, PostNotFoundError } from "./post.js";
import type { PublicPostKind } from "../core/index.js";
import { isTrashed } from "@jini-ai/core/contracts/site/soft-delete";
import { currentIso, isLiveAt } from "@jini-ai/core/scheduled-publish";

/** Kind-filtered storage view; callers retain ownership of publication and trash visibility. */
export interface PublicPostReaderPort {
  findById(required: { workspaceId: UUID; id: UUID }, optional?: Record<string, never>): Promise<PublicPostRecord | null>;
  findBySlug(required: { workspaceId: UUID; slug: string }, optional?: Record<string, never>): Promise<PublicPostRecord | null>;
  list(required: { workspaceId: UUID }, optional?: Record<string, never>): Promise<PublicPostRecord[]>;
}

/**
 * Binds kind-filtered reads without changing raw storage or copying its write lifecycle.
 * Drafts and trash remain visible to readers that own their own liveness rules (SEO/widgets).
 * Repository errors propagate; complete records are retained for CAS and revision writes.
 * @complexity O(1) wiring/lookups beyond repo costs; list adds O(n) time/space for n rows.
 * @example createPublicPostReader({ repo: postRepo }).findById({ workspaceId, id });
 */
export function createPublicPostReader(
  { repo }: { repo: Pick<PostRepoPort, "findById" | "findBySlug" | "list"> },
  _options: Record<string, never> = {},
): PublicPostReaderPort {
  return {
    findById: async (input: Parameters<PostRepoPort["findById"]>[0], _options: Record<string, never> = {}): Promise<PublicPostRecord | null> => {
      const post = await repo.findById(input);
      return isPublicPost(post) ? post : null;
    },
    findBySlug: async (input: Parameters<PostRepoPort["findBySlug"]>[0], _options: Record<string, never> = {}): Promise<PublicPostRecord | null> => {
      const post = await repo.findBySlug(input);
      return isPublicPost(post) ? post : null;
    },
    list: async (input: Parameters<PostRepoPort["list"]>[0], _options: Record<string, never> = {}): Promise<PublicPostRecord[]> =>
      (await repo.list(input)).filter(isPublicPost),
  };
}

export interface GetPostByIdRequired {
  deps: { repo: PostRepoPort };
  input: { workspaceId: UUID; id: UUID };
}

export interface GetPostBySlugRequired {
  deps: { repo: PostRepoPort };
  input: { workspaceId: UUID; slug: string };
}

export interface GetPostByIdOrSlugRequired {
  deps: { repo: PostRepoPort };
  input: { workspaceId: UUID; idOrSlug: string };
}

export interface GetPostOptional {
  /** The instant scheduled rows are judged against (ISO UTC). Defaults to now; tests pin it. */
  nowIso?: string;
}

/**
 * `content_post_list`'s own output cap (H3) — NOT consumed by `listAdminPosts`/`listAdminPages`
 * below, which stay unbounded exactly as the admin Posts/Pages list screens they mirror already are
 * (out of this fix's scope). Defined here, rather than in `tool-registrations.ts` (the handler) or
 * `agent-tools.ts` (the catalog/schema), purely so both of those can import the same numbers without
 * one importing the other — mirrors `search.ts`'s identical `DEFAULT_POST_SEARCH_LIMIT`/
 * `MAX_POST_SEARCH_LIMIT` placement for `content_post_search`.
 */
export const DEFAULT_POST_LIST_LIMIT = 50;
/** Ceiling `content_post_list`'s `limit` input clamps into — see {@link DEFAULT_POST_LIST_LIMIT}. */
export const MAX_POST_LIST_LIMIT = 200;

export interface ListPostsRequired {
  deps: { repo: PostRepoPort };
  input: { workspaceId: UUID };
}

/**
 * List posts in a workspace for admin views (drafts included). Defaults to `kind: "post"`;
 * `kind: "all"` reads both public kinds in repository order with one scoped repository call.
 * By default excludes `kind: "page"` rows — Posts and Pages are separate admin-facing lenses
 * over the same table (see `PostKind` doc), so the default Posts screen must not show pages and
 * `listAdminPages` must not show posts. Explicit lens overrides share this visibility owner.
 * @example listAdminPosts({ deps: { repo }, input: { workspaceId } }, { kind: "all" })
 * @complexity O(n) time/space for n workspace rows; one repository read, no per-row I/O.
 */
export async function listAdminPosts(
  required: ListPostsRequired,
  { kind = "post" }: GetPostOptional & { kind?: PublicPostKind | "all" } = {}
): Promise<{ posts: PublicPostRecord[] }> {
  const posts = await required.deps.repo.list({ workspaceId: required.input.workspaceId });
  return { posts: posts.filter((post): post is PublicPostRecord => isPublicPost(post) && !isTrashed(post) && (kind === "all" || post.kind === kind)) };
}

/** List published posts for the public site. */
export async function listPublishedPosts(
  required: ListPostsRequired,
  optional: GetPostOptional = {}
): Promise<{ posts: PublicPostRecord[] }> {
  const posts = await required.deps.repo.list({ workspaceId: required.input.workspaceId });
  const nowIso = optional.nowIso ?? currentIso();
  return { posts: posts.filter((post): post is PublicPostRecord => isPublicPost(post) && isLiveAt({ record: post, nowIso })) };
}

export interface ListPublishedPostPreviewsRequired {
  deps: { repo: PostRepoPort };
  input: { workspaceId: UUID; limit: number; offset?: number };
}

/**
 * Bounded published-post listing for the post-previews marker (the host theme static renderer's
 * `injectPostPreviewsEmbeds`, via the host public site-pages route's
 * `resolvePostPreviewsForRender`). Thin wrapper over {@link PostRepoPort.listPublishedPreviews} —
 * see that method's own doc for why the bound and the `kind: "post"` filter both live in the query,
 * not here. The caller still owns member-visibility filtering (`readListingBatch`'s `isVisible`, ADR-030 §4);
 * this function only returns what is PUBLISHED, not what the current visitor may see.
 */
export async function listPublishedPostPreviews(
  required: ListPublishedPostPreviewsRequired,
  _optional: GetPostOptional = {}
): Promise<{ posts: PublicPostRecord[] }> {
  const posts = await required.deps.repo.listPublishedPreviews({
    workspaceId: required.input.workspaceId,
    limit: required.input.limit,
    offset: required.input.offset ?? 0,
    nowIso: _optional.nowIso ?? currentIso(),
  });
  return { posts: posts.filter(isPublicPost) };
}

/** List all pages (`kind: "page"`) in a workspace for admin views (drafts included). */
export async function listAdminPages(
  required: ListPostsRequired,
  _optional: GetPostOptional = {}
): Promise<{ posts: PublicPostRecord[] }> {
  return listAdminPosts(required, { ..._optional, kind: "page" });
}

export async function getAdminPostById(
  required: GetPostByIdRequired,
  _optional: GetPostOptional = {}
): Promise<{ post: PublicPostRecord }> {
  const { workspaceId, id } = required.input;
  const post = await required.deps.repo.findById({ workspaceId, id });
  // A trashed row 404s identically to a missing one — no existence leak, matching the
  // kind-mismatch rule `pages/get-by-id.ts` already applies.
  if (!isPublicPost(post) || isTrashed(post)) throw new PostNotFoundError(`post '${id}' was not found`);
  return { post };
}

export async function getPublishedPostBySlug(
  required: GetPostBySlugRequired,
  _optional: GetPostOptional = {}
): Promise<{ post: PublicPostRecord }> {
  const { workspaceId } = required.input;
  const slug = required.input.slug.trim().toLowerCase();
  const post = await required.deps.repo.findBySlug({ workspaceId, slug });
  // A scheduled row 404s exactly like a draft until its time passes — no existence leak.
  if (!isPublicPost(post) || !isLiveAt({ record: post, nowIso: _optional.nowIso ?? currentIso() })) {
    throw new PostNotFoundError(`post '${slug}' was not found`);
  }
  return { post };
}

/**
 * Fetch a post/page row by id, but only when it is publicly visible — published and not trashed.
 * The `findById`-shaped, NON-THROWING counterpart to {@link getPublishedPostBySlug}: a resolver
 * consulting this on behalf of an id a THEME AUTHOR or CONTENT AUTHOR typed into an embed marker
 * (`{"type":"content","id":"..."}"`, `{"type":"post","id":"..."}"`) needs "not visible" and "does not
 * exist" to look identical and non-fatal (the REQ-27 never-throws contract every `widgets/
 * resolver-service.ts` resolver follows), not a thrown domain error a route 404s on — that is
 * `getPublishedPostBySlug`'s job, for a URL a VISITOR typed.
 *
 * Guards the exact hazard an id-addressable embed marker introduces that a slug-addressable ROUTE
 * never had: a route's slug lookup can only ever resolve to the one page a visitor asked for, but an
 * id embedded inside a marker can name ANY row in the table, including a draft or a trashed one — so
 * "fetch by id" alone is not the same operation as "fetch the row a route has already proven is
 * public". Filtering here, at the one seam every id-driven embed resolver goes through, is what keeps
 * a draft page's content off the public site when a `content`/`post` marker happens to reference it
 * (2026-08-11 unified-content-marker design doc, guard 2 — the highest-risk part of that change).
 *
 * @complexity O(1) — one indexed `findById` call plus two field comparisons, no iteration.
 */
export async function findPublishedPostById(
  required: GetPostByIdRequired,
  _optional: GetPostOptional = {}
): Promise<PublicPostRecord | null> {
  const { workspaceId, id } = required.input;
  const post = await required.deps.repo.findById({ workspaceId, id });
  if (!isPublicPost(post) || !isLiveAt({ record: post, nowIso: _optional.nowIso ?? currentIso() })) return null;
  return post;
}

/**
 * Slug-addressed sibling of {@link findPublishedPostById} — identical trashed/status visibility
 * guard (guard 2), same non-throwing REQ-27 contract, only the lookup key differs. Added (S3,
 * 2026-09-23 widget-attrs plan) so a `content`/`post` embed marker can address a row by
 * `posts_workspace_slug_unique` the same way `{"type":"widget","slug":...}"`/`{"type":"media",
 * "slug":...}"` markers already address theirs (`entries`/media's own slug columns) — see
 * `resolver-service.ts`'s `findPublishedPostByRef` for the id-authoritative-when-present caller that
 * consults this.
 *
 * @complexity O(1) — one indexed `findBySlug` call plus two field comparisons, no iteration.
 */
export async function findPublishedPostBySlug(
  required: GetPostBySlugRequired,
  _optional: GetPostOptional = {}
): Promise<PublicPostRecord | null> {
  const { workspaceId, slug } = required.input;
  const post = await required.deps.repo.findBySlug({ workspaceId, slug });
  if (!isPublicPost(post) || !isLiveAt({ record: post, nowIso: _optional.nowIso ?? currentIso() })) return null;
  return post;
}

/**
 * Admin-facing lookup that accepts either a record's slug or its id — same trash-blind 404 as
 * {@link getAdminPostById}. **Slug first, id second** (2026-08-11).
 *
 * The slug is the handle a human types, reads, and puts in a URL; the id is an implementation
 * detail they never chose. So the slug is what resolves, and the id lookup stays as the fallback
 * so every existing id-based bookmark keeps working. Same precedent as `ffc0f44`'s slug-first menu
 * marker resolution.
 *
 * This used to try the id first, justified by the claim that "an id and a slug never collide (ids
 * are opaque UUIDs)". Half of that is wrong and the other half is unverified. Ids are NOT uniformly
 * opaque: six rows carry seed-authored ids (`post-home`, `post-about`, `post-themes`, `post-plugins`,
 * `post-plugin-api`, `post-self-hosting`) in the same character space slugs occupy, alongside
 * `idGen.newId()`'s UUIDs. But **no id currently equals any slug** — checked, 2026-08-11 — so
 * nothing was silently resolving to the wrong row, and order was a correctness question only in the
 * hypothetical. Recorded precisely because the original comment stated its no-collision premise as
 * settled fact rather than as the assumption it was; do not restate it either way without re-checking.
 *
 * Order therefore decides one real thing today: which lookup a URL is resolved BY, and so which
 * handle the product treats as a record's identity. That is a product answer, not a defensive one.
 */
export async function getAdminPostByIdOrSlug(
  required: GetPostByIdOrSlugRequired,
  _optional: GetPostOptional = {}
): Promise<{ post: PublicPostRecord }> {
  const { workspaceId, idOrSlug } = required.input;
  const selector = idOrSlug.trim().toLowerCase();
  // Page URL selectors share stored slugs; '/' remains the content-owned homepage.
  const slug = selector === "/" ? selector : selector.replace(/^\/+/, "");
  const bySlug = await required.deps.repo.findBySlug({ workspaceId, slug });
  const post = bySlug ?? (await required.deps.repo.findById({ workspaceId, id: idOrSlug }));
  if (!isPublicPost(post) || isTrashed(post)) throw new PostNotFoundError(`post '${idOrSlug}' was not found`);
  return { post };
}
