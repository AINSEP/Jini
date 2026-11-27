import { expect, it, vi } from 'vitest';
import { DEFAULT_THEME_SLOTS } from '../../../../../themes/theme-slots.js';
import { serveStaticThemeIndex, finishStaticTierDocument, staticThemeScripts } from '../static-tier.js';

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

it('keeps authored title only for an undefined successful lookup and sequences finish, head, chat and send', async () => {
  for (const rejected of [false, true]) {
    const order: string[] = [];
    let sent = '';
    await serveStaticThemeIndex({ theme: { pages: { index: '<title>Authored</title>' } }, staticMenus: { header: [{ label: 'small' }] }, extraHead: '<title>Fold</title>', siteAssistantEnabled: 'react', access: {}, pageId: 'index', currentPath: '/',
      title: async () => { order.push('title'); if (rejected) throw new Error('offline'); return undefined; },
      finish: async ({ input }) => { order.push('finish'); expect(input.staticMenus?.header).toEqual([{ label: 'small' }]); return '<html><head><title>Authored</title></head><body></body></html>'; },
      chat: ({ html, enabled }) => { order.push('chat'); expect(enabled).toBe('react'); return html; },
      perVisitor: () => { order.push('visitor'); return {}; }, send: async ({ html }) => { order.push('send'); sent = html; } });
    expect(order).toEqual(['title', 'finish', 'chat', 'visitor', 'send']);
    expect(sent).toContain(rejected ? '<title>Fold</title>' : '<title>Authored</title>');
  }
});

it('reuses resolved menus and does not look up previews without a visitor context', async () => {
  const html = `<nav data-embed-config='{"type":"menu","id":"header"}'></nav>`;
  const staticMenus = { header: ['existing header menu'] };
  const resolveStaticMenusForRender = vi.fn(async () => ({ header: ['unexpected replacement'] }));
  const resolvePostPreviewsForRender = vi.fn(async () => undefined);
  const collectionLists = new Map([['books', '<ul><li>Dune</li></ul>']]);
  const renderStaticPage = vi.fn(({ htmlOverride }: { htmlOverride: string }) => htmlOverride);
  const staticScripts = vi.fn(() => []);
  const rendered = await finishStaticTierDocument({ input: { pageId: 'pricing', html, currentPath: '/pricing', staticMenus }, deps: {
    DEFAULT_THEME_SLOTS, expandPartials: ({ html }) => html,
    resolveHtmlPageEmbeds: async () => undefined, renderHtmlPageBody: ({ html }) => html,
    resolveStaticMenusForRender, resolvePostPreviewsForRender, resolveCollectionListsForRender: async () => collectionLists,
    renderStaticPage, staticThemeScripts: staticScripts, documentAssets: undefined,
  } });
  expect(rendered).toBe(html);
  expect(resolveStaticMenusForRender).not.toHaveBeenCalled();
  expect(resolvePostPreviewsForRender).not.toHaveBeenCalled();
  expect(staticScripts).not.toHaveBeenCalled();
  expect(renderStaticPage).toHaveBeenCalledExactlyOnceWith({
    pageId: 'pricing', htmlOverride: html, menus: staticMenus, collectionLists,
    postPreviews: undefined, postPreviewBatches: undefined, postPreviewsPage: undefined, featuredImage: undefined, postAuthor: undefined,
  });
});

it('returns authored static scripts without inventing any for a theme without scripts', () => {
  const scripts = [{ src: '/assets/pricing.js' }];
  expect(staticThemeScripts({ theme: { manifest: { scripts } } })).toEqual([{ src: '/assets/pricing.js' }]);
  expect(staticThemeScripts({ theme: { manifest: {} } })).toEqual([]);
});
