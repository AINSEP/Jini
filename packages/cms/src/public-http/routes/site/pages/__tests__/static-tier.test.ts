import { expect, it } from 'vitest';
import { DEFAULT_THEME_SLOTS } from '../../../../../themes/theme-slots.js';
import { finishStaticTierDocument } from '../static-tier.js';

it('substitutes bodies before assigning listing keys and keeps menus, previews, collections, render and head in order', async () => {
  const order: string[] = [];
  const html = await finishStaticTierDocument({ deps: {
    DEFAULT_THEME_SLOTS,
    expandPartials: ({ html }) => { order.push('expand'); return html + ':partial'; },
    resolveHtmlPageEmbeds: async ({ html }) => { order.push('embeds'); expect(html).toBe('source:partial'); return new Map(); },
    renderHtmlPageBody: () => { order.push('body'); return `<div data-embed-config='{"type":"menu","id":"body-menu"}'></div><div data-jini-see-more data-embed-config='{"type":"post-previews"}'></div>`; },
    resolveStaticMenusForRender: async (_required, optional) => { order.push('menus'); expect(optional.extraMenuIds).toEqual(['body-menu']); return { 'body-menu': [] }; },
    resolvePostPreviewsForRender: async ({ pageHtml }) => { order.push('previews'); expect(pageHtml).toContain('data-jini-listing="1"'); return undefined; },
    resolveCollectionListsForRender: async ({ html }) => { order.push('collections'); expect(html).toContain('data-jini-listing="1"'); return new Map(); },
    renderStaticPage: ({ htmlOverride }) => { order.push('render'); return '<html><head></head><body>' + htmlOverride + '</body></html>'; },
    staticThemeScripts: () => [], documentAssets: async () => { order.push('assets'); return { head: '<meta name="asset">', body: '' }; },
  }, input: { pageId: 'index', html: 'source', currentPath: '/', staticMenus: undefined, postPreviewsAccess: {} } });
  expect(html).toContain('<meta name="asset">');
  expect(order).toEqual(['expand', 'embeds', 'body', 'menus', 'previews', 'collections', 'render', 'assets']);
});
