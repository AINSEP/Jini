import { expect, it, vi } from 'vitest';
import type { PublicPostRecord } from '../../../../posts/post.js';
import { TemplatePreviewRenderError, renderBarePostPreview, renderPostPreview } from '../template-preview-render.js';

it('forwards an absent HTML embed result as an explicit preview renderer input', async () => {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Post', slug: 'post', bodyJson: {}, kind: 'post', bodyFormat: 'doc', bodyHtml: null, status: 'draft', updatedAt: 'now', version: 1 };
  const renderBareEntryDocument = vi.fn((required: Parameters<Parameters<typeof renderBarePostPreview>[0]['deps']['renderBareEntryDocument']>[0]) => {
    expect(Object.hasOwn(required, 'pageHtmlEmbeds')).toBe(true);
    expect(required.pageHtmlEmbeds).toBeUndefined();
    return 'preview';
  });
  expect(await renderBarePostPreview({ post, deps: {
    resolveSiteTitle: async () => 'Site', resolveWidgetsForRender: async () => ({ inlineResolved: new Map() }),
    resolveHtmlEmbedsForRender: async () => undefined,
    resolveMediaTransformVersionsForRender: async () => new Map(),
    resolveMediaAssetMetadataForRender: async () => new Map(), renderBareEntryDocument,
  } })).toBe('preview');
  expect(renderBareEntryDocument).toHaveBeenCalledOnce();
});

it('renders a bare preview before reading the active theme', async () => {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Page', slug: 'page', bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: 'saved', status: 'draft', templateChoice: '', updatedAt: 'now', version: 1 };
  const getPresentationSettings = vi.fn(async () => ({ settings: { activeThemeId: 'active' } }));
  const result = await renderPostPreview({ input: { post }, deps: {
    getPresentationSettings, isBarePageChoice: post => post.templateChoice === '', renderBarePreview: async ({ post }) => '<main>' + post.bodyHtml + '</main>',
    resolveActiveTheme: () => null, NO_THEME_ID: 'none', resolveTemplateBranchChoice: () => ({ kind: 'ineligible' }),
    resolveStaticMenusForRender: async () => ({}), postPublicPath: ({ slug }) => '/' + slug,
    createMemberAccessResolver: () => ({}), renderViaTemplate: async () => { throw new Error('unexpected template'); },
    copy: { missingTheme: 'missing theme', themeOff: 'theme off' },
  } });
  expect(result).toEqual({ html: '<main>saved</main>', templateChoice: '' });
  expect(getPresentationSettings).not.toHaveBeenCalled();
});

it('keeps pending empty HTML ahead of the saved draft and changes only the render clone', async () => {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Page', slug: 'page', bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: 'saved', status: 'draft', templateChoice: null, updatedAt: 'now', version: 1 };
  const result = await renderPostPreview({ input: { post, bodyHtml: '' }, deps: {
    getPresentationSettings: async () => ({ settings: { activeThemeId: 'active' } }), isBarePageChoice: () => false,
    renderBarePreview: async () => { throw new Error('unexpected bare'); }, resolveActiveTheme: () => ({}), NO_THEME_ID: 'none',
    resolveTemplateBranchChoice: () => ({ kind: 'page-shell', templateChoice: 'page.html' }),
    resolveStaticMenusForRender: async () => ({}), postPublicPath: ({ slug }) => '/' + slug, createMemberAccessResolver: () => ({}),
    renderViaTemplate: async ({ post: preview }, optional) => {
      expect(preview).not.toBe(post);
      expect(preview.bodyHtml).toBe('');
      expect(optional.postPreviewsAccess.context).toEqual({ isAuthenticated: false, activeTierIds: [], isPaid: false });
      return '<main>' + optional.pendingBodyHtml + '</main>';
    }, copy: { missingTheme: 'missing theme', themeOff: 'theme off' },
  } });
  expect(result).toEqual({ html: '<main></main>', templateChoice: 'page.html' });
  expect(post.bodyHtml).toBe('saved');
  expect(post.templateChoice).toBeNull();
});

it.each(['doc', 'html'] as const)('forwards %s embeds unchanged with the original widget context', async bodyFormat => {
  const { createPostPreviewRenderer } = await import('../template-preview-render.js');
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Page', slug: 'page', bodyJson: {}, kind: 'page', bodyFormat, bodyHtml: 'saved', status: 'draft', templateChoice: '', updatedAt: 'now', version: 1 };
  const embeds = bodyFormat === 'doc' ? undefined : new Map();
  const inlineResolved = new Map();
  const widgets = vi.fn(async () => ({ inlineResolved }));
  const renderBareEntryDocument = vi.fn((required: Parameters<Parameters<typeof createPostPreviewRenderer>[0]['renderBareEntryDocument']>[0]) => {
    expect(Object.hasOwn(required, 'pageHtmlEmbeds')).toBe(true);
    expect(required.pageHtmlEmbeds).toBe(embeds);
    expect(required.widgetInlineResolved).toBe(inlineResolved);
    expect(Object.hasOwn(required, 'extraHead')).toBe(false);
    return '<main>preview</main>';
  });
  const renderer = createPostPreviewRenderer({
    isBarePageChoice: () => true, resolveSiteTitle: async () => 'Site', resolveWidgetsForRender: widgets,
    resolveHtmlEmbedsForRender: async () => embeds, resolveMediaTransformVersionsForRender: async () => new Map(),
    resolveMediaAssetMetadataForRender: async () => new Map(), renderBareEntryDocument,
  } as unknown as Parameters<typeof createPostPreviewRenderer>[0]);
  expect(await renderer({ input: { post } })).toEqual({ html: '<main>preview</main>', templateChoice: '' });
  expect(widgets).toHaveBeenCalledWith({ theme: null }, { post });
});

