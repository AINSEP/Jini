import type { RenderBareEntryDocumentRequired } from "../../../../http/site/bare-page.js";
import type { RenderSiteRequired } from "../../../../http/site/render-site.js";
import type { ResolvePageWidgetsResult } from "../../../../../widgets/page-widget-resolution.js";
import type { ResolveHtmlPageEmbedsResult } from "../../../../../widgets/html/resolve-html-page-embeds.js";
import type { MediaAssetRenderMeta } from "@jini-ai/core/contracts/site/cms-media";
import type { AssignedTermView } from "../../../../../taxonomy/read-ports.js";
import type { PublicPostRecord as PostRecord } from '../../../../../posts/post.js';

export function withPageShellChoice({ post, branch }: {
  post: PostRecord; branch: { kind: 'ineligible' | 'as-chosen' } | { kind: 'page-shell'; templateChoice: string };
}, _optional = {}): PostRecord {
  return branch.kind === 'page-shell' ? { ...post, templateChoice: branch.templateChoice } : post;
}

/**
 * Template-picker feature (2026-08-10, unified 2026-08-11) — a `bodyFormat: "doc"` post
 * ("formulaic" content, the owner's own term) or an `"html"`-format Page with an explicit
 * choice renders through its chosen theme template instead of the generic rendering path,
 * whenever the active theme actually supports templates. Returns the rendered HTML, or
 * `undefined` when `post` isn't eligible — the caller falls through to the generic dynamic
 * post render in that case.
 *
 * `kind: "page"` rows DO also flow through this branch, but only on an explicit
 * `templateChoice` (see `isEligibleForTemplateBranch`'s doc) — NOT on the "never chosen, fall
 * back to the theme's first template" arm that Posts rely on. That arm is safe for Posts (an
 * author genuinely had no opinion) but was firing for legacy Pages that never had any admin
 * surface to set `template_choice` at all, which is how `terms-of-service` et al. were
 * rendering under the theme's first template (`<title>Blog post — Basic</title>`) on the live
 * site — fixed by gating on `kind`, not just `bodyFormat`.
 *
 * `pageShellFallback` (2026-09-02) — when `post` is ineligible for the branch above (the common
 * case: no admin surface sets `templateChoice` on create), an `html`-format `kind: "page"` row on a
 * `static`-tier theme gets ONE more chance before falling through to the caller's generic path: the
 * theme's own canonical page-shell document shell (`pages-default.html`, or legacy `page-shell.html`
 * — see `resolveStaticTierPageShellFallback`'s own doc), via that same function.
 * This is NOT a second "which content template" guess — `isEligibleForTemplateBranch`'s own
 * `kind: "page"` gate is completely untouched, so a `doc`-format Page or a Post with no opinion never
 * reaches this arm, and the `terms-of-service`-shaped regression that gate exists to prevent cannot
 * reopen through it. It exists because the generic (non-template) path this row would otherwise fall
 * to renders through the host's own `pageShell()` — correct for the other three tiers, which have no
 * standalone documents of their own, but not for `static` tier, whose real pages are complete
 * documents `pageShell()` cannot reproduce (see that function's own doc for the full live-bug trace).
 * `renderViaTemplate` is called with a shallow clone carrying the resolved filename ONLY for this
 * render — nothing is written back to `post.templateChoice`, so the row stays `null`/`undefined` and
 * a later explicit choice (or a theme switch) is free to override this every time.
 *
 * **Bare page** (owner ruling 2026-09-23, plan §2 P1-P6) — checked FIRST, before the `theme === null`
 * early return below: a `kind: "page"` row with `templateChoice === ""` ({@link isBarePageChoice})
 * renders NONE of a theme's chrome, so it doesn't matter whether a theme is even active. Routing it
 * through {@link renderBarePage} here — rather than adding a THIRD "is this bare" check at every one
 * of this function's five call sites (`GET /`, `GET /:slug`, the marketing-override branch, the
 * member-gated path, and the admin preview route, S5) — means the member-access gate at each call
 * site (checked strictly BEFORE this function runs) still applies unchanged: a bare Page is gated
 * exactly like every other Page, never bypassed.
 */
