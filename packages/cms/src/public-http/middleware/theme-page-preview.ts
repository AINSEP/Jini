/**
 * @file The server-neutral decisions behind the theme Explore preview routes: `/theme-explore/{themeId}/{pageId}`
 * (a static theme's page, fully rendered — the admin Explore screen's preview iframe), its sibling
 * `/theme-explore/{themeId}/partial/{partialId}` (a theme's PARTIALS — `nav`, `footer`, `sidebar`, … —
 * standalone), and `/theme-explore/{themeId}/template/{templateId}` (one `.liquid` file of a templated theme).
 * Each decision answers with a neutral {@link ThemePreviewResponse}; the host keeps the HTTP adapter (its
 * admin-session gate, its `theme.set` authorization, its failure reporter) and writes the answer onto its
 * response in order: status, then each header, then the content type, then the body.
 *
 * Partials are a sibling route rather than a branch of the page route: partial ids and page ids are
 * different namespaces (a theme could legitimately have a page and a partial that happen to share a
 * name), and a distinct URL shape says so instead of relying on a lookup order to disambiguate.
 *
 * Rendered through the real loader (`renderStaticPage`), not a prebuilt copy: markers resolved,
 * design tokens inlined, asset paths rewritten to `/theme-assets/{themeId}/`. That last part is why
 * this has to be a real URL on the SITE origin rather than HTML posted into a `srcDoc` iframe — a
 * `srcDoc` document resolves those relative asset paths against the ADMIN's origin, where nothing
 * serves them, so every stylesheet 404s and the preview is a wall of unstyled text.
 *
 * The two STATIC-tier routes are ungated, matching the theme static-asset mount's existing posture:
 * a theme's pages and CSS are already served to anonymous visitors by the site itself, and the
 * static file server there already exposes each theme's `pages/*.html` directly. Rendering a page
 * nobody activated reveals nothing the theme files do not, and the admin's own auth cannot reach an
 * iframe pointed at the site origin anyway.
 *
 * The TEMPLATED-tier route (2026-08-12, `.liquid` Preview-tab fix) is GATED by the host, deliberately
 * NOT following that same ungated reasoning even though it serves a structurally similar purpose. That
 * reasoning rests on several conditions holding simultaneously (only published content ever flows in,
 * products are always empty, the render pipeline's own escaping never changes) — conditions that are
 * correct today but are each independently a decision someone could change later without revisiting
 * this file. Every OTHER route on this resource (the host's admin theme Explore routes) is gated on
 * `theme.set`; an ungated new route would be the one anomaly a future reader has to re-derive the
 * justification for. Gating it costs one line (an admin-session gate + the same `theme.set` check the
 * Explore routes already share) and removes the whole question.
 */

const PLAIN_TEXT = "text/plain";
/** Previews render apart from the site's own origin. Theme fonts already allow any origin, so they still look right. */
const PREVIEW_SANDBOX = "sandbox allow-scripts allow-forms";

/** The `SiteRenderContext` shape a `.liquid` template file was authored against. */
export type TemplatedPreviewRoute = "home" | "post" | "products" | "product";

/** What the host writes: `status`, then each header in order, then `type` (its content-type shorthand), then `body`. */
export interface ThemePreviewResponse {
  readonly status: number;
  readonly headers: readonly (readonly [name: string, value: string])[];
  readonly type: string;
  readonly body: string;
}

/** The part of a discovered theme these decisions read: its tier and its `.liquid` template files. */
export interface PreviewableTheme {
  readonly manifest: { readonly tier: string };
  readonly liquidTemplates: Readonly<Record<string, unknown>>;
}

/** Looks a theme up by id in the host's live theme list. */
export type FindPreviewTheme<Theme> = (required: { themeId: string }) => Theme | undefined;

/** The host's static-tier renderers, plus its theme lookup. Each renderer answers `null` for an unknown id. */
export interface StaticThemePreviewDeps<Theme extends PreviewableTheme> {
  readonly findTheme: FindPreviewTheme<Theme>;
  readonly renderStaticPage: (required: { theme: Theme; pageId: string }) => string | null;
  readonly renderStaticPartial: (required: { theme: Theme; partialId: string }) => string | null;
}

/** What the templated preview hands the host's site renderer. Products stay hard-coded empty (see {@link templatedThemePagePreview}). */
export interface TemplatedPreviewRenderInput<Theme, Post, Widgets, Versions, Metadata, Embeds> {
  readonly theme: Theme;
  readonly route: TemplatedPreviewRoute;
  readonly siteTitle: string;
  readonly timeZone: string;
  readonly posts: Post[];
  readonly post: Post | undefined;
  readonly products: never[];
  readonly product: undefined;
  readonly widgets: Widgets;
  readonly mediaTransformVersions: Versions;
  readonly mediaAssetMetadata: Metadata;
  readonly pageHtmlEmbeds: Embeds;
  readonly liquidTemplateIdOverride: string;
}

