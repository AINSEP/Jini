import type { PostRecord } from "./post.js";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";
import { ROOT_SLUG } from "./post.js";
import type { PostStatus } from "../core/index.js";
import type { Routing } from "../routing/routing.js";
import { currentIso, isScheduledAt } from "@jini-ai/core/contracts/site/scheduled-publish";
import type { RuntimeMode } from "@jini-ai/core/contracts/site/core-runtime-mode";

/**
 * What the host binds for the views below. Declared as its own slice rather than taking the host's
 * whole tool-deps bag, so this module carries no edge into the host's composition root.
 */
export interface PostToolViewDeps {
  workspaceId: string;
  /** The host's configured routing instance's per-record public-path resolver. */
  entryPublicPath: Routing["entryPublicPath"];
  /** Whether this instance is the live site, for {@link publishedWhereView}. */
  runtimeMode: () => RuntimeMode;
  /** Host-worded `publishedWhere` copy for a published write on the live site / on a local copy. */
  publishedWhere: { live: string; local: string };
}

/** What a Posts/Pages tool returns to the model — see {@link toPostToolView}. */
interface PostToolView {
  template?: string | null;
  author: string | null;
  showAuthor: boolean;
  id: string;
  kind: PostKind;
  title: string;
  slug: string;
  bodyJson: unknown;
  status: PostStatus;
  updatedAt: string;
  version: number;
  /** Present only when set, like on the record — see {@link scheduleView}. */
  publishAt?: string;
  featuredMediaId?: string;
  /** Present (always `true`) only while a published row waits for `publishAt`. */
  scheduled?: true;
}

/**
 * The schedule/featured-image keys of the tool view. Each is present only when set, so a row with
 * neither keeps the exact view shape it had before these fields existed. `scheduled` is computed
 * against the same wall clock routing's `isPublished` uses for `publicUrl`, so the model is told
 * the two facts together: `publicUrl` is null BECAUSE the post is waiting for `publishAt`.
 *
 * @complexity O(1).
 */
export function scheduleView({ post }: { post: PostRecord }, _optional = {}): Pick<PostToolView, "publishAt" | "featuredMediaId" | "scheduled"> {
  return {
    ...(post.publishAt ? { publishAt: post.publishAt } : {}),
    ...(post.featuredMediaId ? { featuredMediaId: post.featuredMediaId } : {}),
    ...(isScheduledAt({ record: post, nowIso: currentIso() }) ? { scheduled: true as const } : {}),
  };
}

/** Projects a `PostRecord` into the explicit model-facing shape — `workspaceId` is dropped (the
 * agent is already scoped to one workspace it did not choose and cannot change), and the internal
 * `seoExtJson` sidecar (owned exclusively by `packages/cms/src/seo/write-service.ts`'s chokepoint, per `post.ts`'s
 * own field doc) is dropped too, mirroring `toHeadlessPost`'s own admin-facing projection. */
export function toPostToolView({ post }: { post: PostRecord }, _optional = {}): PostToolView {
  return {
    id: post.id,
    kind: post.kind,
    title: post.title,
    slug: post.slug,
    bodyJson: post.bodyJson,
    status: post.status,
    updatedAt: post.updatedAt,
    version: post.version,
    author: post.author ?? null,
    showAuthor: post.showAuthor ?? false,
    ...(post.templateChoice !== undefined ? { template: post.templateChoice } : {}),
    ...scheduleView({ post }),
  };
}

/** {@link PostToolView} plus the resolved public path and the in-admin edit path — see the host's
 *  tool-policy header ("`publicUrl`") for why these are a separate type rather than fields added to the base
 *  shape, and {@link resolveAdminUrl}'s own doc for `adminUrl`. */
export interface PostToolViewWithPublicUrl extends PostToolView {
  publicUrl: string | null;
  adminUrl: string;
}

/**
 * Resolves the root-relative public path for `post` through routing's
 * {@link PostToolViewDeps.entryPublicPath} — the same pure per-record half `urlFor`'s `resolveEntryRefTarget` calls
 * internally, so this stays the single inverse resolver this codebase treats as the source of truth
 * for where a post/page actually lives. Deliberately not composed by hand
 * as `/${post.slug}` here: that string is only correct for a published row, and re-deriving the
 * publish check next to the real one in `routing.ts` is exactly the kind of drift this exists to
 * remove. Takes the `PostRecord` the caller already holds rather than an id — unlike `urlFor`, this
 * makes no `postRepo.findById` call of its own (H3: the caller, e.g. the post-list tool iterating
 * `postRepo.list()`'s own result, already has the row; a second fetch per row would be exactly the
 * N+1 this signature exists to avoid).
 *
 * @returns `null` for a draft, unpublished, or otherwise unresolvable row — never a link a visitor
 * would 404 on.
 * @complexity O(1).
 */
