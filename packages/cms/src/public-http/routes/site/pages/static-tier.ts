import type { PublicPostRecord as PostRecord } from "../../../../posts/post.js";
import type { DeclaredScript } from "@jini-ai/core/contracts/site/cookie-consent";
import type { ResolveHtmlPageEmbedsResult } from "../../../../widgets/html/resolve-html-page-embeds.js";
import type { FeaturedImageView as StaticFeaturedImage } from "../../../http/site/render/template-render-data.js";
import type { StaticMenuContent } from "./render-context/static-menus.js";
import type { PostPreviewsResult } from "./render-context/post-previews.js";
import type { DocumentAssets } from "../../../../presentation/document-assets.js";
import type { DEFAULT_THEME_SLOTS } from "../../../../themes/theme-slots.js";
import { markersOfType, MENU_MARKER_TYPE } from "../../../../widgets/markers/marker.js";
import { assignListingKeys } from "../../../../listing/html.js";
import { injectExtraHeadIntoStaticPage } from "../../../../presentation/html.js";

/**
 * D2's single static-tier document pipeline (E3, 2026-09-23) — the one sequence every static-tier
 * surface (a template-rendered post/page via {@link renderViaTemplate}, a theme marketing page via
 * {@link resolveMarketingPageOrOverride}, and — E4 — the theme's own `index.html` and themed `404`)
 * now runs, so a marker embedded in ANY of the three places a static theme assembles content from —
 * a Page/Post's own authored body, the theme's raw page/marketing-page file, or a partial included
 * into either — resolves the same way regardless of which surface it landed on.
 *
 * Order is fixed and matters:
 * 1. {@link expandPartials} runs FIRST, so a widget/media/post/content/menu/post-previews marker
 *    authored inside a partial (`nav.html`, `footer.html`, …) is physically present in the html
 *    before anything below ever scans it. Before this, a partial's own markers were invisible to
 *    every resolver here, because `renderStaticPage`'s own partial expansion ran strictly AFTER the
 *    embed-resolution stage on every pre-existing call path.
 * 2. `resolveHtmlPageEmbeds` + `renderHtmlPageBody` resolve every widget/media/post/content marker
 *    now present in the expanded html. `menu`/`post-previews` are theme-owned marker types this
 *    stage never touches (`THEME_OWNED_MARKER_TYPES`), so they survive into the steps below by
 *    design, not by omission.
 * 3. Any `menu` marker left in the assembled html whose id is not already a key of `input.staticMenus`
 *    (the caller's own theme-FILE-only scan — {@link resolveStaticMenusForRender}'s first,
 *    no-`extraMenuIds` call at the top of the request) is fetched now. This is what lets a menu
 *    marker authored directly in a Page/Post's own body — never in a theme file, so
 *    `scanMenuEmbedIds` could never see it — resolve at all.
 * 4. {@link resolvePostPreviewsForRender} scans the SAME assembled html — not `theme.pages[pageId]`/
 *    a raw, unassembled template alone — for a `post-previews` marker, so one authored inside a
 *    Page's own body or a partial is found too.
 * 5. {@link resolveCollectionListsForRender} (C5, 2026-09-23) scans the same assembled html for every
 *    distinct `{"type":"collection"}` marker config and resolves each to a rendered entry list, same
 *    "scan the assembled document, not the raw template" reasoning as step 4.
 * 6. `renderStaticPage` applies every remaining static-tier treatment (token injection, asset-path
 *    rewrite, its own idempotent `expandPartials` re-pass, `menu`/`post-previews`/`collection`
 *    injection, link rewrite) on top, exactly as it always has.
 *
 * `input.html` is always supplied to `renderStaticPage` as `htmlOverride`, so its `source ===
 * undefined` null case — reachable only when BOTH `htmlOverride` and `theme.pages[pageId]` are
 * undefined — can never fire here. The `?? ""` below is the same proven-unreachable fallback
 * `renderViaTemplate`'s own pre-existing calls already carry (see that function's own comment for
 * the full proof); not narrowed here for the same out-of-scope reason (the real fix narrows
 * `renderStaticPage`'s return type in static-render.ts).
 *
 * No pending-content override is taken here (removed 2026-10-20, no caller ever passed one): the
 * one preview path, `renderViaTemplate`, applies its unsaved body in its own body stage before it
 * calls this, so the markers that body carries are already consumed by the time they get here.
 *
 * @complexity One `resolveHtmlPageEmbeds` pass (bounded by `MAX_HTML_EMBEDS_PER_PAGE`) plus, only
 * when the assembled html names a menu `input.staticMenus` does not already carry, one additional
 * `resolveStaticMenusForRender` call bounded to exactly those missing ids — never a full theme-wide
 * re-scan — plus one `resolveCollectionListsForRender` pass bounded to at most
 * `MAX_DISTINCT_COLLECTION_MARKERS_PER_PAGE` distinct marker configs.
 */
