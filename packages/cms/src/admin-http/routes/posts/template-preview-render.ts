import type { RenderBareEntryDocumentRequired } from "../../../public-http/http/site/bare-page.js";
import type { JsonObject } from "@jini-ai/core/primitives";
import type { PublicPostRecord as PostRecord } from "../../../posts/post.js";
import type { StaticMenuContent } from "../../../public-http/routes/site/pages/render-context/static-menus.js";
import { withPageShellChoice } from "../../../public-http/routes/site/pages/handlers/post.js";

/** `TMenus` is the host's resolved static-menu map: this module only carries it from
 *  `resolveStaticMenusForRender` to `renderViaTemplate`, so the host's own shape flows through unchanged. */
type ContentRouteDeps<TMenus = Readonly<Record<string, StaticMenuContent>>> = {
  getPresentationSettings(): Promise<{ settings: { activeThemeId: string } }>;
  isBarePageChoice(post: PostRecord): boolean;
  renderBarePreview(required: { post: PostRecord }): Promise<string>;
  resolveActiveTheme(required: { activeThemeId: string }): object | "none" | null;
  NO_THEME_ID: "none";
  resolveTemplateBranchChoice(required: { theme: object; post: PostRecord }): { kind: "ineligible" | "as-chosen" } | { kind: "page-shell"; templateChoice: string };
  resolveStaticMenusForRender(required: { theme: object; currentPath: string }): Promise<TMenus>;
  postPublicPath(required: { slug: string }): string;
  createMemberAccessResolver(): object;
  renderViaTemplate(required: { theme: object; post: PostRecord; staticMenus: TMenus }, optional: { pendingBodyJson: JsonObject | undefined; pendingBodyHtml: string | undefined; siteAssistantEnabled: false; postPreviewsAccess: { resolver: object; context: { isAuthenticated: boolean; activeTierIds: string[]; isPaid: boolean } } }): Promise<string>;
  copy: { missingTheme: string; themeOff: string };
};

/**
 * Never persisted — a shallow clone rendered once for this response and discarded.
 *
 * `pendingBodyHtml` is only ever applied when `post.bodyFormat === "html"` — a `"doc"`-format post
 * has no HTML body to preview, and applying it there would silently disagree with the
 * `bodyJson` override on the same clone.
 *
 * @complexity O(1).
 */
function buildPreviewPost(
  { post, overrideTemplateChoice, pendingBodyJson, pendingBodyHtml }: { post: PostRecord; overrideTemplateChoice: string | null; pendingBodyJson: JsonObject | undefined; pendingBodyHtml: string | undefined }, _options: Record<string, never> = {}
): PostRecord {
  return {
    ...post,
    templateChoice: overrideTemplateChoice,
    ...(pendingBodyJson !== undefined ? { bodyJson: pendingBodyJson } : {}),
    ...(pendingBodyHtml !== undefined && post.bodyFormat === "html" ? { bodyHtml: pendingBodyHtml } : {}),
  };
}

/** The route preserves these state-conflict statuses; the tool publishes the actionable message. */
export class TemplatePreviewRenderError extends Error {
  readonly status: number;
  constructor({ status, message }: { status: number; message: string }) {
    super(message);
    this.status = status;
    this.name = "TemplatePreviewRenderError";
  }
}
export interface PostPreviewRenderInput {
  post: PostRecord;
  templateChoice?: string | null;
  bodyJson?: JsonObject;
  bodyHtml?: string;
}
export interface PostPreviewRenderResult { html: string; templateChoice: string | null }
/** Selects pending content first, then the already-authorized unpublished row's own body. */
function resolvePreviewBodyOverrides(
  { post, pendingBodyJson, pendingBodyHtmlOverride }: {
    post: PostRecord;
    pendingBodyJson: JsonObject | undefined;
    pendingBodyHtmlOverride: string | undefined;
  },
  _options: Record<string, never> = {}
): { bodyJson: JsonObject | undefined; bodyHtml: string | undefined } {
  // 2026-09-16, owner: "it should render even in unpublished state." The template's own
  // `{"type":"content"}` slot resolves through a VISIBILITY-FILTERED resolver
  // (`resolver-service.ts`'s `findPublishedPostById`), which finds nothing for an unpublished
  // row — so a draft previewed with styled chrome and NO BODY AT ALL, the REQ-28 placeholder
  // where its content should be. Measured, not inferred, before this change.
  //
  // The row's own body is the right answer here and is already in hand: this request fetched it
  // by id and `deps.authorize` already cleared this principal for `content.read` above, so the
  // operator can read this exact body from the admin API anyway. Rendering it into a `no-store`,
  // admin-only preview response exposes nothing new — the guard exists to keep unpublished
  // content off the PUBLIC site, and this route is not that.
  //
  // Scoped to unpublished rows deliberately: a published row's preview keeps resolving through
  // the resolver exactly as before, byte for byte, so this cannot change what the owner already
  // sees for the overwhelmingly common case. A genuine pending override always wins over it.
  const unpublished = post.status !== "published";
  const bodyJson = pendingBodyJson ?? (unpublished && post.bodyFormat === "doc" ? post.bodyJson : undefined);
  const savedBodyHtml = unpublished && post.bodyFormat === "html" ? post.bodyHtml : undefined;
  const bodyHtml = pendingBodyHtmlOverride ?? savedBodyHtml ?? undefined;

  return { bodyJson, bodyHtml };
}

