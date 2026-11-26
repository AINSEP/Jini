import { PostNotFoundError, type PublicPostRecord } from '../../../../../posts/post.js';
import { comparePostsByDisplayDate } from '@jini-ai/core/scheduled-publish';
import type { RenderSiteRequired } from '../../../../http/site/render-site.js';
import { ListingBatchNotFoundError } from '../../../../../listing/request-state.js';
import { hasStaticThemeIndex } from '../static-tier.js';
import { preparePageRouteContext, resolvePageRouteTheme } from '../page-route-context.js';

/**
 * Content-owned homepage (SPEC-0XX) — looks up the published row currently claiming the reserved
 * `"/"` slug (`post.ts`'s `ROOT_SLUG`), the mechanism that lets `GET /` render a real, authored Page
 * instead of always falling back to the active theme's own `index.html`. Only a `kind: "page"` row
 * can ever be saved at this slug (`resolveExplicitSlug`/`validateUpdatePostInput`'s kind gate, both
 * `post.ts`), so no `kind` check is needed here — whatever this finds is one by construction.
 *
 * Mirrors {@link resolveMarketingPageOrOverride}'s own "look up by slug, swallow `PostNotFoundError`
 * locally" shape immediately above — "no page claims `/`" is the overwhelmingly common case and must
 * not reach the route's outer catch.
 *
 * A row the current visitor's member access denies is treated identically to "no page claims `/`"
 * (returns `undefined`), matching `/:slug`'s own "gated == not-found" contract
 * ({@link decidePostMemberAccess}'s call site in `registerSiteRoutes` below): the homepage falls back
 * to the themed default rather than confirming a gated page's existence to an unauthorized visitor.
 *
 * @complexity O(1) plus the one `findBySlug` lookup's own cost.
 */

// ADR-054 — the visitor-chat master switch. `render.ts` never reads settings itself; every
// route that calls `renderSite` resolves this the same way, through the shared
// `resolveSiteAssistantWidgetForRequest` (see `pages.ts`'s other handler and
// `products.ts`'s two handlers), which also carves out static exports (see that
// function's own doc).

// ADR-030 §4 — the home listing is gated too, not just each post's own page. See
// `filterVisiblePosts`'s own doc for why filtering only `/:slug` would be protection that
// looks real and isn't.
// Newest display date first, the order every post listing uses (it was insertion order).

// `NO_THEME_ID` -> `null`, which every render helper below reads as "render unstyled". The
// guard above must stay `=== null`, not `!theme`: `null` means nothing is INSTALLED (a broken
// site, hence the 500), while the sentinel means the operator turned styling off on purpose
// and is owed a real page. Collapsing the two would send state 3 into the 500.

// Content-owned homepage (SPEC-0XX) — a Page claiming "/" wins over the theme's own
// index.html; renders through the SAME template-resolution path GET /:slug already uses for
// a Page below. Falls through to exactly the pre-existing code that follows, byte-identical,
// when no page claims it (or the current visitor's member access denies the one that does) —
// see `resolveHomePageContent`'s own doc.

// E4 (D2, 2026-09-23) — a static theme's own `index.html` goes through the SAME
// `finishStaticTierDocument` pipeline every other static-tier surface uses (E3), instead of
// `renderSite`'s `renderStaticTierHomePage`, which only ever substituted `menu`/`partial`
// markers via `renderStaticPage` directly and never ran `resolveHtmlPageEmbeds` or
// `resolvePostPreviewsForRender` at all — a widget, post-previews, or collection marker
// authored straight into `index.html` (or a partial it references) silently never resolved.
// `renderStaticTierHomePage` stays in place for its one other caller
// (`theme page preview middleware`'s admin preview route, which never reaches this handler).

