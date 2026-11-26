import type { JsonObject } from "@jini-ai/core/primitives";
import type { PublicPostRecord as PostRecord } from "../../../../posts/post.js";
import type { RenderSiteRequired } from "../../../http/site/render-site.js";
import type { ResolveHtmlPageEmbedsResult } from "../../../../widgets/html/resolve-html-page-embeds.js";
import type { FeaturedImageView } from "../../../http/site/render/template-render-data.js";
import type { StaticMenuContent } from "./render-context/static-menus.js";
import type { finishStaticTierDocument } from "./static-tier.js";
import { injectExtraHeadIntoStaticPage } from "../../../../presentation/html.js";

type TemplateRenderDeps = {
  resolveTemplate(required: { templateChoice: PostRecord["templateChoice"] }): { kind: "diagnostic" } | { kind: "template"; pageId: string; html: string };
  renderMissingTemplatePage(required: { staticMenus: Readonly<Record<string, StaticMenuContent>> | undefined }): Promise<string>;
  expandPartials(required: { html: string }): string;
  injectPageTitle(required: { html: string; title: string }): string;
  injectCurrentEntityContentId(required: { html: string; entityId: string }): string;
  renderAssignedTermsBlock(required: { post: PostRecord }): Promise<string>;
  placeAfterCurrentContent(required: { html: string; post: PostRecord; block: string }): string;
  resolveHtmlFormatContentMarkers(required: { html: string }, optional: { pendingHtmlOverride: { id: string; slug: string; bodyHtml: string } | undefined }): Promise<string>;
  resolveHtmlPageEmbeds(required: { html: string; pendingContentOverride(): { pendingContentOverride?: { id: string; title: string; slug: string; updatedAt: string; publishAt: string | null; bodyJson: JsonObject } } }): Promise<ResolveHtmlPageEmbedsResult>;
  renderHtmlPageBody(required: { html: string; resolved: ResolveHtmlPageEmbedsResult }, optional: { postAuthor: PostRecord; postPresentation: PostRecord }): string;
  finishStaticTierDocument(required: { input: Parameters<typeof finishStaticTierDocument>[0]["input"] }, optional: Record<string, never>): Promise<string>;
  postPublicPath(required: { slug: string }): string;
  resolveFeaturedImageForRender(required: { post: PostRecord }): Promise<FeaturedImageView | null>;
  injectSiteAssistantIntoStaticPage(required: { html: string; enabled: RenderSiteRequired["siteAssistantEnabled"] }): string;
  renderCommentsMarkers(required: { html: string; entry(): Pick<PostRecord, "id" | "slug" | "title" | "status"> & { canonicalUrl: string } }): Promise<string>;
};