export async function renderTemplateBranchIfEligible({ post, theme, isBarePageChoice, renderBarePostPage, resolveTemplateBranchChoice, buildExtraHead, renderViaTemplate }: {
  post: PostRecord;
  theme: object | null;
  isBarePageChoice: (post: PostRecord) => boolean;
  renderBarePostPage: (required: { post: PostRecord }) => Promise<string>;
  resolveTemplateBranchChoice: (required: { post: PostRecord }) => { kind: 'ineligible' | 'as-chosen' } | { kind: 'page-shell'; templateChoice: string };
  buildExtraHead: (required: { post: PostRecord }) => Promise<string>;
  renderViaTemplate: (required: { post: PostRecord }, optional: { pendingBodyJson: undefined; pendingBodyHtml: undefined; extraHead: string }) => Promise<string>;
}, _optional = {}): Promise<string | undefined> {
  // Checked before the theme-off early return below: a bare Page renders identically with or
  // without an active theme, so this must not be gated on one being present. See this function's
  // own doc, "Bare page" paragraph.
  if (isBarePageChoice(post)) return renderBarePostPage({ post });

  // The template branch renders a THEME's template file, so with no theme it cannot run and the
  // caller falls through to the generic render. `post.templateChoice` is IGNORED here, never
  // cleared — which is what makes "turn the theme off, then back on" fully reversible rather than
  // approximately so: the stored choice takes effect again the moment a theme is reactivated.
  if (theme === null) return undefined;

  // One shared decision, never the two underlying functions in sequence — see
  // `resolveTemplateBranchChoice`'s own doc (`features/theme/static-render.ts`) for the 2026-09-16
  // preview divergence that extraction closed. Behavior here is unchanged by it.
  const branch = resolveTemplateBranchChoice({ post });
  if (branch.kind === "ineligible") return undefined;

  // SPEC-008 T045 gap fix, part 3 (2026-08-19) — `renderViaTemplate` has the same
  // pageShell-bypassing `renderStaticPage` shape as the marketing-page branch above; unlike
  // that branch this one DOES have a real backing `post`, so it folds through the same
  // entry-bearing `"post"` shape the generic (non-template) render below already uses. Same ADR-054
  // gap `resolveMarketingPageOrOverride` above threads through, for the same reason.
  const extraHead = await buildExtraHead({ post });
  const renderedPost = withPageShellChoice({ post, branch });
  return renderViaTemplate({ post: renderedPost }, { pendingBodyJson: undefined, pendingBodyHtml: undefined, extraHead });
}

/**
 * Bare-page render (owner ruling 2026-09-23, `no-template-bare-plan-2026-09-23.md` S4) — resolves
 * every input `renderBareEntryDocument` (`http/site/bare-page.ts`) needs and calls it. Mirrors
 * {@link renderGenericPostPage}'s own "route resolves I/O, render.ts/bare-page.ts stays pure" split,
 * with two deliberate differences: `resolveWidgetsForRender` is called with `theme: null` (a bare
 * Page gets no theme-declared REGION widgets — only inline `widgetEmbed` nodes in its own body,
 * which resolve from `pageBodyJson` regardless of the theme argument), and `assignedTerms`/`posts`
 * are never resolved at all, since {@link renderBareEntryDocument} never appends a terms block or
 * reads the sibling-posts list (plan §3, point 2).
 *
 * `extraHead` is built via `buildExtraHead(deps, "post", ...)` — the SAME SEO/og fold every other
 * post/page route gets. This is the ONE thing this function adds beyond the Page's own HTML; see
 * `bare-page.ts`'s own file header for why that's not a contradiction of "no theme chrome".
 */
export async function renderBarePostPage({ deps, post }: { deps: {
  resolveSiteTitleForRender(): Promise<string>;
  resolveWidgetsForRender(required: { theme: null }, optional: { post: PostRecord }): Promise<ResolvePageWidgetsResult>;
  resolveHtmlEmbedsForRender(required: { post: PostRecord }): Promise<ResolveHtmlPageEmbedsResult | undefined>;
  resolveMediaTransformVersionsForRender(): Promise<ReadonlyMap<string, number>>;
  resolveMediaAssetMetadataForRender(required: { post: PostRecord }): Promise<ReadonlyMap<string, MediaAssetRenderMeta>>;
  buildExtraHead(required: { route: "post"; siteTitle: string; post: PostRecord }): Promise<string>;
  documentAssets: RenderSiteRequired["renderAssets"];
  renderBareEntryDocument(required: Omit<RenderBareEntryDocumentRequired, "documentAssets"> & { documentAssets: RenderBareEntryDocumentRequired["documentAssets"] }): string;
}; post: PostRecord }, _optional = {}): Promise<string> {
  const siteTitle = await deps.resolveSiteTitleForRender();
  const [widgets, pageHtmlEmbeds, mediaTransformVersions, mediaAssetMetadata, extraHead] = await Promise.all([
    deps.resolveWidgetsForRender({ theme: null }, { post }),
    deps.resolveHtmlEmbedsForRender({ post }),
    deps.resolveMediaTransformVersionsForRender(),
    deps.resolveMediaAssetMetadataForRender({ post }),
    deps.buildExtraHead({ route: "post", siteTitle, post }),
  ]);
  return deps.renderBareEntryDocument({
    documentAssets: await deps.documentAssets?.({ scripts: [] }),
    post,
    siteTitle,
    extraHead,
    pageHtmlEmbeds,
    widgetInlineResolved: widgets.inlineResolved,
    mediaTransformVersions,
    mediaAssetMetadata,
  });
}

