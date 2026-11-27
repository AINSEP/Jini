import { expect, it, vi } from 'vitest';
import type { PublicPostRecord } from '../../../../../posts/post.js';
import { renderTemplateDocument } from '../template-render.js';

function templateFixture() {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Page', slug: 'page', bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: 'saved', status: 'draft', templateChoice: 'page.html', updatedAt: 'now', version: 1 };
  const order: string[] = [];
  const deps: Parameters<typeof renderTemplateDocument>[0]['deps'] = {
    resolveTemplate: () => ({ kind: 'template', pageId: 'page', html: 'template' }),
    renderMissingTemplatePage: async () => { throw new Error('unexpected diagnostic'); },
    expandPartials: ({ html }) => { order.push('expand'); return html; },
    injectPageTitle: ({ html }) => { order.push('title'); return html; },
    injectCurrentEntityContentId: ({ html }) => { order.push('id'); return html; },
    renderAssignedTermsBlock: async () => { order.push('terms'); return 'terms'; },
    placeAfterCurrentContent: ({ html }) => html,
    resolveHtmlFormatContentMarkers: async (_required, optional) => { order.push('nested'); return optional.pendingHtmlOverride?.bodyHtml ?? post.bodyHtml!; },
    resolveHtmlPageEmbeds: async ({ pendingContentOverride }) => { order.push('embeds'); expect(pendingContentOverride()).toEqual({}); return new Map(); },
    renderHtmlPageBody: ({ html }) => { order.push('body'); return html; },
    postPublicPath: ({ slug }) => '/' + slug,
    resolveFeaturedImageForRender: async () => { order.push('cover'); return null; },
    finishStaticTierDocument: async ({ input }) => { order.push('static'); return '<html><head></head><body>' + input.html + '</body></html>'; },
    injectSiteAssistantIntoStaticPage: ({ html }) => { order.push('assistant'); return html; },
    renderCommentsMarkers: async ({ html }) => { order.push('comments'); return html; },
  };
  return { post, deps, order };
}

it('keeps pending HTML ahead of saved content through the ordered template pipeline', async () => {
  const { post, deps, order } = templateFixture();
  const html = await renderTemplateDocument({ post, staticMenus: undefined, deps }, { pendingBodyHtml: '', extraHead: '<meta name="entry">' });
  expect(html).toBe('<html><head><meta name="entry"></head><body></body></html>');
  expect(order).toEqual(['expand', 'title', 'id', 'terms', 'nested', 'embeds', 'body', 'cover', 'static', 'assistant', 'comments']);
});

it('uses the missing-template diagnostic without applying entry SEO or reading the body', async () => {
  const { post, deps } = templateFixture();
  const staticMenus = { main: { html: '<nav>Menu</nav>' } };
  const renderMissingTemplatePage = vi.fn(async () => '<main>Choose a template</main>');
  const expandPartials = vi.fn(({ html }: { html: string }) => html);
  expect(await renderTemplateDocument({ post, staticMenus, deps: { ...deps, expandPartials, renderMissingTemplatePage,
    resolveTemplate: () => ({ kind: 'diagnostic' }) },
  }, { extraHead: '<link rel="canonical" href="/page">' })).toBe('<main>Choose a template</main>');
  expect(renderMissingTemplatePage).toHaveBeenCalledExactlyOnceWith({ staticMenus });
  expect(expandPartials).not.toHaveBeenCalled();
});

it.each([null, '2026-11-12T12:00:00Z'] as const)('scopes pending document content and its cover to this post (publishAt=%s)', async publishAt => {
  const { post: saved, deps } = templateFixture();
  const post: PublicPostRecord = { ...saved, kind: 'post', bodyFormat: 'doc', bodyHtml: null,
    ...(publishAt === null ? {} : { publishAt }) };
  const pendingBodyJson = { type: 'doc', content: [{ type: 'image', attrs: { assetId: 'draft-cover' } }] };
  const cover = { url: '/m/draft-cover/public.v1/image.jpg', alt: 'Draft cover', width: 14, height: 8 };
  const resolveFeaturedImageForRender = vi.fn(async () => cover);
  const finishStaticTierDocument = vi.fn<typeof deps.finishStaticTierDocument>(async ({ input }) => '<article>' + input.featuredImage?.alt + '</article>');
  const resolveHtmlPageEmbeds = vi.fn<typeof deps.resolveHtmlPageEmbeds>(async () => undefined);
  const renderCommentsMarkers = vi.fn<typeof deps.renderCommentsMarkers>(async ({ html }) => html);
  const html = await renderTemplateDocument({ post, staticMenus: undefined, deps: {
    ...deps, resolveHtmlFormatContentMarkers: async ({ html }) => html, resolveHtmlPageEmbeds,
    resolveFeaturedImageForRender, finishStaticTierDocument, renderCommentsMarkers,
  } }, { pendingBodyJson });
  expect(html).toBe('<article>Draft cover</article>');
  expect(resolveHtmlPageEmbeds).toHaveBeenCalledOnce();
  expect(resolveHtmlPageEmbeds.mock.calls[0]![0].pendingContentOverride()).toEqual({
    pendingContentOverride: { id: 'p', title: 'Page', slug: 'page', updatedAt: 'now', publishAt, bodyJson: pendingBodyJson },
  });
  expect(resolveFeaturedImageForRender).toHaveBeenCalledExactlyOnceWith({ post: { ...post, bodyJson: pendingBodyJson } });
  expect(finishStaticTierDocument.mock.calls[0]![0].input.featuredImage).toEqual(cover);
  expect(renderCommentsMarkers.mock.calls[0]![0].entry()).toEqual({ id: 'p', slug: 'page', title: 'Page', status: 'draft', canonicalUrl: '/page' });
  expect(post.bodyJson).toEqual({});
});