/**
 * Template-picker feature (2026-08-10, unified 2026-08-11) — renders `post` (a Post OR a Page, either
 * `"doc"`- or `"html"`-format) through its chosen static-theme template (`theme.json`'s `templates`
 * array), or the explicit diagnostic page above when unresolvable. Only called when the active theme
 * is `static` tier AND declares a non-empty `templates` array AND `isEligibleForTemplateBranch` (`features/theme/static-render.ts`)
 * returned `true` for this row (checked by the caller) — a theme that doesn't declare `templates`
 * simply doesn't support the feature yet, which is a theme-capability gap, not a per-row
 * misconfiguration, so those themes fall through to the pre-existing generic rendering unchanged.
 *
 * Replaces the separate `renderPostViaTemplate`/`renderPageViaTemplate` — collapsible now that both
 * resolve against the SAME `templates` array and the SAME `"content"` marker, and both need the exact
 * same sequence: resolve which template, fill in the current entity's id, resolve any nested
 * `"html"`-format content, then resolve everything else. Which template (or the diagnostic page) a
 * row resolves to is decided by the pure {@link resolveTemplate} — including the `templateChoice`
 * tri-state, whose `null` vs `""` distinction that function's own doc explains in full. This function
 * owns only the embed-resolution I/O that follows.
 *
 * `injectPageTitle` now runs for BOTH kinds (previously Page-only): a template carrying the
 * `{{title}}` placeholder (`pages-default.html`, `page-shell.html` before the 2026-09-03
 * posts-* / pages-* rename) gets the row's real title regardless of whether a Post or a Page rendered
 * through it; a template with no such placeholder (`posts-default.html`, formerly `blog-post.html`, a
 * disclosed, unchanged limitation — see that function's own doc) is simply unaffected, the same
 * no-op-when-absent contract it already had.
 *
 * Exported (2026-08-11 template-preview fix) for `apps/website/src/server/inbound/admin-http/routes/posts/template-preview.ts`, the
 * admin-only "preview this row through a PENDING, not-yet-saved template choice" endpoint —
 * `resolveTemplate` reads `post.templateChoice` alone, so that caller passes a shallow clone of the
 * real record with only `templateChoice` overridden, never persisting the override. Reusing this
 * function directly (rather than a second implementation) is the same "one render pipeline, zero
 * drift" reasoning the file header above gives for the live-site iframe branch in both editors.
 *
 * `pendingBodyJson` (2026-08-12, same fix's `bodyJson` half) — an optional, explicitly-passed
 * override for `post`'s OWN body, threaded into `resolveHtmlPageEmbeds` as a
 * {@link ResolveHtmlPageEmbedsDeps.pendingContentOverride} keyed to `post.id`. Without this, the
 * current entity's own `{"type":"content"}` slot (`injectCurrentEntityContentId`, immediately below)
 * re-fetches `post.id` from `postRepo` regardless of what `post.bodyJson` the caller passed in here —
 * `post`'s OTHER fields (title via `injectPageTitle` two lines below, `templateChoice` via
 * `resolveTemplate` above) already flow through because this function reads them directly, but the
 * BODY only ever reaches the page through that separate marker-resolution round trip. `undefined`
 * (every pre-existing call site) is byte-identical to before this parameter existed — see the
 * override field's own doc for why this is scoped to one id and never ambient state.
 *
 * `pendingBodyHtml` (2026-09-09, `bodyHtml` half of the same pending-body fix) — the equivalent
 * override for an `"html"`-format `post` (a Page written through the Pages admin editor, `bodyHtml`
 * not `bodyJson`). `pendingBodyJson`/`pendingContentOverride` cannot cover this case: an `"html"`-
 * format entity's own `{"type":"content"}` slot is resolved by {@link resolveHtmlFormatContentMarkers}
 * below, which runs strictly BEFORE `resolveHtmlPageEmbeds` and splices raw HTML directly rather than
 * through the `"post-content"` IR component `pendingContentOverride` feeds. So this is threaded into
 * THAT function's own `pendingHtmlOverride` parameter instead, keyed to `post.id` the same way — see
 * that function's own doc for the full reasoning, including why it can never leak past that one id.
 * `undefined` (every pre-existing call site) is byte-identical to before this parameter existed.
 *
 * `extraHead` (2026-08-19, SPEC-008 T045 gap fix part 3) — this function's own `renderStaticPage`
 * call bypasses `renderSite`/`pageShell` exactly like the marketing-page branch and static-tier home
 * do, so it had the identical SEO-fold drop; spliced in via
 * {@link injectExtraHeadIntoStaticPage} on the resolved-template return only. Deliberately NOT
 * applied to the `"diagnostic"` ("template not configured") return above: that page is an
 * operator-facing error state, not real indexable content — carrying the real entry's canonical/OG
 * tags on it would tell a crawler the broken diagnostic page IS the entry, worse than the drop this
 * fixes. Same reasoning `registerSiteRoutes`'s themed-404 branch is left out for (see that call
 * site's own comment). Optional and omitted by both existing callers that don't render the live
 * public page (`apps/website/src/server/inbound/admin-http/routes/posts/template-preview.ts`'s pending-preview endpoint), matching every
 * other optional parameter's "omit = unchanged prior behavior" contract in this file.
 *
 * `siteAssistantEnabled` (ADR-054 gap fix) — this function's own `renderStaticPage` call has the
 * identical `pageShell`-bypassing shape the visitor-chat widget missed the same way `extraHead` did;
 * spliced in via {@link injectSiteAssistantIntoStaticPage} on the resolved-template return only, same
 * "not the diagnostic branch" scoping `extraHead` already follows immediately above. Defaults to
 * `false` so both existing callers (the admin preview endpoint, which must never show the public
 * widget in a preview iframe, and the two direct tests) keep their prior behavior unchanged.
 */