/** The generic (non-template) dynamic post render: resolves every widget/embed/media input
 *  `renderSite`'s `"post"` route needs and renders through it. This is the fallback path for any
 *  post that isn't eligible for {@link renderTemplateBranchIfEligible}'s template branch. */
export async function renderGenericPostPage({ deps, post, posts, siteAssistantEnabled }: { deps: {
  resolveSiteTitleForRender(): Promise<string>;
  resolveWidgetsForRender(required: { post: PostRecord }): Promise<ResolvePageWidgetsResult>;
  resolveHtmlEmbedsForRender(required: { post: PostRecord }): Promise<ResolveHtmlPageEmbedsResult | undefined>;
  resolveMediaTransformVersionsForRender(): Promise<ReadonlyMap<string, number>>;
  resolveMediaAssetMetadataForRender(required: { post: PostRecord }, optional: { listed: readonly PostRecord[] }): Promise<ReadonlyMap<string, MediaAssetRenderMeta>>;
  buildExtraHead(required: { route: "post"; siteTitle: string; post: PostRecord }): Promise<string>;
  resolveAssignedTermsForRender(required: { post: PostRecord }): Promise<readonly AssignedTermView[]>;
  resolveSiteTimeZoneForRender(): Promise<string>;
  documentAssets: RenderSiteRequired["renderAssets"];
  renderCommentsMarkers(required: { html: string }): Promise<string>;
  renderSite(required: Pick<RenderSiteRequired, "transformBody" | "route" | "siteTitle" | "timeZone" | "posts" | "post" | "widgets" | "pageHtmlEmbeds" | "mediaTransformVersions" | "mediaAssetMetadata" | "assignedTerms" | "extraHead"> & { renderAssets: RenderSiteRequired["renderAssets"]; siteAssistantEnabled: RenderSiteRequired["siteAssistantEnabled"] }): Promise<string>;
}; post: PostRecord; posts: PostRecord[]; siteAssistantEnabled: RenderSiteRequired["siteAssistantEnabled"] }, _optional = {}): Promise<string> {
  const siteTitle = await deps.resolveSiteTitleForRender();
  const [widgets, pageHtmlEmbeds, mediaTransformVersions, mediaAssetMetadata, extraHead, assignedTerms] = await Promise.all([
    deps.resolveWidgetsForRender({ post }),
    deps.resolveHtmlEmbedsForRender({ post }),
    deps.resolveMediaTransformVersionsForRender(),
    deps.resolveMediaAssetMetadataForRender({ post }, { listed: posts }),
    deps.buildExtraHead({ route: "post", siteTitle, post }),
    // Taxonomy render-surface gap fix (2026-09-03) — this is the generic (non-template) render path;
    // `renderTemplateBranchIfEligible`/`renderViaTemplate` above already resolves this same input for
    // the static-tier template branch. See `SiteRenderContext.assignedTerms`'s own doc for where this
    // lands (`render.ts`'s `renderPostBody`, shared by the declarative/templated/handlebars tiers).
    deps.resolveAssignedTermsForRender({ post }),
  ]);
  return deps.renderSite({
    renderAssets: deps.documentAssets,
    transformBody: ({ html }) => deps.renderCommentsMarkers({ html }),
    route: "post",
    siteTitle,
    timeZone: await deps.resolveSiteTimeZoneForRender(),
    posts,
    post,
    widgets,
    pageHtmlEmbeds,
    mediaTransformVersions,
    mediaAssetMetadata,
    assignedTerms,
    extraHead,
    siteAssistantEnabled,
  });
}