/**
 * Renders an already-authorized row through the existing bare/theme pipelines, without writes.
 * Omitted templateChoice uses the saved choice; null and an empty string retain their distinct
 * template-selection meanings. Unsaved body fields override this render only.
 * @throws TemplatePreviewRenderError when a theme is unavailable for a template preview.
 * @complexity One bounded page render plus the existing theme, embed and menu repository reads.
 * @example await renderPostPreview({ deps, input: { post, templateChoice: "article.html", bodyJson: pending } });
 */
export async function renderPostPreview<TMenus>({ deps, input }: { deps: ContentRouteDeps<TMenus>; input: PostPreviewRenderInput }, _optional = {}): Promise<PostPreviewRenderResult> {
  const post = input.post;
  const overrideTemplateChoice = input.templateChoice === undefined ? post.templateChoice ?? null : input.templateChoice;
  const pendingBodyJson = input.bodyJson;
  const pendingBodyHtml = input.bodyHtml;
  const pendingBodyHtmlOverride = post.bodyFormat === "html" ? pendingBodyHtml : undefined;

  const previewPost = buildPreviewPost({ post, overrideTemplateChoice, pendingBodyJson, pendingBodyHtml });

  // Bare-page preview (owner ruling 2026-09-23, S5) — checked BEFORE any theme resolution/409: a
  // bare Page renders identically regardless of theme, mirroring `renderBarePage`'s own placement
  // ahead of the `theme === null` check on the public site (`pages.ts`'s
  // `renderTemplateBranchIfEligible`).
  if (deps.isBarePageChoice(previewPost)) {
    const html = await deps.renderBarePreview({ post: previewPost });
    // `isBarePageChoice` only holds for `templateChoice === ""`, so the bare arm's choice is always
    // exactly that empty string -- never null/undefined (a `?? null` here was unreachable).
    return { html, templateChoice: "" };
  }

  const { settings } = await deps.getPresentationSettings();
  const resolved = deps.resolveActiveTheme({ activeThemeId: settings.activeThemeId });
  if (resolved === null) {
    throw new TemplatePreviewRenderError({ status: 500, message: deps.copy.missingTheme });
  }
  // Producer 4 of the optional-theme design. The thing this route previews IS a theme file, so
  // with the theme deliberately off there is nothing coherent to render. Before this guard the
  // route did not fail — it walked `resolveTemplate` -> `renderStaticPage` -> a `theme.pages`
  // lookup returning `undefined`, and landed on a `?? ""`, serving an EMPTY BODY with a 200.
  // The operator saw a blank preview pane and no reason for it, indistinguishable from a broken
  // template. 409 rather than 500: nothing is broken and nothing about the request is
  // malformed; the site's current state simply conflicts with what was asked for. This is an
  // admin tool, not a public surface, so an explicit error is right here even though the public
  // site answers the same state by rendering unstyled.
  if (resolved === deps.NO_THEME_ID) {
    throw new TemplatePreviewRenderError({ status: 409, message: deps.copy.themeOff });
  }
  const theme = resolved;

  const { bodyJson: previewBodyJson, bodyHtml: previewBodyHtml } = resolvePreviewBodyOverrides({
    post, pendingBodyJson, pendingBodyHtmlOverride,
  });

  // 2026-09-16 fix. This route used to hand `previewPost` straight to `renderViaTemplate`, while
  // the PUBLIC route reaches that same function only through `renderTemplateBranchIfEligible`,
  // which first asks `resolveTemplateBranchChoice` which template actually applies. For a
  // `kind: "page"`, `bodyFormat: "html"` row with no `templateChoice` — the state every
  // agent-created Page starts in, and the state the picker's "No template chosen" puts one back
  // into — the two answers differed: the public site resolved the theme's page shell, this route
  // fell through `resolveTemplate`'s "never chosen" arm onto `theme.manifest.templates[0]`
  // (`posts-default.html` on live `basic`) or, for the explicit `""`, onto the diagnostic page.
  // Either way the preview pane showed something the public URL never would. Asking the same
  // question the public route asks is the whole fix.
  //
  // `"ineligible"` keeps this route's PRE-EXISTING behavior (render `previewPost` as-is) rather
  // than matching the public site, which falls to a generic non-template render this route has no
  // access to. That remains a divergence for a `doc`-format Page with no template — narrower than
  // the one being closed, unreachable from the Pages picker (which only renders for `"html"`
  // format), and closing it means wiring a second render pipeline into an admin route, which is a
  // different change from this bug fix.
  const branch = deps.resolveTemplateBranchChoice({ theme, post: previewPost });
  // A shallow clone for THIS render only — nothing is written back, exactly as the public route's
  // own page-shell arm does it, so the row stays untemplated and a later explicit pick still wins.
  const renderedPost = withPageShellChoice({ post: previewPost, branch });

  const staticMenus = await deps.resolveStaticMenusForRender({ theme, currentPath: deps.postPublicPath({ slug: post.slug }) });
  // Preview the anonymous visitor's listing, never the admin's privileges. Passing access enables
  // the live pipeline's assembled-document resolution (plain, paged and keyed See more batches),
  // after pending content has been applied; no second listing fetch/render implementation.
  const postPreviewsAccess = {
    resolver: deps.createMemberAccessResolver(),
    context: { isAuthenticated: false, activeTierIds: [], isPaid: false },
  };
  const html = await deps.renderViaTemplate({ theme, post: renderedPost, staticMenus }, { pendingBodyJson: previewBodyJson, pendingBodyHtml: previewBodyHtml, siteAssistantEnabled: false, postPreviewsAccess });

  return { html, templateChoice: renderedPost.templateChoice ?? null };
}