export async function renderTemplateDocument({ deps, post, staticMenus }: { deps: TemplateRenderDeps; post: PostRecord; staticMenus: Readonly<Record<string, StaticMenuContent>> | undefined }, { pendingBodyJson, pendingBodyHtml, extraHead, siteAssistantEnabled = false, postPreviewsAccess }: { pendingBodyJson?: JsonObject | undefined; pendingBodyHtml?: string | undefined; extraHead?: string | undefined; siteAssistantEnabled?: RenderSiteRequired["siteAssistantEnabled"]; postPreviewsAccess?: object | undefined } = {}): Promise<string> {
  const resolution = deps.resolveTemplate({ templateChoice: post.templateChoice });
  if (resolution.kind === "diagnostic") {
    return deps.renderMissingTemplatePage({ staticMenus });
  }
  const { pageId, html: rawTemplate } = resolution;

  // Expand before content resolution so a partial's own byline suppresses the core header too.
  const withTitle = deps.injectPageTitle({ html: deps.expandPartials({ html: rawTemplate }), title: post.title });
  const withCurrentId = deps.injectCurrentEntityContentId({ html: withTitle, entityId: post.id });
  // Taxonomy render-surface gap fix (2026-09-02): assigned terms are metadata ABOUT the entry, not
  // part of its authored body, so they go in the conventional "filed under" position: right after
  // the entry's own content element, inside the template's `<article>`. Placed BEFORE the content
  // resolves, while the marker can still be found. They used to be appended to the fully resolved
  // template, which put them after `</html>`, under the footer (owner report, plannie, 2026-10-11).
  const withTerms = deps.placeAfterCurrentContent({
    html: withCurrentId,
    post,
    block: await deps.renderAssignedTermsBlock({ post }),
  });
  const withNestedContent = await deps.resolveHtmlFormatContentMarkers({ html: withTerms }, { pendingHtmlOverride: pendingBodyHtml !== undefined ? { id: post.id, slug: post.slug, bodyHtml: pendingBodyHtml } : undefined });
  const resolved = await deps.resolveHtmlPageEmbeds({
    pendingContentOverride: () => (pendingBodyJson !== undefined
        ? { pendingContentOverride: { id: post.id, title: post.title, slug: post.slug, updatedAt: post.updatedAt, publishAt: post.publishAt ?? null, bodyJson: pendingBodyJson } }
        : {}),
    html: withNestedContent,
  });
  const bodyWithTerms = deps.renderHtmlPageBody({ html: withNestedContent, resolved }, { postAuthor: post, postPresentation: post });
  // D2's single static-tier pipeline (E3, 2026-09-23) — `finishStaticTierDocument` runs the SAME
  // expand-partials / resolve-embeds / resolve-post-previews / render sequence every other
  // static-tier surface now runs. Called on `bodyWithTerms`, not the raw, unassembled template: the
  // body stage above already ran, so widget/media/post/content markers are already consumed (this
  // second pass is a no-op for them) and it now ALSO picks up any marker that came from a partial
  // (invisible before `expandPartials` ran) or was authored directly in `post`'s own `body_html`
  // (the fixed live bug — `post-previews`/`menu` used to be scanned off `rawTemplate` alone, which
  // could never see either).
  const rendered = await deps.finishStaticTierDocument({ input: {
    pageId,
    html: bodyWithTerms,
    currentPath: deps.postPublicPath({ slug: post.slug }),
    staticMenus,
    postPreviewsAccess,
    // Featured image (2026-10-05): the static tier's counterpart of the templated tiers'
    // `post.featuredImage` — resolved through the SAME metadata/transform lookups and the SAME
    // `featuredImageView`, so both tiers show the identical URL and alt. Before this, the static
    // path never looked the featured asset up at all and it only ever reached `og:image`.
    featuredImage: await deps.resolveFeaturedImageForRender({ post: pendingBodyJson !== undefined ? { ...post, bodyJson: pendingBodyJson } : post }),
    postAuthor: post,
  } }, {});
  return deps.renderCommentsMarkers({ html: deps.injectSiteAssistantIntoStaticPage({ html: injectExtraHeadIntoStaticPage({ html: rendered, extraHead }), enabled: siteAssistantEnabled }),
    entry: () => ({ id: post.id, slug: post.slug, title: post.title, status: post.status, canonicalUrl: deps.postPublicPath({ slug: post.slug }) }),
  });
}