const doc: PublicPostRecord = {
  id: "post-preview", workspaceId: "ws-9", title: "Draft", slug: "draft",
  bodyJson: { type: "doc", content: [{ type: "paragraph" }] }, bodyFormat: "doc", bodyHtml: null,
  kind: "post", status: "draft", templateChoice: "saved.html", updatedAt: "2026-11-20T00:00:00Z", version: 2,
};

function themedDeps(resolved: object | "none" | null) {
  type Deps = Parameters<typeof renderPostPreview<Record<string, string>>>[0]["deps"];
  const renderViaTemplate = vi.fn<Deps["renderViaTemplate"]>().mockResolvedValue("<article>Preview</article>");
  const resolveStaticMenusForRender = vi.fn<Deps["resolveStaticMenusForRender"]>().mockResolvedValue({ main: "menu-9" });
  const deps: Deps = {
    getPresentationSettings: async () => ({ settings: { activeThemeId: "active-15" } }),
    resolveActiveTheme: ({ activeThemeId }) => {
      if (activeThemeId !== "active-15") throw new Error("unexpected active theme id");
      return resolved;
    },
    NO_THEME_ID: "none", isBarePageChoice: () => false,
    renderBarePreview: async () => { throw new Error("unexpected bare renderer"); },
    resolveTemplateBranchChoice: () => ({ kind: "as-chosen" }),
    resolveStaticMenusForRender, postPublicPath: ({ slug }) => `/posts/${slug}`,
    renderViaTemplate, createMemberAccessResolver: () => ({ audience: "public" }),
    copy: { missingTheme: "Active theme was not found.", themeOff: "Turn on the theme to preview a template." },
  };
  return { deps, renderViaTemplate, resolveStaticMenusForRender };
}

it.each([
  { state: "missing", resolved: null, status: 500, message: "Active theme was not found." },
  { state: "disabled", resolved: "none" as const, status: 409, message: "Turn on the theme to preview a template." },
])("refuses template renders when the active theme is $state", async ({ resolved, status, message }) => {
  const { deps, renderViaTemplate, resolveStaticMenusForRender } = themedDeps(resolved);
  const failure = renderPostPreview({ deps, input: { post: doc } });
  await expect(failure).rejects.toBeInstanceOf(TemplatePreviewRenderError);
  await expect(failure).rejects.toMatchObject({ name: "TemplatePreviewRenderError", status, message });
  expect(renderViaTemplate).not.toHaveBeenCalled();
  expect(resolveStaticMenusForRender).not.toHaveBeenCalled();
});

it.each([
  { status: "draft" as const, role: "an unpublished draft", pending: false },
  { status: "published" as const, role: "a published post", pending: false },
  { status: "published" as const, role: "a published post with pending edits", pending: true },
])("uses the correct document source for $role and never applies pending HTML to a doc", async ({ status, pending }) => {
  const theme = { id: "theme-9" };
  const { deps, renderViaTemplate, resolveStaticMenusForRender } = themedDeps(theme);
  const bodyJson = { type: "doc", content: [{ type: "heading" }] };
  const post = { ...doc, status };
  expect(await renderPostPreview({ deps, input: {
    post, templateChoice: null, bodyHtml: "<main>Not a doc override</main>", ...(pending ? { bodyJson } : {}),
  } })).toEqual({ html: "<article>Preview</article>", templateChoice: null });
  expect(resolveStaticMenusForRender.mock.calls).toEqual([[{ theme, currentPath: "/posts/draft" }]]);
  expect(renderViaTemplate.mock.calls).toEqual([[{
    theme, post: { ...doc, status, templateChoice: null, bodyJson: pending ? bodyJson : doc.bodyJson }, staticMenus: { main: "menu-9" },
  }, {
    pendingBodyJson: pending ? bodyJson : status === "draft" ? doc.bodyJson : undefined, pendingBodyHtml: undefined,
    siteAssistantEnabled: false,
    postPreviewsAccess: { resolver: { audience: "public" }, context: { isAuthenticated: false, activeTierIds: [], isPaid: false } },
  }]]);
  expect(post.templateChoice).toBe("saved.html");
  expect(post.bodyJson).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
});
