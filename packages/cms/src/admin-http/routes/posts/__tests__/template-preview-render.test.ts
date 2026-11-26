import { expect, it, vi } from 'vitest';
import type { PublicPostRecord } from '../../../../posts/post.js';
import { renderPostPreview } from '../template-preview-render.js';

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