// Post/Redirect/Get result for a form widget on the home page (2026-08-31 fix, generalized
// the same day) — `forms-submit.ts` redirects back here with `?form=...&form_status=...` after
// a JS-disabled submission; a request with none of those params is the ordinary case and this
// is a no-op. Also reads (and clears) the validation flash cookie, if any, and decides this
// response's `Cache-Control` — including the member-session arm, which matters here because
// `visiblePosts` above made this body cookie-dependent. See `resolvePerVisitorResponse`'s doc.
export async function serveHomePage<TTheme extends { manifest: { tier: string }; pages: Readonly<Record<string, string>> }, TMenu, TResolver, TContext, TVisitor>(required: {
  preRedirect: () => Promise<boolean>; rootPath: string;
  context: Parameters<typeof preparePageRouteContext<TResolver, TContext>>[0]["ports"];
  noThemeId: string; resolveActiveTheme: (required: { activeThemeId: string }) => TTheme | string | null; sendNoThemesInstalled: () => void;
  readHomePage: () => Promise<{ post: PublicPostRecord }>;
  decidePostMemberAccess: (required: { resolver: TResolver; post: PublicPostRecord; context: TContext }) => { allowed: boolean };
  resolveStaticMenusForRender: (required: { theme: TTheme | null; currentPath: string }) => Promise<Readonly<Record<string, TMenu>>>;
  renderTemplateBranchIfEligible: (required: { theme: TTheme | null; post: PublicPostRecord; staticMenus: Readonly<Record<string, TMenu>>; siteAssistantEnabled: NonNullable<RenderSiteRequired['siteAssistantEnabled']> }, optional: { postPreviewsAccess: { resolver: TResolver; context: TContext } }) => Promise<string | undefined>;
  renderGenericPostPage: (required: { theme: TTheme | null; post: PublicPostRecord; posts: PublicPostRecord[]; siteAssistantEnabled: NonNullable<RenderSiteRequired['siteAssistantEnabled']> }) => Promise<string>;
  title: () => Promise<string>; widgets: (required: { theme: TTheme | null }) => Promise<RenderSiteRequired['widgets']>;
  mediaTransformVersions: () => Promise<RenderSiteRequired['mediaTransformVersions']>;
  extraHead: (required: { route: 'home'; siteTitle: string; post: undefined }) => Promise<string>;
  staticIndex: (required: { theme: TTheme & { pages: { index: string } }; staticMenus: Readonly<Record<string, TMenu>>; extraHead: string; siteAssistantEnabled: NonNullable<RenderSiteRequired['siteAssistantEnabled']>; access: { resolver: TResolver; context: TContext } }) => Promise<void>;
  timeZone: () => Promise<string>;
  mediaAssetMetadata: (required: { post: undefined }, optional: { listed: PublicPostRecord[] }) => Promise<RenderSiteRequired['mediaAssetMetadata']>;
  listingAfter: () => number;
  renderSite: (required: { theme: TTheme | null; route: 'home'; siteTitle: string; timeZone: string; posts: PublicPostRecord[]; listing: { pagePath: string; after: number }; widgets: RenderSiteRequired['widgets']; mediaTransformVersions: RenderSiteRequired['mediaTransformVersions']; mediaAssetMetadata: RenderSiteRequired['mediaAssetMetadata']; extraHead: string; siteAssistantEnabled: NonNullable<RenderSiteRequired['siteAssistantEnabled']>; staticMenus: Readonly<Record<string, TMenu>> }) => Promise<string>;
  perVisitor: () => TVisitor; send: (required: { html: string; perVisitor: TVisitor }) => Promise<void>;
  listingFailure: () => void; reportFault: (error: unknown) => void; sendFault: () => void;
}, _optional = {}): Promise<void> {
  try {
    if (await required.preRedirect()) return;
    const context = await preparePageRouteContext({ ports: required.context, home: true });
    // Newest display date first, the order every post listing uses (it was insertion order).
    context.visiblePosts.sort(comparePostsByDisplayDate);
    const resolved = resolvePageRouteTheme({ resolved: required.resolveActiveTheme({ activeThemeId: context.activeThemeId }), noThemeId: required.noThemeId });
    if (resolved.kind === 'missing') { required.sendNoThemesInstalled(); return; }
    const theme = resolved.theme;
    const found = await required.readHomePage().catch((err) => {
      if (err instanceof PostNotFoundError) return null;
      throw err;
    });
    const homePage = found && required.decidePostMemberAccess({ resolver: context.memberAccessResolver, post: found.post, context: context.memberContext }).allowed ? found.post : undefined;
    if (homePage) { await serveContentHomePage({ ports: required, theme, homePage, context }); return; }
    await serveDefaultHomePage({ ports: required, theme, context });
  } catch (err) {
    if (err instanceof ListingBatchNotFoundError) return required.listingFailure();
    required.reportFault(err); required.sendFault();
  }
}

