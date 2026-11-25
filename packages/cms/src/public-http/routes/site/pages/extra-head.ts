import type { VerifiedOrigin } from "@jini-ai/core/contracts/server/verified-origin";
import type { PublicPostRecord } from "../../../../posts/post.js";
import type { PageHeadContext, PageHeadHook } from "../../../../seo/types.js";
import { toAbsoluteUrl } from "../../../../seo/absolute-url.js";
import { foldPageHead, serializeHeadElements } from "../../../../presentation/page-head.js";

/**
 * SPEC-008 T049 — builds the `PageHeadContext` for one render (home/page have
 * no `entry`; the post route's `entry` is a serializable snapshot per
 * `page-head.ts`'s own "by value, not a live PostRecord" contract) and folds
 * every registered `page.head` contributor's output into one escaped string
 * ready for `renderSite`'s `extraHead`. Never throws — `foldPageHead` itself
 * is fail-closed-per-contributor (a broken SEO lookup degrades to no extra
 * head tags, never a 500).
 *
 * `"page"` (2026-08-19, SPEC-008 T045 gap fix part 2) — a static theme's own
 * marketing page (`theme.pages[slug]`) has no backing `PostRecord` at all, so
 * it folds the same entry-less shape `"home"` always has (site-level title +
 * canonical only, per `createSeoPageHeadHook`'s `!ctx.entry` branch — there is
 * no per-page SEO metadata to resolve without an entry, a disclosed limit of
 * today's SEO data model, not something this fix invents). The one thing that
 * DOES differ from `"home"` is the canonical path: `"/"` is only correct for
 * the home route itself, so `canonicalFallbackPath` lets a `"page"` caller
 * supply its own (`/${slug}`) instead of silently reusing home's `"/"`.
 * Ignored whenever `post` is provided (its own resolved/derived slug path
 * always wins), so every pre-existing `"home"`/`"post"` call site is
 * unaffected by this parameter's addition.
 *
 * `canonicalUrl` (2026-09-03, absolute-URL fix) — was a bare path (`/`, `/docs`) on every route,
 * reproduced on both production and local via `curl`. Joined onto the workspace's verified origin
 * via `toAbsoluteUrl`/`resolveWorkspaceOrigin` (`features/seo`'s own seam — see `absolute-url.ts`'s
 * file header for why this lives there and not in `platform/routing`), same fix and same
 * degradation contract (no verified origin yet -> stays relative) as `seo.ts`'s `resolveCanonical`.
 */
export async function buildExtraHead(required: {
  workspaceId: string;
  route: "home" | "post" | "page";
  siteTitle: string;
  post: PublicPostRecord | undefined;
  renderBaseUrl: string | undefined;
  postCanonical: (required: { post: PublicPostRecord }) => Promise<string | undefined>;
  postFallbackPath: (required: { post: PublicPostRecord }) => string;
  resolveOrigin: (required: { workspaceId: string }) => Promise<VerifiedOrigin | undefined>;
  seoContributor: PageHeadHook;
  pageHeadContributors: readonly PageHeadHook[];
}, { canonicalFallbackPath = "/" }: { canonicalFallbackPath?: string } = {}): Promise<string> {
  const { workspaceId, route, siteTitle, post, renderBaseUrl, postCanonical, postFallbackPath, resolveOrigin, seoContributor, pageHeadContributors } = required;
  const canonical = post ? await postCanonical({ post }) : undefined;
  const origin = renderBaseUrl ? undefined : await resolveOrigin({ workspaceId });

  const ctx: PageHeadContext = {
    workspaceId,
    route,
    siteTitle,
    canonicalUrl: toAbsoluteUrl({ origin, baseUrl: renderBaseUrl, path: canonical ?? (post ? postFallbackPath({ post }) : canonicalFallbackPath) }, {}),
    entry: post
      ? {
          id: post.id,
          type: post.kind,
          slug: post.slug,
          title: post.title,
          status: post.status,
          updatedAt: post.updatedAt,
          ext: {},
        }
      : undefined,
  };

  // Contributors close over this render only; another app/export cannot replace their dependencies.
  const elements = await foldPageHead({ context: ctx }, { contributors: [seoContributor, ...pageHeadContributors] });
  return serializeHeadElements({ elements });
}