/** The host's published-content reader, render-context resolvers, and site renderer for the templated preview. */
export interface TemplatedThemePreviewDeps<Theme extends PreviewableTheme, Post, Widgets, Versions, Metadata, Embeds> {
  readonly findTheme: FindPreviewTheme<Theme>;
  /** Published posts only — the same reader the live site renders from, never a draft. */
  readonly listPublishedPosts: () => Promise<{ posts: Post[] }>;
  readonly resolveWidgets: (required: { theme: Theme }, optional: { post?: Post | undefined }) => Promise<Widgets>;
  readonly resolveMediaTransformVersions: () => Promise<Versions>;
  readonly resolveMediaAssetMetadata: (required: { post: Post | undefined }) => Promise<Metadata>;
  readonly resolveHtmlEmbeds: (required: { post: Post | undefined }) => Promise<Embeds>;
  readonly resolveSiteTitle: () => Promise<string>;
  readonly resolveSiteTimeZone: () => Promise<string>;
  readonly renderSite: (input: TemplatedPreviewRenderInput<Theme, Post, Widgets, Versions, Metadata, Embeds>) => Promise<string>;
}

function plainText(status: number, body: string): ThemePreviewResponse {
  return { status, headers: [], type: PLAIN_TEXT, body };
}

/**
 * The lookup + tier check the two STATIC-tier routes need before they can render anything:
 * find the theme, 404 if it doesn't exist, 422 if it isn't `static` tier. Returns the theme on
 * success, or the refusal to write.
 */
function resolveStaticTheme<Theme extends PreviewableTheme>(
  required: { findTheme: FindPreviewTheme<Theme>; themeId: string }
): { theme: Theme } | { refusal: ThemePreviewResponse } {
  const { themeId } = required;
  const theme = required.findTheme({ themeId });
  if (!theme) return { refusal: plainText(404, `theme '${themeId}' was not found`) };
  if (theme.manifest.tier !== "static") {
    return { refusal: plainText(422, `theme '${themeId}' is a '${theme.manifest.tier}' theme; only static themes preview this way`) };
  }
  return { theme };
}

/** Rendered static HTML, never cached and sandboxed apart from the site's own origin. */
function staticHtml(html: string): ThemePreviewResponse {
  // Never cached: the Explore screen re-requests this immediately after every save, and a cached
  // response would show the operator their pre-save markup and read as "the save did not work".
  return { status: 200, headers: [["Cache-Control", "no-store"], ["Content-Security-Policy", PREVIEW_SANDBOX]], type: "text/html", body: html };
}

/** `GET /theme-explore/:themeId/:pageId` — a static theme's page, or the 404/422 refusal. Ungated. */
export function staticThemePagePreview<Theme extends PreviewableTheme>(
  required: { themeId: string; pageId: string; deps: StaticThemePreviewDeps<Theme> },
  _optional: Record<string, never> = {}
): ThemePreviewResponse {
  const { themeId, pageId, deps } = required;
  const resolved = resolveStaticTheme({ findTheme: deps.findTheme, themeId });
  if ("refusal" in resolved) return resolved.refusal;
  const html = deps.renderStaticPage({ theme: resolved.theme, pageId });
  if (html === null) return plainText(404, `page '${pageId}' was not found in theme '${themeId}'`);
  return staticHtml(html);
}

/**
 * `GET /theme-explore/:themeId/partial/:partialId` — a static theme's partial (`nav`, `footer`,
 * `sidebar`, …) previewed standalone — see this file's header for why this is a sibling route rather
 * than a fallback inside the page route. Ungated.
 */
export function staticThemePartialPreview<Theme extends PreviewableTheme>(
  required: { themeId: string; partialId: string; deps: StaticThemePreviewDeps<Theme> },
  _optional: Record<string, never> = {}
): ThemePreviewResponse {
  const { themeId, partialId, deps } = required;
  const resolved = resolveStaticTheme({ findTheme: deps.findTheme, themeId });
  if ("refusal" in resolved) return resolved.refusal;
  const html = deps.renderStaticPartial({ theme: resolved.theme, partialId });
  if (html === null) return plainText(404, `partial '${partialId}' was not found in theme '${themeId}'`);
  return staticHtml(html);
}

/**
 * Reverse of `theme.ts`'s `resolveLiquidTemplateId` — the `SiteRenderContext` shape (a posts list, a
 * single post, a products list, a single product) a given `.liquid` template FILE was authored
 * against, derived from the file's OWN name. `resolveLiquidTemplateId` answers a different question
 * ("which file does the live site fall back to for this route", preferring `post` over `entry` when a
 * theme ships both) — the wrong one here, since Explore is asking "what does THIS SPECIFIC file
 * expect", for a file the forward resolver might not even pick for its own nominal route. This only
 * decides the CONTEXT shape; `renderSite`'s own `liquidTemplateIdOverride` (separately) is what makes
 * sure the exact file selected is the one actually rendered, not whichever one the forward resolver
 * would have preferred.
 *
 * @complexity O(1).
 */
export function liquidTemplateContextRoute({ templateId }: { templateId: string }, _optional: Record<string, never> = {}): TemplatedPreviewRoute | null {
  if (templateId === "home") return "home";
  if (templateId === "products") return "products";
  if (templateId === "product") return "product";
  if (templateId === "post" || templateId === "entry") return "post";
  return null;
}