export async function finishStaticTierDocument<TMenu = StaticMenuContent, TAccess extends object = object>(
  { deps, input }: { deps: {
    DEFAULT_THEME_SLOTS: typeof DEFAULT_THEME_SLOTS;
    expandPartials(required: { defaultSlots: typeof DEFAULT_THEME_SLOTS; html: string }): string;
    resolveHtmlPageEmbeds(required: { html: string }): Promise<ResolveHtmlPageEmbedsResult | undefined>;
    renderHtmlPageBody(required: { html: string; resolved: ResolveHtmlPageEmbedsResult | undefined }, optional: { postAuthor: StaticTierDocumentInput<TMenu, TAccess>["postAuthor"] }): string;
    resolveStaticMenusForRender(required: { currentPath: string }, optional: { extraMenuIds: string[] }): Promise<Readonly<Record<string, TMenu>>>;
    resolvePostPreviewsForRender(required: { pageHtml: string; pagePath: string; postPreviewsAccess: TAccess }): Promise<PostPreviewsResult | undefined>;
    resolveCollectionListsForRender(required: { html: string; pagePath: string }): Promise<ReadonlyMap<string, string | undefined>>;
    renderStaticPage(required: { pageId: string; htmlOverride: string; menus: StaticTierDocumentInput<TMenu, TAccess>["staticMenus"]; postPreviews: PostPreviewsResult["previews"] | undefined; postPreviewBatches: PostPreviewsResult["batches"] | undefined; postPreviewsPage: PostPreviewsResult["page"]; collectionLists: ReadonlyMap<string, string | undefined>; featuredImage: StaticTierDocumentInput<TMenu, TAccess>["featuredImage"]; postAuthor: StaticTierDocumentInput<TMenu, TAccess>["postAuthor"] }): string | null;
    staticThemeScripts(): readonly DeclaredScript[];
    documentAssets: ((required: { scripts: readonly DeclaredScript[]; static: true }) => Promise<DocumentAssets>) | undefined;
  }; input: StaticTierDocumentInput<TMenu, TAccess> },
  _optional: Record<string, never> = {}
): Promise<string> {
  const { pageId, html, currentPath, staticMenus, postPreviewsAccess, featuredImage, postAuthor } = input;

  const assembled = await prepareStaticTierHtml({ deps, html, postAuthor });
  const { menus, postPreviews, collectionLists } = await resolveStaticTierData({ deps, assembled, currentPath, staticMenus, postPreviewsAccess });

  return injectExtraHeadIntoStaticPage({ html: deps.renderStaticPage({
      pageId,
      htmlOverride: assembled,
      menus,
      postPreviews: postPreviews?.previews,
      postPreviewBatches: postPreviews?.batches,
      postPreviewsPage: postPreviews?.page,
      collectionLists,
      featuredImage,
      postAuthor,
    }) ?? "", extraHead: (await deps.documentAssets?.({ scripts: deps.staticThemeScripts(), static: true }))?.head });
}

/** What {@link finishStaticTierDocument} finishes: one static-tier page of `theme`, and who is asking. */
interface StaticTierDocumentInput<TMenu = StaticMenuContent, TAccess extends object = object> {
  readonly pageId: string;
  readonly html: string;
  readonly currentPath: string;
  readonly staticMenus: Readonly<Record<string, TMenu>> | undefined;
  readonly postPreviewsAccess?: TAccess | undefined;
  /** The rendered post's featured image for a `{"type":"featured-image"}` marker (2026-10-05);
   *  omitted on every surface that is not a post, which removes the marker. */
  readonly featuredImage?: StaticFeaturedImage | null | undefined;
  readonly postAuthor?: Pick<PostRecord, "id" | "slug" | "author" | "showAuthor"> | undefined;
}

/** Steps 1–2 of {@link finishStaticTierDocument}: partials expanded, embeds resolved, listing keys assigned. */
async function prepareStaticTierHtml<TMenu, TAccess extends object>({ deps, html, postAuthor }: { deps: Parameters<typeof finishStaticTierDocument<TMenu, TAccess>>[0]["deps"] } & Pick<StaticTierDocumentInput<TMenu, TAccess>, "html" | "postAuthor">, _optional: Record<string, never> = {}): Promise<string> {
  const expanded = deps.expandPartials({ defaultSlots: deps.DEFAULT_THEME_SLOTS, html: html });
  const resolved = await deps.resolveHtmlPageEmbeds({ html: expanded });
  // See-more listings get their keys here, on the one assembled document every resolver below and
  // the batch extractor (`finalizePublicPageHtml`) number the same way.
  return assignListingKeys({ html: deps.renderHtmlPageBody({ html: expanded, resolved }, { postAuthor }) });
}

