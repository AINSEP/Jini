import type { PublicPostRecord } from "../../../../../posts/post.js";
import type { RenderSiteRequired } from "../../../../http/site/render-site.js";
import { preparePageRouteContext, resolvePageRouteTheme } from "../page-route-context.js";
import { checkSiteRelativeTarget } from '../../../../../routing/site/reserved-paths.js';

/** Nested public paths: redirect rules, then the normal 404. */
export async function nestedPageRoute({ path, tryRedirectPhase }: {
  path: string;
  tryRedirectPhase: (required: { phase: 'pre_content' | 'post_content'; path: string }) => Promise<boolean>;
}, _optional = {}): Promise<{ kind: 'next' } | { kind: 'handled' }> {
  if (checkSiteRelativeTarget({ raw: path }).kind !== 'ok') return { kind: 'next' };
  if (await tryRedirectPhase({ phase: 'pre_content', path })) return { kind: 'handled' };
  if (await tryRedirectPhase({ phase: 'post_content', path })) return { kind: 'handled' };
  return { kind: 'next' };
}

export async function serveNestedPage(required: Parameters<typeof nestedPageRoute>[0] & {
  next: (error?: unknown) => void;
}, _optional = {}): Promise<void> {
  try {
    const reply = await nestedPageRoute(required);
    if (reply.kind === 'handled') return undefined;
    required.next();
  } catch (err) { required.next(err); }
  return undefined;
}

// Same ADR-030 §4 listing filter the `GET /` handler applies — this list feeds the generic
// post page's "more dispatches"/related regions, which print titles and links exactly like
// the home grid does.

// Same `=== null` vs. sentinel split as the `GET /` handler above — see its comment.

// Resolved once per request (not just for the marketing-page branch below) — the requested
// path is the correct `currentPath` for `isCurrent` regardless of whether this request ends up
// rendering a marketing page, a post-template page, or the themed 404 below; all three share
// this one resolve rather than re-querying the same two locations per branch.

// Post/Redirect/Get result for a form widget on THIS route (2026-08-31 fix, generalized the
// same day) — resolved once and applied uniformly across all three branches below, the same
// "compute once, thread to every branch" shape `siteAssistantEnabled` already uses on this
// handler (ADR-054). A request with none of the `form_*` params (the ordinary case) decodes to
// `undefined`, and `injectFormSubmissionResultIntoHtml` is a no-op for that. Also reads (and
// clears) the validation flash cookie, if any, and decides this response's `Cache-Control` —
// including the member-session arm, which matters here because `visiblePosts` above made this
// body cookie-dependent. See `resolvePerVisitorResponse`'s own doc.
export async function serveSlugPage<TTheme extends object, TMenu, TResolver, TContext, TVisitor>(required: {
  withListingBatch: () => void; resolveRequestedSlug: () => string | undefined; preRedirect: () => Promise<boolean>;
  context: Parameters<typeof preparePageRouteContext<TResolver, TContext>>[0]["ports"];
  noThemeId: string; resolveActiveTheme: (required: { activeThemeId: string }) => TTheme | string | null; sendNoThemesInstalled: () => void;
  currentPath: string; resolveStaticMenusForRender: (required: { theme: TTheme | null; currentPath: string }) => Promise<Readonly<Record<string, TMenu>>>;
  resolvePerVisitorResponse: () => TVisitor;
  resolveMarketingPageOrOverride: (required: { theme: TTheme | null; slug: string; staticMenus: Readonly<Record<string, TMenu>>; siteAssistantEnabled: NonNullable<RenderSiteRequired['siteAssistantEnabled']> }, optional: { postPreviewsAccess: { resolver: TResolver; context: TContext } }) => Promise<{ kind: 'responded'; html: string } | { kind: 'overridingPost'; post: PublicPostRecord } | { kind: 'fallthrough' }>;
  resolvePostAfterMarketingCheck: (required: { slug: string; marketingResolution: { kind: 'overridingPost'; post: PublicPostRecord } | { kind: 'fallthrough' } }) => Promise<PublicPostRecord>;
  decidePostMemberAccess: (required: { resolver: TResolver; post: PublicPostRecord; context: TContext }) => { allowed: boolean };
  handlePostNotFoundOnSlugRoute: (required: { theme: TTheme | null; staticMenus: Readonly<Record<string, TMenu>> }) => Promise<void>;
  renderTemplateBranchIfEligible: (required: { theme: TTheme | null; post: PublicPostRecord; staticMenus: Readonly<Record<string, TMenu>>; siteAssistantEnabled: NonNullable<RenderSiteRequired['siteAssistantEnabled']> }, optional: { postPreviewsAccess: { resolver: TResolver; context: TContext } }) => Promise<string | undefined>;
  renderGenericPostPage: (required: { theme: TTheme | null; post: PublicPostRecord; posts: PublicPostRecord[]; siteAssistantEnabled: NonNullable<RenderSiteRequired['siteAssistantEnabled']> }) => Promise<string>;
  sendPublicPage: (required: { html: string; perVisitor: TVisitor }) => Promise<void>;
  handleSlugRouteError: (required: { err: unknown; theme: TTheme | null; staticMenus: Readonly<Record<string, TMenu>> | undefined; slug: string }) => Promise<void>;
}, _optional = {}): Promise<void> {
  required.withListingBatch();
  const slug = required.resolveRequestedSlug();
  if (slug === undefined) return;
  let theme: TTheme | null = null;
  let staticMenus: Readonly<Record<string, TMenu>> | undefined;
  try {
    if (await required.preRedirect()) return;
    const context = await preparePageRouteContext({ ports: required.context, home: false });
    const resolved = resolvePageRouteTheme({ resolved: required.resolveActiveTheme({ activeThemeId: context.activeThemeId }), noThemeId: required.noThemeId });
    if (resolved.kind === 'missing') { required.sendNoThemesInstalled(); return; }
    theme = resolved.theme;
    staticMenus = await required.resolveStaticMenusForRender({ theme, currentPath: required.currentPath });
    const perVisitor = required.resolvePerVisitorResponse();
    await renderSlugPage({ ports: required, slug, theme, staticMenus, perVisitor, context });
  } catch (err) { await required.handleSlugRouteError({ err, theme, staticMenus, slug }); }
}