/**
 * The lookup + tier + template-existence + route-shape checks the TEMPLATED-tier route needs
 * before it can render anything: find the theme, 404 if missing, 422 if not `templated` tier, 404
 * if `templateId` names no real `.liquid` file, 422 if that file's name maps to no recognized
 * `SiteRenderContext` shape. Returns the resolved `{theme, route}` on success, or the refusal to write.
 */
function resolveTemplatedPreviewTarget<Theme extends PreviewableTheme>(
  required: { findTheme: FindPreviewTheme<Theme>; themeId: string; templateId: string }
): { theme: Theme; route: TemplatedPreviewRoute } | { refusal: ThemePreviewResponse } {
  const { themeId, templateId } = required;
  const theme = required.findTheme({ themeId });
  if (!theme) return { refusal: plainText(404, `theme '${themeId}' was not found`) };
  if (theme.manifest.tier !== "templated") {
    return { refusal: plainText(422, `theme '${themeId}' is a '${theme.manifest.tier}' theme; only templated themes preview this way`) };
  }
  if (theme.liquidTemplates[templateId] === undefined) {
    return { refusal: plainText(404, `template '${templateId}' was not found in theme '${themeId}'`) };
  }
  const route = liquidTemplateContextRoute({ templateId });
  if (!route) return { refusal: plainText(422, `template '${templateId}' has no recognized route shape and cannot be previewed here`) };
  return { theme, route };
}

/**
 * `GET /theme-explore/:themeId/template/:templateId` — one `.liquid` file of a templated theme,
 * rendered over real published content, or the 404/422 refusal. The host gates it (admin session,
 * then `theme.set`) BEFORE calling this, and turns a thrown error into its own reported 500 with
 * {@link templatedPreviewFailureResponse}.
 */
export async function templatedThemePagePreview<Theme extends PreviewableTheme, Post, Widgets, Versions, Metadata, Embeds>(
  required: { themeId: string; templateId: string; deps: TemplatedThemePreviewDeps<Theme, Post, Widgets, Versions, Metadata, Embeds> },
  _optional: Record<string, never> = {}
): Promise<ThemePreviewResponse> {
  const { themeId, templateId, deps } = required;
  const target = resolveTemplatedPreviewTarget({ findTheme: deps.findTheme, themeId, templateId });
  if ("refusal" in target) return target.refusal;
  const { theme, route } = target;

  // Real content, no fixtures: the same `listPublishedPosts` the live site itself renders from
  // (`routes/site/pages.ts`) — never a draft, matching the visibility bar the ungated static
  // routes above already rely on. A workspace with no published posts yet renders with `post`
  // left `undefined`, which is an honest, correct preview state (an empty entry page), not a
  // failure to seed data.
  const { posts } = await deps.listPublishedPosts();
  const post = route === "post" ? posts[0] : undefined;

  // Products stay hard-coded empty — a deliberate containment, not an unfinished wiring gap.
  // `fashion-modern/templates/product.liquid:118` still contains a bare
  // `{{ product.description | raw }}`, inert TODAY only because `description` is never a key on
  // `SiteProduct` (`storefront.ts`/`render.ts`'s `siteProductRenderShape` both build explicit
  // field lists with no `description` — see the 2026-08-13 security pass, Note on priority #4).
  // Wiring a real `commerceProductRepo`/`store` into THIS route is exactly the kind of change
  // that could someday put `description` back on this object without anyone touching that
  // template line — do not "finish" this by adding one without re-verifying that `| raw` stays
  // inert first. A workspace with real commerce products configured will show them on the live
  // site but NOT in this preview — a disclosed, deliberate divergence, not a bug.
  const products: never[] = [];
  const product = route === "product" ? products[0] : undefined;

  const [widgets, mediaTransformVersions, mediaAssetMetadata, pageHtmlEmbeds] = await Promise.all([
    deps.resolveWidgets({ theme }, { post }),
    deps.resolveMediaTransformVersions(),
    deps.resolveMediaAssetMetadata({ post }),
    deps.resolveHtmlEmbeds({ post }),
  ]);

  const html = await deps.renderSite({
    theme,
    route,
    siteTitle: await deps.resolveSiteTitle(),
    timeZone: await deps.resolveSiteTimeZone(),
    posts,
    post,
    products,
    product,
    widgets,
    mediaTransformVersions,
    mediaAssetMetadata,
    pageHtmlEmbeds,
    // The exact file the operator selected, not whichever one `resolveLiquidTemplateId` would
    // have preferred for `route` — see `liquidTemplateContextRoute`'s own doc.
    liquidTemplateIdOverride: templateId,
  });

  // Never cached, same reasoning as the two static-tier routes above.
  return { status: 200, headers: [["Cache-Control", "no-store"]], type: "html", body: html };
}

/** The 500 the host writes after reporting a templated-preview failure under `errorId`. */
export function templatedPreviewFailureResponse({ errorId }: { errorId: string }, _optional: Record<string, never> = {}): ThemePreviewResponse {
  return plainText(500, `The preview could not be rendered. Reload the preview; if it keeps failing, report error ${errorId}.`);
}