/**
 * Bare-page preview (owner ruling 2026-09-23, S5) — mirrors `pages.ts`'s own `renderBarePage`, but
 * built from `ContentRouteDeps`-compatible (Pick-typed) exports only, since this route's `deps` is
 * narrower than the full `RouteDeps` those two functions require. Inline `widgetEmbed` nodes resolve
 * through `resolveWidgetsForRender({ deps, theme: null }, { post })`, the same `theme: null` call the live bare
 * render makes: a doc-format Page can be bare too (the `templateChoice` query/API, not only the Pages
 * picker), and skipping it previewed every inline widget as the placeholder. Skips the SEO
 * `extraHead` fold (`buildExtraHead` is private to `pages.ts` and needs `originRegistry`, not in
 * `ContentRouteDeps`) — a disclosed, low-stakes trim: this is a never-indexed admin iframe, not the
 * public site S4 already covers.
 */
export async function renderBarePostPreview({ deps, post }: { deps: {
  resolveSiteTitle(): Promise<string>;
  resolveWidgetsForRender(required: { theme: null }, optional: { post: PostRecord }): Promise<{ inlineResolved: NonNullable<RenderBareEntryDocumentRequired["widgetInlineResolved"]> }>;
  resolveHtmlEmbedsForRender(required: { post: PostRecord }): Promise<RenderBareEntryDocumentRequired["pageHtmlEmbeds"]>;
  resolveMediaTransformVersionsForRender(): Promise<NonNullable<RenderBareEntryDocumentRequired["mediaTransformVersions"]>>;
  resolveMediaAssetMetadataForRender(required: { post: PostRecord }): Promise<NonNullable<RenderBareEntryDocumentRequired["mediaAssetMetadata"]>>;
  renderBareEntryDocument(required: Pick<RenderBareEntryDocumentRequired, "post" | "siteTitle" | "pageHtmlEmbeds" | "widgetInlineResolved" | "mediaTransformVersions" | "mediaAssetMetadata">): string;
}; post: PostRecord }, _optional = {}): Promise<string> {
  const [siteTitle, widgets, pageHtmlEmbeds, mediaTransformVersions, mediaAssetMetadata] = await Promise.all([
    deps.resolveSiteTitle(),
    deps.resolveWidgetsForRender({ theme: null }, { post }),
    deps.resolveHtmlEmbedsForRender({ post }),
    deps.resolveMediaTransformVersionsForRender(),
    deps.resolveMediaAssetMetadataForRender({ post }),
  ]);
  return deps.renderBareEntryDocument({
    post,
    siteTitle,
    pageHtmlEmbeds,
    widgetInlineResolved: widgets.inlineResolved,
    mediaTransformVersions,
    mediaAssetMetadata,
  });
}

export function createPostPreviewRenderer<TMenus>(required: Omit<ContentRouteDeps<TMenus>, "renderBarePreview"> & Parameters<typeof renderBarePostPreview>[0]["deps"], _optional = {}) {
  return ({ input }: { input: PostPreviewRenderInput }, _optional = {}): Promise<PostPreviewRenderResult> => renderPostPreview({
    deps: { ...required, renderBarePreview: ({ post }) => renderBarePostPreview({ deps: required, post }) }, input,
  });
}