export function resolvePublicUrl({ deps, post }: { deps: PostToolViewDeps; post: PostRecord }, _optional = {}): string | null {
  const resolved = deps.entryPublicPath({ post: post, ctx: { workspaceId: deps.workspaceId } });
  return resolved?.canonicalUrl ?? null;
}

/**
 * Resolves the in-admin EDIT path for `post` — "where do I go to change this", as opposed to
 * {@link resolvePublicUrl}'s "where does a visitor see this". Added 2026-09-07 for the identical
 * reason `publicUrl` was added on 2026-08-30: the assistant had no tool that told it where a
 * post/page it just read or created is actually reachable, this time in the admin UI rather than
 * on the live site — the fallback was an admin-screen-link tool, which needs the caller to
 * already know the right path shape.
 *
 * Re-implemented here rather than imported, mirroring the SAME cross-app boundary the admin app's
 * own pages rules (`pagePublicPath`) already cross in the opposite direction: the admin is a
 * separately deployed SPA package with no dependency on the server source, and this server has none
 * on the admin app either.
 *
 * Two real routes, both confirmed against the admin app's own routes:
 * - `kind: "post"` -> `/admin/posts/{id}` — ALWAYS by id. The admin posts rules'
 *   own `buildPostAutosaveDraft` doc: "`PostEditor` is reached only via `/admin/posts/{id}`" (no
 *   slug-based route exists for a Post).
 * - `kind: "page"` -> `/admin/pages/{handle}`, mirroring the admin pages rules'
 *   `pageAdminPath` exactly: prefers `slug`, using `home` for the literal root slug `ROOT_SLUG`/`"/"`
 *   because `/` cannot be one path segment. The alias wins, so a real page with slug `home` uses
 *   its id to keep both pages accessible without reserving a public slug.
 * Both prefixed with `/admin`, `@jini-ai/admin/core`'s own `DEFAULT_ADMIN_BASE` — the real,
 * browser-visible admin URL, not the SPA-router-relative path `pageAdminPath` itself returns before
 * `adminHref()` prefixes it.
 *
 * @complexity O(1).
 */
export function resolveAdminUrl({ post }: { post: PostRecord }, _optional = {}): string {
  if (post.kind === "post") return `/admin/posts/${post.id}`;
  if (post.slug === ROOT_SLUG) return "/admin/pages/home";
  const handle = post.slug === "home" ? post.id : post.slug;
  return `/admin/pages/${handle}`;
}

/**
 * {@link toPostToolView} plus {@link resolvePublicUrl}/{@link resolveAdminUrl} — the shape the
 * post get/list/create tools return to the model (see {@link resolveAdminUrl}'s own doc). Also used
 * by the host's duplicate tool (`"post"`/`"page"` resource handlers) to shape its own response identically.
 */
export function toPostToolViewWithPublicUrl({ deps, post }: { deps: PostToolViewDeps; post: PostRecord }, _optional = {}): PostToolViewWithPublicUrl {
  return { ...toPostToolView({ post }), publicUrl: resolvePublicUrl({ deps, post }), adminUrl: resolveAdminUrl({ post }) };
}

/**
 * Where a published write landed. Demo dry run 2026-10-05: a page created `status: "published"` on
 * the local site was reported as "Your page is live" — `status` + `publicUrl` alone read as the live
 * site, and nothing in the result said otherwise. Only the write results (create/update/duplicate)
 * carry it; reads and listings stay as they were.
 *
 * @complexity O(1).
 */
function publishedWhereView(deps: PostToolViewDeps, post: PostRecord): { publishedWhere?: string } {
  if (post.status !== "published") return {};
  const mode = deps.runtimeMode();
  return { publishedWhere: mode === "production" ? deps.publishedWhere.live : deps.publishedWhere.local };
}

/** {@link toPostToolViewWithPublicUrl} plus {@link publishedWhereView} — the create/update/duplicate result shape. */
export function toPostWriteResultView(
  { deps, post }: { deps: PostToolViewDeps; post: PostRecord },
  _optional = {}
): PostToolViewWithPublicUrl & { publishedWhere?: string } {
  return { ...toPostToolViewWithPublicUrl({ deps, post }), ...publishedWhereView(deps, post) };
}
