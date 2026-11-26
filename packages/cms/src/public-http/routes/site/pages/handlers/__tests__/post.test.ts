import { expect, it, vi } from 'vitest';
import type { PublicPostRecord } from '../../../../../../posts/post.js';
import { renderTemplateBranchIfEligible, renderBarePostPage, renderGenericPostPage } from '../post.js';

it('forwards absent and supplied HTML embeds and document assets through bare and generic post renders', async () => {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Post', slug: 'post', bodyJson: {}, kind: 'post', bodyFormat: 'doc', bodyHtml: null, status: 'published', updatedAt: 'now', version: 1 };
  const deps = {
    resolveSiteTitleForRender: async () => 'Site',
    resolveWidgetsForRender: async () => ({ regions: {}, inlineResolved: new Map() }),
    resolveHtmlEmbedsForRender: async () => undefined,
    resolveMediaTransformVersionsForRender: async () => new Map(),
    resolveMediaAssetMetadataForRender: async () => new Map(),
    buildExtraHead: async () => '', documentAssets: undefined,
  };
  expect(await renderBarePostPage({ post, deps: { ...deps, renderBareEntryDocument: required => {
    expect(Object.hasOwn(required, 'pageHtmlEmbeds')).toBe(true);
    expect(required.pageHtmlEmbeds).toBeUndefined();
    expect(Object.hasOwn(required, 'documentAssets')).toBe(true);
    expect(required.documentAssets).toBeUndefined();
    return 'bare';
  } } })).toBe('bare');
  expect(await renderGenericPostPage({ post, posts: [], siteAssistantEnabled: undefined, deps: {
    ...deps, resolveAssignedTermsForRender: async () => [], resolveSiteTimeZoneForRender: async () => 'UTC',
    renderCommentsMarkers: async ({ html }) => html,
    renderSite: async required => {
      expect(Object.hasOwn(required, 'pageHtmlEmbeds')).toBe(true);
      expect(required.pageHtmlEmbeds).toBeUndefined();
      expect(Object.hasOwn(required, 'renderAssets')).toBe(true);
      expect(required.renderAssets).toBeUndefined();
      expect(Object.hasOwn(required, 'siteAssistantEnabled')).toBe(true);
      expect(required.siteAssistantEnabled).toBeUndefined();
      return 'generic';
    },
  } })).toBe('generic');

  const embeds = new Map();
  const assets = async () => ({ head: '<!--asset-->', body: '' });
  const withAssets = { ...deps, resolveHtmlEmbedsForRender: async () => embeds, documentAssets: assets };
  expect(await renderBarePostPage({ post, deps: { ...withAssets, renderBareEntryDocument: required => {
    expect(required.pageHtmlEmbeds).toBe(embeds);
    expect(required.documentAssets).toEqual({ head: '<!--asset-->', body: '' });
    return 'bare';
  } } })).toBe('bare');
  expect(await renderGenericPostPage({ post, posts: [], siteAssistantEnabled: undefined, deps: {
    ...withAssets, resolveAssignedTermsForRender: async () => [], resolveSiteTimeZoneForRender: async () => 'UTC',
    renderCommentsMarkers: async ({ html }) => html,
    renderSite: async required => {
      expect(required.pageHtmlEmbeds).toBe(embeds);
      expect(required.renderAssets).toBe(assets);
      return 'generic';
    },
  } })).toBe('generic');
});

it('renders a bare page before checking whether a theme is active', async () => {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Page', slug: 'page', bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: 'bare', status: 'published', templateChoice: '', updatedAt: 'now', version: 1 };
  const branch = vi.fn(() => ({ kind: 'ineligible' as const }));
  const result = await renderTemplateBranchIfEligible({ post, theme: null,
    isBarePageChoice: value => value.kind === 'page' && value.templateChoice === '',
    renderBarePostPage: ({ post }) => renderBarePostPage({ post, deps: {
      resolveSiteTitleForRender: async () => 'Site', resolveWidgetsForRender: async () => ({ regions: {}, inlineResolved: new Map() }),
      resolveHtmlEmbedsForRender: async () => new Map(), resolveMediaTransformVersionsForRender: async () => new Map(),
      resolveMediaAssetMetadataForRender: async () => new Map(), buildExtraHead: async () => '', documentAssets: undefined,
      renderBareEntryDocument: ({ post }) => `<main>${post.bodyHtml}</main>`,
    } }), resolveTemplateBranchChoice: branch,
    buildExtraHead: async () => '', renderViaTemplate: async () => { throw new Error('unexpected template'); },
  });
  expect(result).toBe('<main>bare</main>');
  expect(branch).not.toHaveBeenCalled();
});

it('keeps title before the generic read batch and time zone before rendering', async () => {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Page', slug: 'page', bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: 'body', status: 'published', updatedAt: 'now', version: 1 };
  const order: string[] = [];
  const html = await renderGenericPostPage({ post, posts: [], siteAssistantEnabled: false, deps: {
    resolveSiteTitleForRender: async () => { order.push('title'); return 'Site'; },
    resolveWidgetsForRender: async () => { order.push('widgets'); return { regions: {}, inlineResolved: new Map() }; },
    resolveHtmlEmbedsForRender: async () => { order.push('embeds'); return new Map(); },
    resolveMediaTransformVersionsForRender: async () => { order.push('versions'); return new Map(); },
    resolveMediaAssetMetadataForRender: async () => { order.push('metadata'); return new Map(); },
    buildExtraHead: async () => { order.push('head'); return 'head'; },
    resolveAssignedTermsForRender: async () => { order.push('terms'); return []; },
    resolveSiteTimeZoneForRender: async () => { order.push('zone'); return 'UTC'; },
    documentAssets: undefined,
    renderCommentsMarkers: async ({ html }) => html + ':comments',
    renderSite: async ({ siteTitle, extraHead, transformBody }) => { order.push('render'); return transformBody!({ html: siteTitle + ':' + extraHead }); },
  } });
  expect(html).toBe('Site:head:comments');
  expect(order).toEqual(['title', 'widgets', 'embeds', 'versions', 'metadata', 'head', 'terms', 'zone', 'render']);
});
