import { expect, it } from 'vitest';
import type { PublicPostRecord } from '../../../../../posts/post.js';
import { renderTemplateDocument } from '../template-render.js';

it('keeps pending HTML ahead of saved content through the ordered template pipeline', async () => {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Page', slug: 'page', bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: 'saved', status: 'draft', templateChoice: 'page.html', updatedAt: 'now', version: 1 };
  const order: string[] = [];
  const html = await renderTemplateDocument({ post, staticMenus: undefined, deps: {
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
  } }, { pendingBodyHtml: '', extraHead: '<meta name="entry">' });
  expect(html).toBe('<html><head><meta name="entry"></head><body></body></html>');
  expect(order).toEqual(['expand', 'title', 'id', 'terms', 'nested', 'embeds', 'body', 'cover', 'static', 'assistant', 'comments']);
});