/** Steps 3–5 of {@link finishStaticTierDocument}: the menus the assembled html still names, post previews, collection lists. */
async function resolveStaticTierData<TMenu, TAccess extends object>({ deps, assembled, currentPath, staticMenus, postPreviewsAccess }: { deps: Parameters<typeof finishStaticTierDocument<TMenu, TAccess>>[0]["deps"]; assembled: string } & Pick<StaticTierDocumentInput<TMenu, TAccess>, "currentPath" | "staticMenus" | "postPreviewsAccess">, _optional: Record<string, never> = {}) {
  const missingMenuIds = missingStaticMenuIds({ assembled, staticMenus });
  const menus =
    missingMenuIds.length === 0
      ? staticMenus
      : { ...staticMenus, ...(await deps.resolveStaticMenusForRender({ currentPath }, { extraMenuIds: missingMenuIds })) };

  const postPreviews = postPreviewsAccess
    ? await deps.resolvePostPreviewsForRender({ pageHtml: assembled, pagePath: currentPath, postPreviewsAccess })
    : undefined;

  // C5 (collections plan, 2026-09-23) — the SAME assembled html post-previews just scanned, so a
  // `{"type":"collection"}` marker authored in a Page/Post body or a partial resolves here too, not
  // only one hand-authored directly into a theme file.
  const collectionLists = await deps.resolveCollectionListsForRender({ html: assembled, pagePath: currentPath });
  return { menus, postPreviews, collectionLists };
}

export function missingStaticMenuIds<TMenu>({ assembled, staticMenus }: { assembled: string; staticMenus: StaticTierDocumentInput<TMenu>["staticMenus"] }, _optional = {}): string[] {
  const knownMenuIds = new Set(Object.keys(staticMenus ?? {}));
  const missingMenuIds = Array.from(
    new Set(
      markersOfType({ html: assembled, type: MENU_MARKER_TYPE })
        .map((marker) => marker.id)
        .filter((id): id is string => id !== undefined && !knownMenuIds.has(id))
    )
  );
  return missingMenuIds;
}

/** A static-tier theme that ships its own `index.html`. */
export function hasStaticThemeIndex<TTheme extends { manifest: { tier: string }; pages: Readonly<Record<string, string>> }>(required: { theme: TTheme | null }, _optional: Record<string, never> = {}): required is { theme: TTheme & { pages: { index: string } } } {
  const { theme } = required;
  return theme !== null && theme.manifest.tier === "static" && theme.pages.index !== undefined;
}

/** Static pages and diagnostic templates share the theme's declared-script defaults. */
export function staticThemeScripts({ theme }: { theme: { manifest: { scripts?: readonly DeclaredScript[] } } }, _optional = {}): readonly DeclaredScript[] {
  return theme.manifest.scripts ?? [];
}

/** `GET /` through a static theme's own `index.html` (see the E4 note at the call site). */
export async function serveStaticThemeIndex<TTheme extends { pages: { index: string } }, TMenu, TAccess extends object, TVisitor>(required: {
  theme: TTheme; staticMenus: Readonly<Record<string, TMenu>>; extraHead: string;
  siteAssistantEnabled: boolean | 'react' | 'vanilla'; access: TAccess; pageId: string; currentPath: string;
  title: (optional: { preserveAuthoredFallback: true }) => Promise<string | undefined>;
  finish: (required: { input: { theme: TTheme; pageId: string; html: string; currentPath: string; staticMenus: Readonly<Record<string, TMenu>>; postPreviewsAccess: TAccess } }, optional: Record<string, never>) => Promise<string>;
  chat: (required: { html: string; enabled: boolean | 'react' | 'vanilla' }) => string;
  perVisitor: () => TVisitor; send: (required: { html: string; perVisitor: TVisitor }) => Promise<void>;
}, _optional = {}): Promise<void> {
  // Preserve authored titles only when neither a workspace title nor a pending pin supplies one.
  const preserveThemeTitle = await required.title({ preserveAuthoredFallback: true })
    .then((title) => title === undefined, () => false);
  const rendered = await required.finish({ input: {
    theme: required.theme,
    pageId: required.pageId,
    html: required.theme.pages.index,
    currentPath: required.currentPath,
    staticMenus: required.staticMenus,
    postPreviewsAccess: required.access,
  } }, {});
  const homeHtml = required.chat({ html: injectExtraHeadIntoStaticPage({ html: rendered, extraHead: required.extraHead }, { preserveThemeTitle }), enabled: required.siteAssistantEnabled });
  await required.send({ html: homeHtml, perVisitor: required.perVisitor() });
}