async function renderSlugPage<TTheme extends object, TMenu, TResolver, TContext, TVisitor>(required: {
  ports: Parameters<typeof serveSlugPage<TTheme, TMenu, TResolver, TContext, TVisitor>>[0]; slug: string; theme: TTheme | null; staticMenus: Readonly<Record<string, TMenu>>; perVisitor: TVisitor;
  context: Awaited<ReturnType<typeof preparePageRouteContext<TResolver, TContext>>>;
}, _optional = {}): Promise<void> {
  const { ports, slug, theme, staticMenus, perVisitor, context: { siteAssistantEnabled, memberAccessResolver, memberContext, visiblePosts } } = required;
  const access = { resolver: memberAccessResolver, context: memberContext };
  const marketingResolution = await ports.resolveMarketingPageOrOverride({ theme, slug, staticMenus, siteAssistantEnabled }, { postPreviewsAccess: access });
  if (marketingResolution.kind === 'responded') {
    await ports.sendPublicPage({ html: marketingResolution.html, perVisitor });
    return;
  }
  const post = await ports.resolvePostAfterMarketingCheck({ slug, marketingResolution });
  // ADR-030 §4 — the single-post gate. Kept as the whole `MemberAccessDecision`, not a boolean:
  // `decision.reason` (`sign_in_required` vs `upgrade_required`) and `decision.teaser` are the
  // named seam a future teaser / sign-in-prompt render reads, and collapsing them here would
  // force that follow-up to re-derive the decision a second time. Today every `!allowed` outcome
  // renders one thing — the SAME plain 404 a slug with no post at all gets, produced by the same
  // `handlePostNotFoundOnSlugRoute` rather than a second hand-rolled 404, so a gated post is
  // indistinguishable from a nonexistent one and the response leaks no existence signal.
  //
  // Placed BEFORE `renderTemplateBranchIfEligible` deliberately: that branch is a complete second
  // render path (`renderViaTemplate` -> `renderStaticPage`) that would otherwise serve the gated
  // body straight past a gate that only guarded the generic path below.
  const decision = ports.decidePostMemberAccess({ resolver: memberAccessResolver, post, context: memberContext });
  if (!decision.allowed) { await ports.handlePostNotFoundOnSlugRoute({ theme, staticMenus }); return; }
  const templateHtml = await ports.renderTemplateBranchIfEligible({ theme, post, staticMenus, siteAssistantEnabled }, { postPreviewsAccess: access });
  const html = templateHtml ?? (await ports.renderGenericPostPage({ theme, post, posts: visiblePosts, siteAssistantEnabled }));
  await ports.sendPublicPage({ html, perVisitor });
}
