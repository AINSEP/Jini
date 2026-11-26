import type { PublicPostRecord as PostRecord } from "../../../../../posts/post.js";
import type { RenderSiteRequired } from "../../../../http/site/render-site.js";
import type { StaticMenuContent } from "../render-context/static-menus.js";
import type { PerVisitorResponse } from "../response.js";

/**
 * Serve a page that has no row of its own (core's member sign-in pages, `member-pages.ts`) through
 * the same path an html-format Page takes, so it wears the active theme's page template, header and
 * footer on every tier. `post` lives only in memory: on the template branch its body reaches the
 * content slot through `renderViaTemplate`'s pending-body override (keyed to its id, the one the
 * admin preview uses), so no repo lookup runs for it. Errors propagate to the caller.
 */
export async function renderVirtualPage<TMenu = StaticMenuContent>({ post, currentPath, deps }: {
  post: PostRecord; currentPath: () => string;
  deps: {
    withListingBatch(): void;
    resolveRenderThemeId(required: { resolveStoredThemeId: () => Promise<string> }): Promise<string>;
    resolveActiveThemeId(): Promise<string>;
    resolveSiteAssistantWidgetForRequest(): Promise<NonNullable<RenderSiteRequired["siteAssistantEnabled"]>>;
    resolveActiveTheme(required: { activeThemeId: string }): object | "none" | null;
    NO_THEME_ID: "none";
    resolveTemplateBranchChoice(required: { theme: object; post: PostRecord }): { kind: "ineligible" | "as-chosen" } | { kind: "page-shell"; templateChoice: string };
    resolvePerVisitorResponse(): PerVisitorResponse;
    renderViaTemplate(required: { theme: object; post: PostRecord; staticMenus: Readonly<Record<string, TMenu>> }, optional: { pendingBodyJson: undefined; pendingBodyHtml: string; extraHead: undefined; siteAssistantEnabled: RenderSiteRequired["siteAssistantEnabled"] }): Promise<string>;
    resolveStaticMenusForRender(required: { theme: object; currentPath: string }): Promise<Readonly<Record<string, TMenu>>>;
    renderGenericPostPage(required: { theme: object | null; post: PostRecord; posts: PostRecord[]; siteAssistantEnabled: NonNullable<RenderSiteRequired["siteAssistantEnabled"]> }): Promise<string>;
    sendPublicPage(required: { html: string; perVisitor: PerVisitorResponse }): Promise<void> | void;
    sendNoThemesInstalled(): void;
  };
}, _optional = {}): Promise<void> {
  deps.withListingBatch();
  const [activeThemeId, siteAssistantEnabled] = await Promise.all([
    deps.resolveRenderThemeId({ resolveStoredThemeId: () => deps.resolveActiveThemeId() }),
    deps.resolveSiteAssistantWidgetForRequest(),
  ]);
  const resolved = deps.resolveActiveTheme({ activeThemeId });
  if (resolved === null) return deps.sendNoThemesInstalled();
  const theme = resolved === deps.NO_THEME_ID ? null : resolved;
  const branch = theme ? deps.resolveTemplateBranchChoice({ theme, post }) : { kind: "ineligible" as const };
  const perVisitor = deps.resolvePerVisitorResponse();
  const previewPost = branch.kind === "page-shell" ? { ...post, templateChoice: branch.templateChoice } : post;
  const html = theme && branch.kind !== "ineligible"
    ? await deps.renderViaTemplate({ theme, post: previewPost, staticMenus: await deps.resolveStaticMenusForRender({ theme, currentPath: currentPath() }) }, { pendingBodyJson: undefined, pendingBodyHtml: post.bodyHtml ?? "", extraHead: undefined, siteAssistantEnabled })
    : await deps.renderGenericPostPage({ theme, post, posts: [], siteAssistantEnabled });
  await deps.sendPublicPage({ html, perVisitor });
  return undefined;
}