/** `GET /` when a Page claims `/`: the template branch when eligible, else the generic post page. */
async function serveContentHomePage<TTheme extends { manifest: { tier: string }; pages: Readonly<Record<string, string>> }, TMenu, TResolver, TContext, TVisitor>(required: {
  ports: Parameters<typeof serveHomePage<TTheme, TMenu, TResolver, TContext, TVisitor>>[0]; theme: TTheme | null; homePage: PublicPostRecord;
  context: Awaited<ReturnType<typeof preparePageRouteContext<TResolver, TContext>>>;
}, _optional = {}): Promise<void> {
  const { ports, theme, homePage, context: { siteAssistantEnabled, memberAccessResolver, memberContext, visiblePosts } } = required;
  const staticMenus = await ports.resolveStaticMenusForRender({ theme, currentPath: ports.rootPath });
  const templateHtml = await ports.renderTemplateBranchIfEligible({ theme, post: homePage, staticMenus, siteAssistantEnabled }, { postPreviewsAccess: { resolver: memberAccessResolver, context: memberContext } });
  const html = templateHtml ?? (await ports.renderGenericPostPage({ theme, post: homePage, posts: visiblePosts, siteAssistantEnabled }));
  await ports.send({ html, perVisitor: ports.perVisitor() });
}

async function serveDefaultHomePage<TTheme extends { manifest: { tier: string }; pages: Readonly<Record<string, string>> }, TMenu, TResolver, TContext, TVisitor>(required: {
  ports: Parameters<typeof serveHomePage<TTheme, TMenu, TResolver, TContext, TVisitor>>[0]; theme: TTheme | null;
  context: Awaited<ReturnType<typeof preparePageRouteContext<TResolver, TContext>>>;
}, _optional = {}): Promise<void> {
  const { ports, theme, context: { siteAssistantEnabled, memberAccessResolver, memberContext, visiblePosts } } = required;
  const siteTitle = await ports.title();
  const [widgets, mediaTransformVersions, extraHead, staticMenus] = await Promise.all([
    ports.widgets({ theme }), ports.mediaTransformVersions(), ports.extraHead({ route: 'home', siteTitle, post: undefined }), ports.resolveStaticMenusForRender({ theme, currentPath: ports.rootPath }),
  ]);
  const index = { theme };
  if (hasStaticThemeIndex(index)) {
    await ports.staticIndex({ theme: index.theme, staticMenus, extraHead, siteAssistantEnabled, access: { resolver: memberAccessResolver, context: memberContext } });
    return;
  }
  const html = await ports.renderSite({ theme, route: 'home', siteTitle, timeZone: await ports.timeZone(), posts: visiblePosts,
    listing: { pagePath: ports.rootPath, after: ports.listingAfter() }, widgets, mediaTransformVersions,
    // Featured image (2026-10-05): resolves only the listed posts' featured ids for post cards.
    mediaAssetMetadata: await ports.mediaAssetMetadata({ post: undefined }, { listed: visiblePosts }), extraHead, siteAssistantEnabled, staticMenus });
  await ports.send({ html, perVisitor: ports.perVisitor() });
}
